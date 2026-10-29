// Rate derivation and period basic pay (P0.3, D7).
//
// Pure and node-runnable (see scripts/payroll-fixtures.mjs): no ctx, no
// generated types, ConvexError only so the message survives to the client.
//
// MONEY: every exported `Money` is integer centavos. Rates arrive in pesos
// because that is what a human types into the position form; conversion happens
// once, at the point a line is produced, and rounds half-up there.
import { ConvexError } from "convex/values";
import { DAY_MS, isRestDay, manilaMidnight, workDaysInRange } from "./calendar";
import type {
    Allowance,
    DailyRateBasis,
    Money,
    PayrollSettings,
    PayTerms,
    PayType,
    StatutoryBasis,
    WorkWeek,
} from "./types";

/** Labor Code Art. 83 — normal hours of work in a day. */
export const NORMAL_HOURS_PER_DAY = 8;

/**
 * Pilot conventions (§5, D-PILOT-1/3/4): a 6-day week, cutoffs on the 10th and
 * 25th paid on the 15th and 30th, contributions on basic. Any org can override
 * these in Settings → Payroll; the values here are only the fallback for an org
 * that has never opened that page.
 */
export const DEFAULT_PAYROLL_SETTINGS: PayrollSettings = {
    workWeek: "6_day",
    periodType: "semi_monthly",
    cutoffDays: [10, 25],
    payDays: [15, 30],
    statutoryBasis: "basic",
    dailyRateBasis: "313",
    isTestOrg: false,
};

// ─── Money ─────────────────────────────────────────────────────────────────

/** Half-up rounding, negative-safe. */
export function roundHalfUp(value: number): number {
    if (!Number.isFinite(value)) {
        throw new ConvexError("Cannot round a non-finite amount");
    }
    return value >= 0
        ? Math.floor(value + 0.5)
        : -Math.floor(-value + 0.5);
}

/** Pesos → integer centavos, half-up. */
export function toCentavos(pesos: number): Money {
    return roundHalfUp(pesos * 100);
}

/** Integer centavos → pesos, for display and for the DB boundary in P3. */
export function fromCentavos(centavos: Money): number {
    return centavos / 100;
}

// ─── Pay terms ─────────────────────────────────────────────────────────────

/**
 * The daily-rate divisor paired with a work week (D7): 261 for a 5-day week,
 * 313 for a 6-day week. Those are the divisors that reproduce DOLE's own worked
 * examples for monthly-paid staff.
 */
export function defaultDailyRateBasis(workWeek: WorkWeek): DailyRateBasis {
    return workWeek === "5_day" ? "261" : "313";
}

/** A position row as stored — every pay field optional on Phase 1 rows. */
export type PositionPayFields = {
    salary?: number;            // gross ANNUAL (convex/schema.ts)
    payType?: PayType;
    basicRate?: number;
    dailyRateBasis?: DailyRateBasis;
    workWeek?: WorkWeek;
    statutoryBasis?: StatutoryBasis;
    allowances?: Allowance[];
};

/**
 * Resolve a position row into complete pay terms (P0.1).
 *
 * NEVER throws on a missing field: this table already ships Phase 1 rows, so a
 * strict resolver would break every existing employee. Anything it cannot
 * resolve is returned in `issues` instead — callers (the backfill, the preview)
 * report those rows rather than compute a number from a guess.
 */
