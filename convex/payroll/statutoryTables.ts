import { ConvexError, v } from "convex/values";
import { mutation, query } from "../_generated/server";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { logAudit } from "../audit";
import { requireAdmin, requireAuth, requireMembership } from "../helpers";
import { msOfDateKey } from "../lib/payroll/calendar";
import { semiMonthlyBrackets, assertBrackets } from "../lib/payroll/tax";
import { statutoryKindValidator } from "../schema";

// ─── Diffing (D17: the editor shows what changed, not just the new values) ──

type Flat = Record<string, number | string | boolean | null>;

/** Flatten a payload to leaf paths so a diff names the exact ceiling that moved. */
function flatten(value: unknown, prefix = ""): Flat {
    const out: Flat = {};
    if (value === null || typeof value !== "object") {
        out[prefix || "value"] = (value ?? null) as Flat[string];
        return out;
    }
    if (Array.isArray(value)) {
        value.forEach((item, index) => {
            Object.assign(out, flatten(item, `${prefix}[${index}]`));
        });
        if (value.length === 0) out[prefix] = "[]";
        return out;
    }
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) out[prefix || "value"] = "{}";
    for (const [key, child] of entries) {
        Object.assign(out, flatten(child, prefix ? `${prefix}.${key}` : key));
    }
    return out;
}

export type StatutoryDiff = {
    added: { path: string; after: Flat[string] }[];
    removed: { path: string; before: Flat[string] }[];
    changed: { path: string; before: Flat[string]; after: Flat[string] }[];
};

/** Field-level diff between two payloads. Empty sections mean "nothing moved". */
export function diffPayload(previous: unknown, next: unknown): StatutoryDiff {
    const before = flatten(previous);
    const after = flatten(next);
    const diff: StatutoryDiff = { added: [], removed: [], changed: [] };
    for (const [path, value] of Object.entries(after)) {
        if (!(path in before)) diff.added.push({ path, after: value });
        else if (before[path] !== value) {
            diff.changed.push({ path, before: before[path], after: value });
        }
    }
    for (const [path, value] of Object.entries(before)) {
        if (!(path in after)) diff.removed.push({ path, before: value });
    }
    return diff;
}

// ─── Shared helpers ────────────────────────────────────────────────────────

type Kind = "sss" | "philhealth" | "pagibig" | "tax" | "deminimis" | "holiday";

/** All rows of one kind, oldest first. */
async function rowsOfKind(ctx: QueryCtx | MutationCtx, kind: Kind) {
    return ctx.db
        .query("statutoryTables")
        .withIndex("by_kind_effective", (q) => q.eq("kind", kind))
        .order("asc")
        .collect();
}

/**
 * Per-kind structural validation. Deliberately grows with each phase's consumer:
 * validating a payload the engine cannot read yet would be theatre, but a tax
 * table with a gap silently under-withholds everyone above it, so that one is
 * checked now.
 */
function normalisePayload(kind: Kind, payload: unknown): unknown {
    if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
        throw new ConvexError("A statutory table payload must be an object");
    }
    if (kind === "tax") {
        const annual = (payload as { annualBrackets?: unknown }).annualBrackets;
        if (!Array.isArray(annual) || annual.length === 0) {
            throw new ConvexError(
                "A tax table needs an `annualBrackets` array — the semi-monthly table is derived from it",
            );
        }
        const brackets = annual as { from: number; to: number | null; base: number; rate: number }[];
        assertBrackets(brackets);
        // Never store a hand-typed semi-monthly table: re-derive it, so an edit to
        // the annual brackets cannot leave the cutoff table stale.
        return { ...(payload as object), semiMonthly: semiMonthlyBrackets(brackets) };
    }
    if (kind === "holiday") {
        const days = (payload as { days?: unknown }).days;
        if (!Array.isArray(days)) {
            throw new ConvexError("A holiday table needs a `days` array");
        }
        for (const day of days as { date?: string; name?: string; type?: string }[]) {
            if (!day.date || !day.name || !day.type) {
                throw new ConvexError(
                    "Every holiday needs a date, a name and a type",
                );
            }
            // Throws on 2026-02-30 and on a mistyped key: a silently dropped
            // holiday underpays every employee who worked it.
            msOfDateKey(day.date);
        }
        return payload;
    }
    return payload;
}

