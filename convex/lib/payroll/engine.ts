// The payroll engine (§6.1, §6.2).
//
// P1 computes EARNINGS: basic pay for the period, the day-by-day prices (holiday,
// rest day, OT, night differential), allowances with the de minimis split, and
// adjustments. Statutory contributions, withholding tax, loans and 13th month are
// P2/P5 and are NOT here.
//
// Because the deductions do not exist yet, every result is BLOCKED with
// `STATUTORY_PENDING`: the preview can show earnings, but nothing may persist a
// payslip whose net pay is missing every statutory deduction. That flag is what
// keeps a P1 preview from becoming a P1 payroll run.
//
// Pure: no ctx, no DB, no generated types — exercises under plain node.
import { ConvexError } from "convex/values";
import {
    classifyDay,
    dateKeyOf,
    DAY_MS,
    eachDay,
    isRestDay,
    workDaysInRange,
} from "./calendar";
import { isInMonthlyRate, NORMAL_MINUTES_PER_DAY, priceDay } from "./premiums";
import {
    allowanceTotalOf,
    dailyRateCentavos,
    hourlyRateCentavos,
    NORMAL_HOURS_PER_DAY,
    periodBasicPay,
    rateDerivation,
    roundHalfUp,
    toCentavos,
} from "./rates";
import type {
    Adjustment,
    Allowance,
    DeminimisTable,
    DayRecord,
    HolidayRule,
    Money,
    PayProfile,
    PayResult,
    PayslipLine,
} from "./types";

/** Bumped when the engine's behaviour changes; recorded per run in P3. */
export const ENGINE_STAGE = "P1-earnings";

export const STATUTORY_PENDING = "STATUTORY_PENDING";

/** A semi-monthly period is half a month — the conversion for monthly amounts. */
const PERIODS_PER_YEAR = 24;
/** Semi-monthly periods in one de minimis ceiling period. */
const CEILING_PERIODS: Record<string, number> = {
    monthly: 2,
    semester: 4,
    semestral: 4,
    annual: 24,
    yearly: 24,
};

export type ComputePayslipArgs = {
    employee: { id: string; name: string };
    profile: PayProfile;
    days: DayRecord[];
    holidayTable: HolidayRule[];
    /** Only the de minimis ceilings are read in P1; P2 adds sss/philhealth/pagibig/tax. */
    tables: { deminimis?: DeminimisTable };
    adjustments?: Adjustment[];
    ytd?: {
        taxable: Money;
        taxWithheld: Money;
        thirteenthPaid: Money;
        exemptUsed: Money;
    };
    period: {
        startDate: number;
        endDate: number;
        payDate: number;
        isYearEnd: boolean;
    };
    /** Employment window, for proration. Defaults to the whole period. */
    employment?: { start?: number; end?: number };
};

/** Zeroed totals — one object, so "zeros" cannot mean two different things. */
function zeroTotals(): Pick<
    PayResult,
    "gross" | "totalDeductions" | "net" | "employerCost"
> {
    return { gross: 0, totalDeductions: 0, net: 0, employerCost: 0 };
}

/**
 * Compute one payslip (§6.1 signature).
 *
 * §6.2 order: profile resolved → basic pay for the period → price each day →
 * period earnings (allowances, adjustments) → [P2: contributions, tax] → [P5: loans,
 * 13th month] → totals.
 */