export function resolvePayTerms(args: {
    position: PositionPayFields;
    settings?: Partial<PayrollSettings> | null;
}): { terms: PayTerms; issues: string[] } {
    const { position } = args;
    const settings: PayrollSettings = {
        ...DEFAULT_PAYROLL_SETTINGS,
        ...(args.settings ?? {}),
    };
    const issues: string[] = [];

    const payType: PayType = position.payType ?? "monthly";
    const workWeek: WorkWeek = position.workWeek ?? settings.workWeek;
    // Order matters: a row that states its own work week must derive its divisor
    // from THAT week, not inherit the org default. The pilot org is 6-day/313, so
    // a 5-day field team inheriting 313 would be paid ~17% too little per day.
    const dailyRateBasis: DailyRateBasis =
        position.dailyRateBasis ??
        (position.workWeek !== undefined
            ? defaultDailyRateBasis(position.workWeek)
            : settings.dailyRateBasis);
    const statutoryBasis: StatutoryBasis =
        position.statutoryBasis ?? settings.statutoryBasis;

    let basicRate = position.basicRate;
    if (basicRate === undefined) {
        // `salary` is the gross ANNUAL figure, so a monthly-paid employee's
        // monthly rate is salary / 12. A daily or hourly rate cannot be derived
        // from an annual salary without choosing a divisor, and choosing one is
        // exactly the guess D7 says must be explicit — so it is an issue.
        if (position.salary !== undefined && payType === "monthly") {
            basicRate = position.salary / 12;
        } else {
            issues.push(
                payType === "monthly"
                    ? "No basic rate and no annual salary on the position row"
                    : `Pay type is ${payType} but the row carries no ${payType} rate — set it explicitly`,
            );
            basicRate = 0;
        }
    }
    if (basicRate < 0) {
        throw new ConvexError("Basic rate cannot be negative");
    }

    // D7's divisor is a property of the week it is derived from. A row that
    // pairs a 5-day week with 313 pays everyone ~17% too little per day, and it
    // is invisible until a holiday payslip is checked by hand.
    if (
        position.workWeek !== undefined &&
        position.dailyRateBasis !== undefined &&
        position.dailyRateBasis !== defaultDailyRateBasis(position.workWeek) &&
        position.dailyRateBasis !== "22" &&
        position.dailyRateBasis !== "26"
    ) {
        issues.push(
            `dailyRateBasis ${position.dailyRateBasis} does not match a ${position.workWeek} week ` +
                `(expected ${defaultDailyRateBasis(position.workWeek)})`,
        );
    }

    return {
        terms: {
            payType,
            basicRate,
            dailyRateBasis,
            workWeek,
            statutoryBasis,
            allowances: position.allowances ?? [],
        },
        issues,
    };
}

// ─── Derived rates (D7) ────────────────────────────────────────────────────

/** Exact (unrounded) daily rate in pesos — round only when producing a line. */
export function dailyRateExact(terms: PayTerms): number {
    if (terms.basicRate < 0) {
        throw new ConvexError("Basic rate cannot be negative");
    }
    switch (terms.payType) {
        case "daily":
            return terms.basicRate;
        case "hourly":
            return terms.basicRate * NORMAL_HOURS_PER_DAY;
        case "monthly": {
            const divisor = Number(terms.dailyRateBasis);
            return (terms.basicRate * 12) / divisor;
        }
    }
}

/** Daily rate in integer centavos, rounded half-up. */
export function dailyRateCentavos(terms: PayTerms): Money {
    return toCentavos(dailyRateExact(terms));
}

/** Exact (unrounded) hourly rate in pesos. */
export function hourlyRateExact(terms: PayTerms): number {
    if (terms.payType === "hourly") return terms.basicRate;
    return dailyRateExact(terms) / NORMAL_HOURS_PER_DAY;
}

/** Hourly rate in integer centavos, rounded half-up. */
export function hourlyRateCentavos(terms: PayTerms): Money {
    return toCentavos(hourlyRateExact(terms));
}

/**
 * Gross annual figure for a set of pay terms.
 *
 * D15 keeps `salary` (gross annual) as the contractual figure and asserts
 * `salary === basicRate * 12` for monthly pay; daily and hourly rates use the
 * same divisor the daily rate is derived from, so a row can never carry two
 * inconsistent statements of the same pay.
 */
export function annualSalaryFor(terms: PayTerms): number {
    const divisor = Number(terms.dailyRateBasis);
    const annual =
        terms.payType === "monthly"
            ? terms.basicRate * 12
            : terms.payType === "daily"
              ? terms.basicRate * divisor
              : terms.basicRate * NORMAL_HOURS_PER_DAY * divisor;
    return roundHalfUp(annual * 100) / 100;
}

/**
 * The derivation stated in words, for the payslip footer (D7 requires it).
 * "PHP 30,000.00/month × 12 ÷ 261 = PHP 1,379.31/day".
 */
export function rateDerivation(terms: PayTerms): string {
    if (terms.payType === "daily") {
        return `PHP ${terms.basicRate.toFixed(2)}/day (contractual daily rate)`;
    }
    if (terms.payType === "hourly") {
        return (
            `PHP ${terms.basicRate.toFixed(2)}/hour × ` +
            `${NORMAL_HOURS_PER_DAY} hours = ` +
            `PHP ${dailyRateExact(terms).toFixed(2)}/day`
        );
    }
    return (
        `PHP ${terms.basicRate.toFixed(2)}/month × 12 ÷ ` +
        `${terms.dailyRateBasis} = PHP ${dailyRateExact(terms).toFixed(2)}/day`
    );
}