/** Ranges overlap when each starts before the other ends; open end = infinity. */
function overlaps(
    a: { effectiveFrom: number; effectiveTo?: number },
    b: { effectiveFrom: number; effectiveTo?: number },
): boolean {
    const aTo = a.effectiveTo ?? Number.POSITIVE_INFINITY;
    const bTo = b.effectiveTo ?? Number.POSITIVE_INFINITY;
    return a.effectiveFrom < bTo && b.effectiveFrom < aTo;
}

/** The row in force on a date, for the diff and for the editor's "current" card. */
async function rowInForceAt(
    ctx: QueryCtx | MutationCtx,
    kind: Kind,
    atMs: number,
    excludeId?: Id<"statutoryTables">,
) {
    const rows = await rowsOfKind(ctx, kind);
    const eligible = rows.filter(
        (row) =>
            row._id !== excludeId &&
            row.effectiveFrom <= atMs &&
            (row.effectiveTo === undefined || atMs < row.effectiveTo),
    );
    return eligible.length > 0 ? eligible[eligible.length - 1] : null;
}

// ─── Queries ───────────────────────────────────────────────────────────────

/**
 * Every statutory table, grouped by kind and ordered by effective date. Any
 * member may read national schedules; only an admin may edit them.
 */
export const list = query({
    args: { orgId: v.id("organizations") },
    handler: async (ctx, { orgId }) => {
        const userId = await requireAuth(ctx);
        await requireMembership(ctx, userId, orgId);
        const rows = await ctx.db.query("statutoryTables").collect();
        const now = Date.now();
        return rows
            .sort((a, b) =>
                a.kind === b.kind
                    ? a.effectiveFrom - b.effectiveFrom
                    : a.kind.localeCompare(b.kind),
            )
            .map((row) => ({
                ...row,
                inForce:
                    row.effectiveFrom <= now &&
                    (row.effectiveTo === undefined || now < row.effectiveTo),
                upcoming: row.effectiveFrom > now,
            }));
    },
});

/**
 * Diff a proposed payload against the table in force at that date (D17). The
 * editor calls this before saving; `upsert` returns the same shape after saving,
 * so what the admin reviewed is what was written.
 */
export const previewDiff = query({
    args: {
        orgId: v.id("organizations"),
        kind: statutoryKindValidator,
        effectiveFrom: v.string(),
        payload: v.any(),
    },
    handler: async (ctx, { orgId, kind, effectiveFrom, payload }) => {
        const userId = await requireAuth(ctx);
        await requireAdmin(ctx, userId, orgId);
        const at = msOfDateKey(effectiveFrom);
        const previous = await rowInForceAt(ctx, kind, at);
        return {
            previousEffectiveFrom: previous?.effectiveFrom ?? null,
            previousSource: previous?.source ?? null,
            diff: diffPayload(previous?.payload ?? null, payload),
        };
    },
});

// ─── Mutations ─────────────────────────────────────────────────────────────

/**
 * Insert or edit a statutory table (D17). Admin only, audited.
 *
 * Refuses overlapping ranges within a kind — two tables in force on the same day
 * means the engine's answer depends on iteration order, which is the sort of bug
 * that only shows up in a filed period. A superseded table is CLOSED by the next
 * one's start date, never deleted, so a filed period can always be recomputed
 * with the values that were in force.
 */
