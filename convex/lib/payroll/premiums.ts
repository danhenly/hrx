// Day pricing (P1.1, P1.2) — the §2.5 matrix as DATA, and one function that turns
// a frozen day record into earning lines.
//
// Pure: no ctx, no DB, ConvexError only. Money is integer centavos and every line
// is rounded on its own, because a payslip whose lines do not add up to its totals
// is a support ticket with a number attached.
//
// TWO AXES, NOT ONE. A holiday can fall on a Sunday, so "which holiday is it" and
// "is it a rest day" are independent questions and the premiums stack
// multiplicatively: a regular holiday worked on a rest day is 200% × 130%.
import { ConvexError } from "convex/values";
import { PH_OFFSET_MS } from "./calendar";
import { dailyRateCentavos, roundHalfUp } from "./rates";
import type { DayType, Money, PayTerms, PayslipLine } from "./types";

const MINUTES_PER_HOUR = 60;

/** Labor Code Art. 83 — normal hours of work in a day. Hours past this are OT. */
export const NORMAL_HOURS = 8;
export const NORMAL_MINUTES_PER_DAY = NORMAL_HOURS * MINUTES_PER_HOUR;

/** Night differential window (Art. 86): 22:00–06:00 Manila. */
export const NIGHT_START_HOUR = 22;
export const NIGHT_END_HOUR = 6;

/** Art. 86: not less than 10% of the regular wage for each hour worked at night. */
export const NIGHT_DIFFERENTIAL_RATE = 0.1;

/**
 * §2.5 as data. `worked`/`workedRestDay` are the multiplier on the hourly rate for
 * the first eight hours; `ot`/`otRestDay` apply to hours beyond them; `unworked`
 * is what an unworked day pays a DAILY-paid employee (0 = "no work, no pay").
 *
 * A DOLE advisory change is an edit to this table plus a fixture — never a
 * refactor of five call sites.
 */
export const PREMIUM_MATRIX: Record<
    DayType,
    {
        worked: number;
        workedRestDay: number;
        unworked: number;
        ot: number;
        otRestDay: number;
    }
> = {
    // Regular holiday: 200% worked, ×130% OT, 200%×130% on a rest day.
    regular: { worked: 2, workedRestDay: 2.6, unworked: 1, ot: 1.3, otRestDay: 1.3 },
    // Special non-working: 130% worked, ×130% OT, 150% on a rest day.
    special_non_working: {
        worked: 1.3,
        workedRestDay: 1.5,
        unworked: 0,
        ot: 1.3,
        otRestDay: 1.3,
    },
    // Special working: 100% worked, ×125% OT, no rest-day premium (§2.5 "—").
    special_working: {
        worked: 1,
        workedRestDay: 1,
        unworked: 0,
        ot: 1.25,
        otRestDay: 1.25,
    },
    // Ordinary: 100%, ×125% OT, 130% on a rest day, ×130% OT there.
    ordinary: { worked: 1, workedRestDay: 1.3, unworked: 0, ot: 1.25, otRestDay: 1.3 },
};

export type DayClassification = { dayType: DayType; isRestDay: boolean };

/** Minutes of an interval that fall inside the Manila night window. */
export function nightMinutesInInterval(start: number, end: number): number {
    if (end <= start) return 0;
    let minutes = 0;
    let cursor = start;
    while (cursor < end) {
        // Advance to the next whole Manila hour so each slice has one local hour.
        const manila = cursor + PH_OFFSET_MS;
        const nextHour = Math.floor(manila / 3_600_000) * 3_600_000 + 3_600_000;
        const sliceEnd = Math.min(end, nextHour - PH_OFFSET_MS);
        const hour = new Date(manila).getUTCHours();
        if (hour >= NIGHT_START_HOUR || hour < NIGHT_END_HOUR) {
            minutes += (sliceEnd - cursor) / 60_000;
        }
        cursor = sliceEnd;
    }
    return Math.round(minutes);
}

/** Night minutes across a day's intervals. A shift crossing midnight is included. */
export function nightMinutes(intervals: { start: number; end: number }[]): number {
    return intervals.reduce(
        (sum, interval) => sum + nightMinutesInInterval(interval.start, interval.end),
        0,
    );
}

/**
 * Is this day ALREADY PAID by the monthly rate?
 *
 * Rest days and regular holidays are paid whether worked or not, so a monthly-paid
 * employee working them earns only the premium. A SPECIAL NON-WORKING day is "no
 * work, no pay" (RA 9492 / §2.5), so it is NOT in the monthly rate: working it pays
 * the full 130%, and not working it is an absence (auto-deducted by the engine).
 *
 * Getting this backwards is the quiet error: treating a special non-working day as
 * "in the rate" pays +30% for a day the employee was never paid for.
 */
export function isInMonthlyRate(dayType: DayType): boolean {
    return dayType !== "special_non_working";
}

/** The earning code a worked day is booked under. */
export function earningCodeFor(classification: DayClassification): string {
    if (classification.dayType === "regular") return "RH";
    if (
        classification.dayType === "special_non_working" ||
        classification.dayType === "special_working"
    ) {
        return "SH";
    }
    return classification.isRestDay ? "RD" : "BASIC";
}

export type DayPrice = {
    lines: PayslipLine[];
    workedMinutes: number;
    otMinutes: number;
    nightMinutes: number;
};

/**
 * Price ONE frozen day (P1.1).
 *
 * MONTHLY-paid (D8): the monthly rate already covers ordinary days and unworked
 * regular holidays, so a worked day books the PREMIUM ONLY (a rest day = +30%, a
 * regular holiday = +100%, an ordinary day = nothing). Booking the full day would
 * pay a monthly-paid employee twice for every ordinary day.
 *
 * DAILY-paid: the day books at its full multiplier, and an unworked regular
 * holiday is a real 100% line — but only if the person worked the day before,
 * which is the rule that stops a naive engine overpaying every holiday.
 */
