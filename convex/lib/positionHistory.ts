// Position-history date rules (P12) — pure, no ctx.
//
// Two records for one employee may never cover the same day. The rule is expressed once,
// as a day-based gap, because the previous implementation closed a record ON the next
// record's effective date and that day then belonged to both of them.
import { ConvexError } from "convex/values";

export const DAY_MS = 24 * 60 * 60 * 1000;

/** The first effective date a record may have, given the one before it. */
export function earliestEffectiveAfter(previousEffective: number): number {
    return previousEffective + DAY_MS;
}

/** The last day the PREVIOUS record applies, when a new one starts on `effectiveDate`. */
export function closingEndDate(effectiveDate: number): number {
    return effectiveDate - DAY_MS;
}

/**
 * Reject a record that would share a day with its neighbour.
 *
 * `endDate` is INCLUSIVE: a record ending 2026-10-14 and the next starting 2026-10-15 is
 * contiguous and legal; 10-14/10-14 is an overlap.
 */
export function assertSpacing(args: {
    effectiveDate: number;
    previous?: { effectiveDate: number } | null;
    next?: { effectiveDate: number } | null;
}): void {
    const { effectiveDate, previous, next } = args;

    if (previous) {
        const earliest = earliestEffectiveAfter(previous.effectiveDate);
        if (effectiveDate < earliest) {
            throw new ConvexError(
                `Effective date must be at least one day after the previous position (${dateOf(previous.effectiveDate)}); earliest allowed is ${dateOf(earliest)}`,
            );
        }
    }

    if (next) {
        const latest = next.effectiveDate - DAY_MS;
        if (effectiveDate > latest) {
            throw new ConvexError(
                `Effective date must leave a day before the next position (${dateOf(next.effectiveDate)}); latest allowed is ${dateOf(latest)}`,
            );
        }
    }
}

function dateOf(ms: number): string {
    return new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Manila",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).format(new Date(ms));
}

/**
 * What a repair pass would change for one employee's history, sorted ascending.
 *
 * Every non-final record gets `endDate = next.effectiveDate − 1 day`; the final record
 * keeps `endDate` only when it is a real end date (after its own effective date), and is
 * cleared when it merely duplicated the start.
 */
export function planRepair(
    rows: { id: string; effectiveDate: number; endDate?: number }[],
): { id: string; endDate: number | undefined }[] {
    const sorted = [...rows].sort((a, b) => a.effectiveDate - b.effectiveDate);
    return sorted.map((row, index) => {
        const next = sorted[index + 1];
        if (next) {
            const close = closingEndDate(next.effectiveDate);
            return { id: row.id, endDate: close >= row.effectiveDate ? close : row.effectiveDate };
        }
        // Final record: an end date on or before its own effective date is meaningless.
        if (row.endDate !== undefined && row.endDate <= row.effectiveDate) {
            return { id: row.id, endDate: undefined };
        }
        return { id: row.id, endDate: row.endDate };
    });
}

/** True when a set of records has no shared day. Used by the repair report. */
export function hasOverlap(
    rows: { effectiveDate: number; endDate?: number }[],
): boolean {
    const sorted = [...rows].sort((a, b) => a.effectiveDate - b.effectiveDate);
    for (let index = 0; index < sorted.length - 1; index += 1) {
        const current = sorted[index];
        const next = sorted[index + 1];
        const end = current.endDate ?? Number.POSITIVE_INFINITY;
        if (end >= next.effectiveDate) return true;
    }
    return false;
}