export const upsert = mutation({
    args: {
        orgId: v.id("organizations"),
        kind: statutoryKindValidator,
        effectiveFrom: v.string(),              // "YYYY-MM-DD" Manila
        effectiveTo: v.optional(v.string()),
        payload: v.any(),
        source: v.string(),
    },
    handler: async (ctx, args) => {
        const userId = await requireAuth(ctx);
        await requireAdmin(ctx, userId, args.orgId);

        const source = args.source.trim();
        if (source.length < 8) {
            throw new ConvexError(
                "A source citation is required on every statutory table — a number nobody can point at is indefensible in an audit",
            );
        }

        const from = msOfDateKey(args.effectiveFrom);
        const to =
            args.effectiveTo === undefined
                ? undefined
                : msOfDateKey(args.effectiveTo);
        if (to !== undefined && to <= from) {
            throw new ConvexError("Effective-to must be after effective-from");
        }

        const payload = normalisePayload(args.kind, args.payload);
        const rows = await rowsOfKind(ctx, args.kind);
        const existing = rows.find((row) => row.effectiveFrom === from) ?? null;

        for (const row of rows) {
            if (existing && row._id === existing._id) continue;
            if (overlaps({ effectiveFrom: from, effectiveTo: to }, row)) {
                throw new ConvexError(
                    `This range overlaps the ${args.kind} table already in force from ${new Date(row.effectiveFrom + 8 * 3600 * 1000).toISOString().slice(0, 10)}`,
                );
            }
        }

        const diff = diffPayload(existing?.payload ?? null, payload);

        let id: Id<"statutoryTables">;
        if (existing) {
            await ctx.db.patch(existing._id, { payload, source, effectiveTo: to });
            id = existing._id;
        } else {
            id = await ctx.db.insert("statutoryTables", {
                kind: args.kind,
                effectiveFrom: from,
                effectiveTo: to,
                payload,
                source,
            });
        }

        // Close whichever earlier row was open into this one (D17: superseded by
        // the next start, not deleted).
        const previous = rows
            .filter((row) => row.effectiveFrom < from)
            .sort((a, b) => b.effectiveFrom - a.effectiveFrom)[0];
        if (previous && previous.effectiveTo === undefined) {
            await ctx.db.patch(previous._id, { effectiveTo: from });
        }

        await logAudit(ctx, {
            orgId: args.orgId,
            actorId: userId,
            action: existing
                ? "payroll.statutoryTable.update"
                : "payroll.statutoryTable.create",
            entityType: "statutoryTables",
            entityId: id,
        });

        return { id, created: !existing, diff };
    },
});

/**
 * Delete a FUTURE table that was entered by mistake (a typo'd date, a duplicated
 * schedule). A table already in force is never removable — D17 closes ranges; it
 * does not rewrite the history a filed period was computed from.
 */
export const removeFuture = mutation({
    args: { orgId: v.id("organizations"), tableId: v.id("statutoryTables") },
    handler: async (ctx, { orgId, tableId }) => {
        const userId = await requireAuth(ctx);
        await requireAdmin(ctx, userId, orgId);

        const row = await ctx.db.get(tableId);
        if (!row) throw new ConvexError("Statutory table not found");
        if (row.effectiveFrom <= Date.now()) {
            throw new ConvexError(
                "This table is already in force — a superseded table is closed by the next one, not deleted",
            );
        }

        await ctx.db.delete(tableId);

        // Reopen the row this table had closed, or re-close it against whatever
        // now follows, so a removal cannot leave a gap or an overlap behind.
        const rows = await rowsOfKind(ctx, row.kind as Kind);
        const previous = rows
            .filter((candidate) => candidate.effectiveFrom < row.effectiveFrom)
            .sort((a, b) => b.effectiveFrom - a.effectiveFrom)[0];
        if (previous) {
            const next = rows
                .filter((candidate) => candidate.effectiveFrom > row.effectiveFrom)
                .sort((a, b) => a.effectiveFrom - b.effectiveFrom)[0];
            await ctx.db.patch(previous._id, {
                effectiveTo: next ? next.effectiveFrom : undefined,
            });
        }

        await logAudit(ctx, {
            orgId,
            actorId: userId,
            action: "payroll.statutoryTable.delete",
            entityType: "statutoryTables",
            entityId: tableId,
        });
    },
});