// ─── Proration and period basic pay ────────────────────────────────────────

/**
 * `amount` × portion ÷ whole, in centavos, half-up. A zero or negative `whole`
 * pays nothing instead of dividing by zero.
 */
export function prorate(
    amountCentavos: Money,
    portion: number,
    whole: number,
): Money {
    if (whole <= 0) return 0;
    const clamped = Math.min(Math.max(portion, 0), whole);
    return roundHalfUp((amountCentavos * clamped) / whole);
}

/**
 * Basic pay for one half-month period.
 *
 * MONTHLY pay is half the monthly rate per cutoff, prorated on the WORK-WEEK
 * CALENDAR (not calendar days) when the employment window is partial: DOLE's
 * own worked examples prorate monthly staff by working days, and prorating a
 * 16–31 cutoff (16 days) against a 1–15 cutoff (15 days) by date would pay the
 * same monthly salary two different amounts.
 *
 * DAILY pay is the daily rate × working days actually in the window.
 *
 * HOURLY pay is hourly rate × scheduled hours in the window as a BASELINE only:
 * P1 prices an hourly-paid employee from the approved day intervals, and must
 * not ship this scheduled figure as their pay.
 */
export function periodBasicPay(args: {
    terms: PayTerms;
    /** Manila midnight, inclusive. */
    periodStart: number;
    periodEnd: number;
    employmentStart?: number;
    employmentEnd?: number;
}): Money {
    const { terms } = args;
    const periodStart = manilaMidnight(args.periodStart);
    const periodEnd = manilaMidnight(args.periodEnd);
    if (periodEnd < periodStart) {
        throw new ConvexError("Period end must not be before the period start");
    }

    const windowStart = Math.max(
        periodStart,
        args.employmentStart === undefined
            ? periodStart
            : manilaMidnight(args.employmentStart),
    );
    const windowEnd = Math.min(
        periodEnd,
        args.employmentEnd === undefined
            ? periodEnd
            : manilaMidnight(args.employmentEnd),
    );
    // Employed outside this period entirely — nothing due, and that is not an error.
    if (windowEnd < windowStart) return 0;

    const scheduledDays = workDaysInRange(periodStart, periodEnd, terms.workWeek);
    const windowDays = workDaysInRange(windowStart, windowEnd, terms.workWeek);

    switch (terms.payType) {
        case "monthly": {
            const halfMonth = toCentavos(terms.basicRate / 2);
            if (windowDays === scheduledDays) return halfMonth;
            return prorate(halfMonth, windowDays, scheduledDays);
        }
        case "daily": {
            const daily = dailyRateCentavos(terms);
            return daily * windowDays;
        }
        case "hourly": {
            const hourly = hourlyRateCentavos(terms);
            return hourly * windowDays * NORMAL_HOURS_PER_DAY;
        }
    }
}

/** Recomputes the position row's allowance total from its list (D15). */
export function allowanceTotalOf(allowances: Allowance[]): Money {
    return allowances.reduce(
        (sum, allowance) => sum + toCentavos(allowance.amount),
        0,
    );
}

/**
 * D15's invariant: the stored `allowanceTotal` is display-only, so the engine
 * recomputes it and this reports a mismatch. A hand-edited total is a bug, not
 * a rounding tolerance.
 */
export function allowanceTotalMismatch(
    allowances: Allowance[],
    storedTotalPesos: number | undefined,
): { stored: Money | null; recomputed: Money; matches: boolean } {
    const recomputed = allowanceTotalOf(allowances);
    if (storedTotalPesos === undefined) {
        return { stored: null, recomputed, matches: false };
    }
    const stored = toCentavos(storedTotalPesos);
    return { stored, recomputed, matches: stored === recomputed };
}

/** Days between two Manila anchors, inclusive — exported for period builders. */
export function dayCount(startMs: number, endMs: number): number {
    return Math.floor((manilaMidnight(endMs) - manilaMidnight(startMs)) / DAY_MS) + 1;
}

/** Re-exported so a consumer needs one import for day-vs-rest-day questions. */
export { isRestDay };
