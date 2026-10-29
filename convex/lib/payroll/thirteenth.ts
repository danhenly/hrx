// 13th month accrual and payout (P5.1/P5.2, D5).
//
// PD 851: 1/12 of the basic salary EARNED in the calendar year, paid on or before
// 24 December. It accrues every run — a December-only calculation cannot be seen
// coming, and the cash shock lands on the employer instead of being a known liability.
//
// ROUNDING RULE (the acceptance asks for it to be stated): the accrual is rounded
// HALF-UP PER PERIOD, not once at year end. 24 rounded cutoffs can therefore differ
// from the exact 1/12 of annual basic by up to 12 centavos — under ₱0.12 — and the
// fixture asserts that bound rather than pretending the two agree exactly.
import { roundHalfUp } from "./rates";
import type { Money } from "./types";

export type AccrualInput = {
    /** BASIC + day premiums earned in this period, in centavos (OT, ND and
     *  allowances are excluded — D5 is explicit that "basic salary earned" is not
     *  gross pay). */
    basicEarnedCentavos: Money;
};

/** One period's accrual: 1/12 of the basic earned in it. */
export function accrualForPeriod(input: AccrualInput): Money {
    if (input.basicEarnedCentavos < 0) {
        throw new Error("Basic earned cannot be negative");
    }
    return roundHalfUp(input.basicEarnedCentavos / 12);
}

export type PayoutSplit = {
    /** Total released by this payout (accrued to date minus already paid). */
    totalCentavos: Money;
    /** Within the combined benefits ceiling — non-taxable. */
    exemptCentavos: Money;
    /** Above the ceiling — taxable compensation. */
    taxableCentavos: Money;
};

/**
 * Split a payout against the combined exemption ceiling (₱90,000 with other
 * benefits, §2.4). `exemptUsedCentavos` is what the employee has already consumed
 * this year on benefits, and `ceilingCentavos` comes from the tax table row.
 *
 * The excess is moved to TAXABLE rather than dropped: a system that keeps the whole
 * 13th month non-taxable under-withholds, and the employee finds out at 2316 time.
 */
export function payoutSplit(args: {
    accruedCentavos: Money;
    paidCentavos: Money;
    exemptUsedCentavos: Money;
    ceilingCentavos: Money;
}): PayoutSplit {
    const total = Math.max(0, args.accruedCentavos - args.paidCentavos);
    const remainingCeiling = Math.max(
        0,
        args.ceilingCentavos - args.exemptUsedCentavos,
    );
    const exempt = Math.min(total, remainingCeiling);
    return {
        totalCentavos: total,
        exemptCentavos: exempt,
        taxableCentavos: total - exempt,
    };
}

/**
 * Equal instalments for a loan term, with the residue on the LAST one so the total
 * is exact. The pilot's policy for an SSS salary loan is the standard 10-month
 * schedule; interest is not modelled, so a loan carrying it enters a fixed
 * `amortisation` instead and this helper is not used.
 */
export function equalInstalments(args: {
    principalCentavos: Money;
    termMonths: number;
}): Money[] {
    if (args.termMonths <= 0) throw new Error("A loan needs a positive term");
    const perMonth = Math.floor(args.principalCentavos / args.termMonths);
    const instalments = Array.from({ length: args.termMonths }, () => perMonth);
    instalments[args.termMonths - 1] =
        args.principalCentavos - perMonth * (args.termMonths - 1);
    return instalments;
}