export function computePayslip(args: ComputePayslipArgs): PayResult {
    if (!args || typeof args !== "object") {
        throw new ConvexError("computePayslip requires the §6.1 argument object");
    }
    // Validate the shape up front: a missing period used to surface as a raw
    // TypeError, which Convex relays as a generic "Server Error" with no clue
    // which argument was absent.
    const missing: string[] = [];
    if (!args.profile) missing.push("profile");
    if (!Array.isArray(args.days)) missing.push("days");
    if (
        !args.period ||
        typeof args.period.startDate !== "number" ||
        typeof args.period.endDate !== "number"
    ) {
        missing.push("period");
    }
    if (missing.length > 0) {
        throw new ConvexError(
            `computePayslip is missing ${missing.join(", ")} — it takes the §6.1 argument object`,
        );
    }
    const { profile, period } = args;
    if (period.endDate < period.startDate) {
        throw new ConvexError("Period end must not be before the period start");
    }

    const lines: PayslipLine[] = [];
    const notes: string[] = [];

    // ── 1. Basic pay for the period ────────────────────────────────────────
    // Monthly-paid: half the monthly rate, prorated on the work-week calendar.
    // Daily/hourly: no period-level basic — the days below are the basic pay.
    if (profile.payType === "monthly") {
        const basic = periodBasicPay({
            terms: profile,
            periodStart: period.startDate,
            periodEnd: period.endDate,
            employmentStart: args.employment?.start,
            employmentEnd: args.employment?.end,
        });
        lines.push({
            kind: "earning",
            code: "BASIC",
            description: "Basic pay for the period",
            quantity: 1,
            amount: basic,
            taxable: true,
        });
    }

    // ── 2. Price the period's CALENDAR, one day at a time (§6.2 step 3) ────
    // Not just the days that have a record: an unworked regular holiday is payable
    // to a daily-paid employee (D8) and produces no timeEntry at all, so iterating
    // the records alone would silently never pay it.
    const recordByDate = new Map(
        args.days.map((day) => [dateKeyOf(day.date), day]),
    );
    const workedDates = new Set(
        args.days.filter((day) => day.totalMinutes > 0).map((day) => dateKeyOf(day.date)),
    );
    let workedMinutes = 0;
    let nightMinuteCount = 0;
    let pricedDayCount = 0;
    let absentMinutes = 0;

    for (const date of eachDay(period.startDate, period.endDate)) {
        // Employment window: nothing is priced outside it.
        if (args.employment?.start !== undefined && date < args.employment.start) {
            continue;
        }
        if (args.employment?.end !== undefined && date > args.employment.end) {
            continue;
        }
        const record = recordByDate.get(dateKeyOf(date));
        const priced = priceDay({
            date,
            totalMinutes: record?.totalMinutes ?? 0,
            intervals: record?.intervals ?? [],
            classification: {
                dayType: classifyDay(date, args.holidayTable),
                isRestDay: isRestDay(date, profile.workWeek),
            },
            terms: profile,
            // The unworked-holiday rule (§2.5 note): payable only if the employee
            // worked the day before.
            priorDayWorked: workedDates.has(dateKeyOf(date - DAY_MS)),
        });
        if (priced.lines.length > 0) pricedDayCount += 1;
        lines.push(...priced.lines);
        workedMinutes += priced.workedMinutes;
        nightMinuteCount += priced.nightMinutes;

        // Absence: the monthly rate pays for the SCHEDULE, so time not worked is
        // deducted automatically — full days and undertime alike. Regular holidays
        // and rest days are paid whether worked or not, so they never deduct; a
        // special non-working day is already "no work, no pay" and is paid only for
        // the hours actually worked, so it never deducts either.
        if (profile.payType === "monthly" && !isRestDay(date, profile.workWeek)) {
            const dayType = classifyDay(date, args.holidayTable);
            if (dayType === "ordinary" || dayType === "special_working") {
                const shortfall = NORMAL_MINUTES_PER_DAY - Math.min(
                    record?.totalMinutes ?? 0,
                    NORMAL_MINUTES_PER_DAY,
                );
                if (shortfall > 0) {
                    absentMinutes += shortfall;
                }
            }
        }
    }

    if (absentMinutes > 0) {
        const dailyCentavos = dailyRateCentavos(profile);
        const perMinute = dailyCentavos / NORMAL_MINUTES_PER_DAY;
        lines.push({
            kind: "deduction",
            code: "ABSENCE",
            description: `Unpaid absence / undertime (${(absentMinutes / NORMAL_MINUTES_PER_DAY).toFixed(2)} day(s))`,
            quantity: absentMinutes / NORMAL_MINUTES_PER_DAY,
            amount: roundHalfUp(perMinute * absentMinutes),
            taxable: false,
        });
    }

    // ── 3. Allowances (D15 / P1.3) ─────────────────────────────────────────
    const workDays = workDaysInRange(period.startDate, period.endDate, profile.workWeek);
    const allowanceLines = priceAllowances({
        allowances: profile.allowances,
        deminimis: args.tables?.deminimis,
        workDays,
        notes,
    });
    lines.push(...allowanceLines.lines);

    // ── 4. Adjustments (P1.4: a correction is a line, never an edit — D2) ──
    for (const adjustment of args.adjustments ?? []) {
        if (adjustment.amountCentavos === 0) continue;
        lines.push({
            kind: adjustment.amountCentavos > 0 ? "earning" : "deduction",
            code: adjustment.code,
            description: adjustment.description,
            amount: Math.abs(adjustment.amountCentavos),
            taxable: adjustment.amountCentavos > 0,
            source: { type: "adjustment", id: adjustment.code },
        });
    }

    // ── 5. Memo lines: the payslip must state how the daily rate was derived
    // (D7) and which statutory basis it will use (D-PILOT-3). ──────────────
    lines.push({
        kind: "memo",
        code: "RATE_DERIVATION",
        description: rateDerivation(profile),
        amount: 0,
        taxable: false,
    });
    lines.push({
        kind: "memo",
        code: "STATUTORY_BASIS",
        description: `Statutory contributions computed on ${profile.statutoryBasis.replace("_", " ")} pay`,
        amount: 0,
        taxable: false,
    });

    const totals = totalsFromLines(lines);

    return {
        lines,
        ...totals,
        hoursWorked: workedMinutes / 60,
        nightHours: nightMinuteCount / 60,
        notes,
        pricedDays: pricedDayCount,
        absentDays: absentMinutes / NORMAL_MINUTES_PER_DAY,
        blocked: {
            code: STATUTORY_PENDING,
            reason:
                `Engine stage ${ENGINE_STAGE}: earnings are computed, but statutory ` +
                "contributions, withholding tax, loans and 13th month are P2/P5. The net " +
                "below is NOT a payable amount and this payslip must not be persisted.",
        },
    };
}

