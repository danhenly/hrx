// Canonical week model for HRX: Monday 00:00 Asia/Manila, expressed as UTC ms.
//
// Every week in the app is this number. Never derive a week with Date#getDay():
// it is host-timezone dependent and the browser, Convex and CI all disagree.
// Asia/Manila is UTC+8 with no DST, so a fixed offset is exact (and cheaper than
// instantiating a TZ database lookup on every call).
export const PH_OFFSET_MS = 8 * 60 * 60 * 1000;
export const DAY_MS = 24 * 60 * 60 * 1000;
export const WEEK_MS = 7 * DAY_MS;

/** UTC ms of the Asia/Manila wall-clock midnight containing `dateMs`. */
export function manilaMidnight(dateMs: number): number {
    const shifted = dateMs + PH_OFFSET_MS;
    return Math.floor(shifted / DAY_MS) * DAY_MS - PH_OFFSET_MS;
}

/** UTC ms of Monday 00:00 Asia/Manila of the week containing `dateMs`. */
export function weekStartOf(dateMs: number): number {
    const midnight = manilaMidnight(dateMs);
    // Re-shift so getUTCDay() reads the Manila weekday, then map Mon=0..Sun=6.
    const weekday = new Date(midnight + PH_OFFSET_MS).getUTCDay();
    const daysSinceMonday = (weekday + 6) % 7;
    return midnight - daysSinceMonday * DAY_MS;
}

/** The seven day-epochs (Manila midnight) of the week starting at `weekStart`. */
export function weekDays(weekStart: number): number[] {
    return Array.from({ length: 7 }, (_, index) => weekStart + index * DAY_MS);
}

/** True when `dateMs` falls in [weekStart, weekStart + 7 days). */
export function isInWeek(dateMs: number, weekStart: number): boolean {
    return dateMs >= weekStart && dateMs < weekStart + WEEK_MS;
}