export function priceDay(args: {
    date: number;
    totalMinutes: number;
    intervals: { start: number; end: number }[];
    classification: DayClassification;
    terms: PayTerms;
    /** Whether the employee has a worked day immediately before this one. */
    priorDayWorked: boolean;
}): DayPrice {
    const { classification, terms } = args;
    const matrix = PREMIUM_MATRIX[classification.dayType];
    if (!matrix) {
        throw new ConvexError(`Unknown day type "${classification.dayType}"`);
    }

    // Money is derived from the DAILY rate per minute and rounded once per line.
    // Rounding the hourly rate first and multiplying it back up drifts by cents per
    // day (₱645.00/day becomes ₱645.04), which is exactly the kind of difference a
    // payroll clerk notices and nobody can explain.
    const dailyCentavos = dailyRateCentavos(terms);
    const perMinute = dailyCentavos / NORMAL_MINUTES_PER_DAY;
    /** Hourly rate in centavos, for display on the line only. */
    const hourly = Math.round(dailyCentavos / NORMAL_HOURS);

    const workedMinutes = Math.max(0, Math.min(args.totalMinutes, 8 * 60 * 2));
    const isMonthly = terms.payType === "monthly";
    /** Monthly-paid: book the premium only, unless the day is not in the rate. */
    const premiumOnly = isMonthly && isInMonthlyRate(classification.dayType);
    const lines: PayslipLine[] = [];

    if (workedMinutes === 0) {
        // Unworked regular holiday: a real line for daily/hourly pay, nothing for
        // monthly (already in the rate), and nothing at all for any other day type
        // ("no work, no pay").
        if (!isMonthly && classification.dayType === "regular") {
            if (args.priorDayWorked) {
                lines.push({
                    kind: "earning",
                    code: "RH_UNWORKED",
                    description: "Unworked regular holiday (100%)",
                    quantity: NORMAL_MINUTES_PER_DAY / MINUTES_PER_HOUR,
                    rate: hourly,
                    amount: roundHalfUp(
                        perMinute * NORMAL_MINUTES_PER_DAY * matrix.unworked,
                    ),
                    taxable: true,
                    source: { type: "timeEntry", id: String(args.date) },
                });
            }
            // Not worked the day before: no holiday pay. Stated as a comment
            // rather than a zero line, so the absence is a rule, not an omission.
        }
        return {
            lines,
            workedMinutes: 0,
            otMinutes: 0,
            nightMinutes: 0,
        };
    }

    const normalMinutes = Math.min(workedMinutes, NORMAL_MINUTES_PER_DAY);
    const otMinutes = workedMinutes - normalMinutes;
    const multiplier = classification.isRestDay
        ? matrix.workedRestDay
        : matrix.worked;
    const code = earningCodeFor(classification);

    const grossAmount = perMinute * normalMinutes * multiplier;
    const amount = premiumOnly
        ? // Only the part above 100% is new money for a monthly-paid employee.
          roundHalfUp(perMinute * normalMinutes * (multiplier - 1))
        : roundHalfUp(grossAmount);

    if (amount > 0) {
        lines.push({
            kind: "earning",
            code,
            description: describeDay(code, classification, multiplier, premiumOnly),
            quantity: normalMinutes / MINUTES_PER_HOUR,
            rate: hourly,
            amount,
            taxable: true,
            source: { type: "timeEntry", id: String(args.date) },
        });
    }

    if (otMinutes > 0) {
        const otMultiplier = classification.isRestDay
            ? matrix.otRestDay
            : matrix.ot;
        // Overtime is never inside the monthly rate, so both pay types book it in
        // full — the first 125%/130% is new money either way.
        lines.push({
            kind: "earning",
            code: "OT",
            description: `Overtime (${Math.round(otMultiplier * 100)}%)`,
            quantity: otMinutes / MINUTES_PER_HOUR,
            rate: hourly,
            amount: roundHalfUp(perMinute * otMinutes * otMultiplier),
            taxable: true,
            source: { type: "timeEntry", id: String(args.date) },
        });
    }

    const night = nightMinutes(args.intervals);
    if (night > 0) {
        lines.push({
            kind: "earning",
            code: "ND",
            description: "Night differential (10%, 22:00–06:00)",
            quantity: night / MINUTES_PER_HOUR,
            rate: hourly,
            amount: roundHalfUp(perMinute * night * NIGHT_DIFFERENTIAL_RATE),
            taxable: true,
            source: { type: "timeEntry", id: String(args.date) },
        });
    }

    return { lines, workedMinutes, otMinutes, nightMinutes: night };
}

function describeDay(
    code: string,
    classification: DayClassification,
    multiplier: number,
    monthlyPremiumOnly: boolean,
): string {
    const pct = Math.round(multiplier * 100);
    if (monthlyPremiumOnly) {
        return `${
            classification.dayType === "regular"
                ? "Regular holiday"
                : classification.dayType === "special_non_working"
                  ? "Special non-working day"
                  : classification.isRestDay
                    ? "Rest day"
                    : "Ordinary day"
        } premium (+${pct - 100}%, already in monthly rate)`;
    }
    switch (code) {
        case "RH":
            return `Regular holiday worked (${pct}%)`;
        case "SH":
            return `Special day worked (${pct}%)`;
        case "RD":
            return `Rest day worked (${pct}%)`;
        default:
            return "Basic pay for the day (100%)";
    }
}

/** Money-aware helper for callers that only need the day's total. */
export function dayTotalCentavos(lines: PayslipLine[]): Money {
    return lines.reduce((sum, line) => sum + line.amount, 0);
}