/**
 * Allowances (P1.3, D15).
 *
 * Each item is prorated from its own unit to the period (a monthly allowance pays
 * half in a semi-monthly run), then a de minimis item is split at its ceiling:
 * the exempt part stays `ALW_<CODE>` and the excess becomes a TAXABLE line. Silently
 * keeping the whole allowance exempt under-withholds; rejecting it annoys the
 * employer. The split is the only correct answer.
 */
export function priceAllowances(args: {
    allowances: Allowance[];
    deminimis?: DeminimisTable;
    workDays: number;
    notes: string[];
}): { lines: PayslipLine[]; exempt: Money; taxable: Money } {
    const lines: PayslipLine[] = [];
    let exempt = 0;
    let taxable = 0;

    for (const allowance of args.allowances) {
        if (allowance.amount <= 0) continue;
        const unit = allowance.unit ?? "monthly";
        const factor =
            unit === "semi_monthly" || unit === "per_period"
                ? 1
                : unit === "monthly"
                  ? 1 / 2
                  : unit === "annual"
                    ? 1 / PERIODS_PER_YEAR
                    : args.workDays; // per_day
        const amountCentavos = roundHalfUp(toCentavos(allowance.amount) * factor);

        const ceiling = allowance.deMinimisCategory
            ? args.deminimis?.ceilings.find(
                  (row) => row.key === allowance.deMinimisCategory,
              )
            : undefined;

        // No ceiling, a percentage-based ceiling (meal-OT is a share of the
        // minimum wage, and P0 has no wage table), or a taxable code: the whole
        // amount is taxable. Never silently exempt.
        const ceilingPerPeriod =
            ceiling && ceiling.ceiling !== null
                ? roundHalfUp(
                      toCentavos(ceiling.ceiling) /
                          (CEILING_PERIODS[ceiling.period] ?? 1),
                  )
                : null;

        if (ceiling && ceiling.ceiling === null) {
            args.notes.push(
                `${allowance.code}: de minimis ceiling is expressed as a percentage of the minimum wage and is not evaluated yet — the full amount is treated as exempt, which is the position P2 must revisit.`,
            );
        }

        // Four cases, stated one per branch rather than as a nested ternary:
        //   1. taxable by catalogue            -> all taxable
        //   2. non-taxable, numeric ceiling    -> exempt up to the ceiling
        //   3. non-taxable, percentage ceiling -> all exempt, flagged in notes
        //   4. non-taxable, no ceiling at all  -> all TAXABLE (no de minimis basis)
        // Case 4 is the conservative direction: over-withholding is recoverable at
        // year-end, under-withholding is a 1601-C that does not match the alphalist.
        let exemptCentavos = 0;
        if (!allowance.taxable) {
            if (ceilingPerPeriod !== null) {
                exemptCentavos = Math.min(amountCentavos, ceilingPerPeriod);
            } else if (ceiling) {
                exemptCentavos = amountCentavos;
            } else {
                exemptCentavos = 0;
                args.notes.push(
                    `${allowance.code} is marked non-taxable but has no de minimis ceiling in the table — booked as TAXABLE. Map it to a ceiling in the allowance catalogue.`,
                );
            }
        }
        const taxableCentavos = amountCentavos - exemptCentavos;

        if (exemptCentavos > 0) {
            lines.push({
                kind: "earning",
                code: `ALW_${allowance.code}`,
                description: allowance.description,
                quantity: 1,
                amount: exemptCentavos,
                taxable: false,
            });
            exempt += exemptCentavos;
        }
        if (taxableCentavos > 0) {
            lines.push({
                kind: "earning",
                code: `ALW_${allowance.code}_TAXABLE`,
                description: `${allowance.description} (above de minimis ceiling / taxable)`,
                quantity: 1,
                amount: taxableCentavos,
                taxable: true,
            });
            taxable += taxableCentavos;
        }
        if (allowance.taxable) {
            args.notes.push(
                `${allowance.code} is a taxable allowance by catalogue — booked in full as taxable income.`,
            );
        }
    }

    return { lines, exempt, taxable };
}

/**
 * Totals from lines, in centavos (§6.1: sum lines, never derive a line from a
 * rounded total).
 */
export function totalsFromLines(lines: PayslipLine[]): Pick<
    PayResult,
    "gross" | "totalDeductions" | "net" | "employerCost"
> {
    let gross = 0;
    let totalDeductions = 0;
    let employerCost = 0;
    for (const line of lines) {
        if (line.kind === "earning") gross += line.amount;
        else if (line.kind === "deduction") totalDeductions += line.amount;
        else if (line.kind === "employer_cost") employerCost += line.amount;
        // `memo` lines never move money.
    }
    return { gross, totalDeductions, net: gross - totalDeductions, employerCost };
}

/** Re-exported so a caller needs one import for the hourly rate it displays. */
export { NORMAL_HOURS_PER_DAY, zeroTotals };
export { hourlyRateCentavos } from "./rates";
