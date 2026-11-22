// Mid-year takeover (P11) — the YTD figures the pilot already paid before HRX.
//
// A November start without these produces a December annualisation and a 2316 that are
// wrong for every employee, in the direction that looks plausible: the tax already
// withheld between January and October simply disappears from the certificate.
import type { Money } from "./types";

/** One employee's year-to-date position carried in from the old system. */
export interface OpeningBalance {
    employeeId: string;
    /** Every peso the employee was paid this year, before HRX. */
    grossCentavos: Money;
    /** The taxable part of that gross. */
    taxableCentavos: Money;
    /** Tax actually remitted on the employee's behalf. */
    taxWithheldCentavos: Money;
    /** 13th month (and other benefits) already released this year. */
    thirteenthMonthCentavos: Money;
}

export interface OpeningRowInput {
    /** CSV row as parsed from the client, amounts in pesos. */
    email?: string;
    employeeId?: string;
    gross: number;
    taxable: number;
    taxWithheld: number;
    thirteenthMonth: number;
}

export interface OpeningValidation {
    ok: boolean;
    errors: string[];
}

const centavos = (pesos: number) => Math.round(pesos * 100);

/** Pesos rounded to the centavo (2dp), half-up on the magnitude. */
export function roundPesos(pesos: number): number {
    return Math.sign(pesos) * (Math.round(Math.abs(pesos) * 100) / 100);
}

/** Row-level checks. A bad import is worse than no import, so this is strict. */
export function validateOpeningRow(row: OpeningRowInput): OpeningValidation {
    const errors: string[] = [];
    if (!row.email && !row.employeeId) errors.push("a row needs an email or an employeeId");

    for (const [label, value] of [
        ["gross", row.gross],
        ["taxable", row.taxable],
        ["taxWithheld", row.taxWithheld],
        ["thirteenthMonth", row.thirteenthMonth],
    ] as const) {
        if (!Number.isFinite(value)) errors.push(`${label} is not a number`);
        else if (value < 0) errors.push(`${label} is negative`);
    }

    // Comparisons only run on sane bases, so one bad number produces ONE error, not a
    // cascade the operator has to untangle.
    if (Number.isFinite(row.taxable) && Number.isFinite(row.gross) && row.gross >= 0 && row.taxable > row.gross) {
        errors.push("taxable exceeds gross");
    }
    if (
        Number.isFinite(row.taxWithheld) &&
        Number.isFinite(row.taxable) &&
        row.taxable >= 0 &&
        row.taxWithheld > row.taxable
    ) {
        errors.push("tax withheld exceeds taxable compensation");
    }
    if (
        Number.isFinite(row.thirteenthMonth) &&
        Number.isFinite(row.gross) &&
        row.gross >= 0 &&
        row.thirteenthMonth > row.gross
    ) {
        errors.push("13th month exceeds gross");
    }
    return { ok: errors.length === 0, errors };
}

export function toOpeningBalance(employeeId: string, row: OpeningRowInput): OpeningBalance {
    return {
        employeeId,
        grossCentavos: centavos(row.gross),
        taxableCentavos: centavos(row.taxable),
        taxWithheldCentavos: centavos(row.taxWithheld),
        thirteenthMonthCentavos: centavos(row.thirteenthMonth),
    };
}

/**
 * The 13th-month ledger movement one opening balance causes, as a DELTA against what
 * the row already said.
 *
 * `importBalances` is an upsert per (org, employee, year), so a corrected CSV must
 * MOVE the figure the employee already had rather than add a second copy of it:
 * re-importing the same file yields a zero delta, and importing a smaller figure
 * claws the difference back. Only the part under the ceiling is exempt (A14: the
 * opening 13th month consumes the ceiling first), so the delta is computed on the
 * capped amounts, never on the raw pesos.
 */
export function openingLedgerDelta(args: {
    /** `thirteenthMonthPesos` already stored for this employee-year; 0 when new. */
    prevThirteenthPesos: number;
    /** The figure being imported now. */
    nextThirteenthPesos: number;
    exemptCeilingCentavos: Money;
}): {
    paidDelta: number;
    exemptDelta: number;
    prevExemptCentavos: Money;
    nextExemptCentavos: Money;
} {
    const prevExemptCentavos = Math.min(
        centavos(args.prevThirteenthPesos),
        args.exemptCeilingCentavos,
    );
    const nextExemptCentavos = Math.min(
        centavos(args.nextThirteenthPesos),
        args.exemptCeilingCentavos,
    );
    return {
        paidDelta: roundPesos(args.nextThirteenthPesos - args.prevThirteenthPesos),
        exemptDelta: roundPesos((nextExemptCentavos - prevExemptCentavos) / 100),
        prevExemptCentavos,
        nextExemptCentavos,
    };
}

/**
 * Apply a delta to a 13th-month ledger row, clamped at zero.
 *
 * The ledger also carries the register's own accrual and payout, so a reversal may
 * only ever subtract this import's share of `paid` / `exemptUsed`; the clamp is the
 * safeguard against a corrected figure driving the row negative.
 */
export function applyLedgerDelta(args: {
    paid: number;
    exemptUsed: number;
    paidDelta: number;
    exemptDelta: number;
}): { paid: number; exemptUsed: number } {
    return {
        paid: Math.max(0, roundPesos(args.paid + args.paidDelta)),
        exemptUsed: Math.max(0, roundPesos(args.exemptUsed + args.exemptDelta)),
    };
}

/**
 * Fold one employee's opening balance into the year's register totals.
 *
 * The 13th month carried in consumes the ₱90,000 ceiling FIRST — it was paid before
 * HRX existed, so the register's own 13th month gets whatever room is left. That is the
 * only ordering that cannot over-exempt a second time.
 */
export function mergeOpeningBalance(args: {
    grossCentavos: Money;
    nonTaxableCentavos: Money;
    taxableCentavos: Money;
    withheldCentavos: Money;
    opening: OpeningBalance;
    exemptCeilingCentavos: Money;
}): {
    grossCentavos: Money;
    nonTaxableCentavos: Money;
    taxableCentavos: Money;
    withheldCentavos: Money;
    openingExemptCentavos: Money;
    openingTaxableThirteenthCentavos: Money;
} {
    const alreadyExempt = Math.min(args.opening.thirteenthMonthCentavos, args.exemptCeilingCentavos);
    const thirteenthOverCeiling = args.opening.thirteenthMonthCentavos - alreadyExempt;

    return {
        grossCentavos: args.grossCentavos + args.opening.grossCentavos,
        nonTaxableCentavos: args.nonTaxableCentavos + alreadyExempt,
        // The excess is taxable compensation that the old system already taxed; adding it
        // to taxable keeps the annual bracket honest without re-taxing it.
        taxableCentavos: args.taxableCentavos + args.opening.taxableCentavos + thirteenthOverCeiling,
        withheldCentavos: args.withheldCentavos + args.opening.taxWithheldCentavos,
        openingExemptCentavos: alreadyExempt,
        openingTaxableThirteenthCentavos: thirteenthOverCeiling,
    };
}
