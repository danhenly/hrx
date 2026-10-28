// Interval arithmetic for ONE employee-day, shared by every write path.
//
// Pure apart from ConvexError (so the message reaches the client instead of a
// generic "Server Error"), which also means the rules can be exercised directly
// under node — see the checks in the PR.
//
// A day holds one to three intervals. A shift crossing midnight is legal and
// counted on its START date (existing behaviour), which is why the 24-hour cap is
// on the day's TOTAL and not on a single interval.
import { ConvexError } from "convex/values";

export type RawInterval = { start: number; end: number };
export type ValidInterval = RawInterval & { durationMinutes: number };

const MAX_INTERVALS = 3;
const MINUTE_MS = 60_000;
const MAX_MINUTES_PER_DAY = 24 * 60;

export function validateIntervals(rawIntervals: RawInterval[]): {
    intervals: ValidInterval[];
    totalMinutes: number;
} {
    if (rawIntervals.length === 0) {
        throw new ConvexError("At least one interval is required");
    }
    if (rawIntervals.length > MAX_INTERVALS) {
        throw new ConvexError(`Maximum of ${MAX_INTERVALS} intervals per day`);
    }

    const intervals = rawIntervals
        .map((interval) => {
            if (interval.start >= interval.end) {
                throw new ConvexError("Interval end must be after start");
            }
            const durationMinutes = Math.floor((interval.end - interval.start) / MINUTE_MS);
            if (durationMinutes <= 0) {
                throw new ConvexError("Interval duration must be positive");
            }
            return { ...interval, durationMinutes };
        })
        // Canonical order, so the overlap scan below needs one pass and stored
        // rows always read earliest-first.
        .sort((a, b) => a.start - b.start);

    // Touching intervals (09:00-12:00, 12:00-18:00) are legal. An overlap pays the
    // same minute twice, so it is not.
    for (let index = 1; index < intervals.length; index += 1) {
        const previous = intervals[index - 1];
        const current = intervals[index];
        if (current.start < previous.end) {
            throw new ConvexError("Time intervals cannot overlap");
        }
    }

    const totalMinutes = intervals.reduce(
        (sum, interval) => sum + interval.durationMinutes,
        0,
    );
    if (totalMinutes > MAX_MINUTES_PER_DAY) {
        throw new ConvexError("A single day cannot exceed 24 hours");
    }

    return { intervals, totalMinutes };
}
