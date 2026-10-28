// Manila-date classification and rest-day logic for payroll (P0.4).
//
// Pure and node-runnable: no ctx, no generated types. The one non-stdlib import
// is ConvexError, because a plain Error is relayed to the client as a generic
// "Server Error" and the message telling the user WHICH date failed is lost.
//
// Every date here is a Manila WALL-CLOCK day, stored as Manila midnight in UTC ms
// (Date.UTC(y, m-1, d) - 8h). Formatting with toISOString() or local getters
// reads the previous day for a UTC+8 viewer — that shipped as a real bug in
// Phase 1, so this module never calls either.
import { ConvexError } from "convex/values";
import type { DayType, HolidayRule, WorkWeek } from "./types";

export const PH_OFFSET_MS = 8 * 60 * 60 * 1000;
export const DAY_MS = 24 * 60 * 60 * 1000;

const DATE_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** UTC ms of the Manila midnight containing `ms`. */
export function manilaMidnight(ms: number): number {
    const shifted = ms + PH_OFFSET_MS;
    return Math.floor(shifted / DAY_MS) * DAY_MS - PH_OFFSET_MS;
}

/** "YYYY-MM-DD" for a Manila day anchor. */
export function dateKeyOf(ms: number): string {
    const manila = new Date(manilaMidnight(ms) + PH_OFFSET_MS);
    const year = manila.getUTCFullYear();
    const month = String(manila.getUTCMonth() + 1).padStart(2, "0");
    const day = String(manila.getUTCDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

/** Manila midnight in UTC ms for a "YYYY-MM-DD" wall-clock date. */
export function msOfDateKey(key: string): number {
    const match = DATE_KEY.exec(key);
    if (!match) {
        throw new ConvexError(`Invalid date "${key}" — expected YYYY-MM-DD`);
    }
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const anchor = Date.UTC(year, month - 1, day) - PH_OFFSET_MS;
    // Round-trip rather than trust the input: 2026-02-30 silently rolls over.
    if (dateKeyOf(anchor) !== key) {
        throw new ConvexError(`Invalid date "${key}" — that day does not exist`);
    }
    return anchor;
}

/** Manila weekday of a day anchor. 0 = Sunday … 6 = Saturday. */
export function weekdayOf(ms: number): number {
    return new Date(manilaMidnight(ms) + PH_OFFSET_MS).getUTCDay();
}

/**
 * Sunday is always a rest day; Saturday is a rest day on a 5-day week (D7 pairs
 * 261 with 5 days and 313 with 6, so a 5-day org must not count Saturdays).
 */
export function isRestDay(ms: number, workWeek: WorkWeek): boolean {
    const weekday = weekdayOf(ms);
    if (weekday === 0) return true;
    return workWeek === "5_day" && weekday === 6;
}

/** Official holidays indexed by date key, newest entry wins. */
export function indexHolidays(holidays: HolidayRule[]): Map<string, HolidayRule> {
    const index = new Map<string, HolidayRule>();
    for (const holiday of holidays) {
        // A key may roll over validation: a blank/misspelt date must fail loudly
        // at seed time, not quietly vanish from the calendar.
        msOfDateKey(holiday.date);
        index.set(holiday.date, holiday);
    }
    return index;
}

/** The holiday falling on a Manila day, if any. */
export function holidayOn(
    ms: number,
    holidays: HolidayRule[] | Map<string, HolidayRule>,
): HolidayRule | undefined {
    const index =
        holidays instanceof Map ? holidays : indexHolidays(holidays);
    return index.get(dateKeyOf(ms));
}

/**
 * Day classification (P0.4). Rest days are NOT a day type here — a holiday can
 * fall on a Sunday, and the premium matrix stacks holiday × rest day (§2.5), so
 * the two are independent axes. Ask `isRestDay()` alongside this.
 */
export function classifyDay(
    ms: number,
    holidays: HolidayRule[] | Map<string, HolidayRule>,
): DayType {
    const holiday = holidayOn(ms, holidays);
    if (holiday) return holiday.type;
    return "ordinary";
}

/** Every Manila day anchor in [start, end], both inclusive. */
export function eachDay(startMs: number, endMs: number): number[] {
    const start = manilaMidnight(startMs);
    const end = manilaMidnight(endMs);
    if (end < start) {
        throw new ConvexError("End date must not be before the start date");
    }
    const days: number[] = [];
    for (let cursor = start; cursor <= end; cursor += DAY_MS) days.push(cursor);
    return days;
}

/**
 * Working days in an inclusive window, excluding rest days.
 *
 * Holidays are NOT subtracted: a regular holiday is a PAID day whose pricing is
 * its own line (D8, P1). Treating it as a non-working day here would prorate a
 * monthly-paid employee down for a holiday they are entitled to.
 */
export function workDaysInRange(
    startMs: number,
    endMs: number,
    workWeek: WorkWeek,
): number {
    return eachDay(startMs, endMs).filter((day) => !isRestDay(day, workWeek))
        .length;
}
