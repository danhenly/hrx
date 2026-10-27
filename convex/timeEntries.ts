import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import { logAudit } from "./audit";
import { DAY_MS, manilaMidnight } from "./lib/week";
import { requireAdmin, requireAuth, requireMembership } from "./helpers";

const intervalInput = v.object({
    start: v.number(), // Unix ms
    end: v.number(),   // Unix ms
});

function validateIntervals(rawIntervals: { start: number; end: number }[]) {
    if (rawIntervals.length === 0) throw new ConvexError("At least one interval is required");
    if (rawIntervals.length > 3) throw new ConvexError("Maximum of 3 intervals per day");

    const intervals = rawIntervals.map((interval) => {
        if (interval.start >= interval.end) {
            throw new ConvexError("Interval end must be after start");
        }
        const durationMinutes = Math.floor((interval.end - interval.start) / 60000);
        if (durationMinutes <= 0) throw new ConvexError("Interval duration must be positive");
        return { ...interval, durationMinutes };
    });

    const totalMinutes = intervals.reduce((sum, i) => sum + i.durationMinutes, 0);
    return { intervals, totalMinutes };
}

async function assertEmployeeOrg(ctx: any, orgId: any, employeeId: any) {
    const employee = await ctx.db.get(employeeId);
    if (!employee) throw new ConvexError("Employee not found");
    if (employee.orgId !== orgId) throw new ConvexError("Employee not in organisation");
    return employee;
}

// ─── Queries ──────────────────────────────────────────────────────────────

export const listByDateRange = query({
    args: {
        orgId: v.id("organizations"),
        startDate: v.number(),
        endDate: v.number(),
        employeeId: v.optional(v.id("employees")),
    },
    handler: async (ctx, { orgId, startDate, endDate, employeeId }) => {
        const userId = await requireAuth(ctx);
        await requireMembership(ctx, userId, orgId);

        // Both bounds are Manila-midnight anchors and `end` is inclusive: entry
        // dates are stored as midnight anchors, so lte() already covers the day.
        const start = manilaMidnight(startDate);
        const end = manilaMidnight(endDate);
        if (end < start) {
            throw new ConvexError("End date must be on or after the start date");
        }
        if (end - start > MAX_RANGE_DAYS * DAY_MS) {
            throw new ConvexError(`Date range cannot exceed ${MAX_RANGE_DAYS} days`);
        }

        if (employeeId) await assertEmployeeOrg(ctx, orgId, employeeId);

        const entries = await ctx.db
            .query("timeEntries")
            .withIndex("by_org_date", (q) =>
                q.eq("orgId", orgId).gte("date", start).lte("date", end),
            )
            .collect();

        return employeeId
            ? entries.filter((entry) => entry.employeeId === employeeId)
            : entries;
    },
});

// ─── Daily lifecycle (batch) ──────────────────────────────────────────────────
//
// The day is the submission unit: one timeEntry row is one employee-day. These
// four mutations take an explicit id list so a selection is one transaction
// instead of one round-trip per row. Ineligible rows are reported, not fatal —
// a locked day in the selection must not abort the other forty.

type BatchAction = "submit" | "approve" | "reject" | "lock";
type EntryStatus = Doc<"timeEntries">["status"];

type BatchResult = {
    applied: number;
    skipped: { entryId: Id<"timeEntries">; reason: string }[];
};

const MAX_RANGE_DAYS = 92;
const MAX_BATCH = 60;

const REQUIRED_FROM: Record<BatchAction, EntryStatus[]> = {
    submit: ["draft", "rejected"],
    approve: ["submitted"],
    reject: ["submitted"],
    lock: ["approved"],
};

const AUDIT_ACTION: Record<BatchAction, string> = {
    submit: "timeEntry.submit",
    approve: "timeEntry.approve",
    reject: "timeEntry.reject",
    lock: "timeEntry.lock",
};

function patchFor(
    action: BatchAction,
    userId: Id<"users">,
    now: number,
    reason?: string,
): Partial<Doc<"timeEntries">> {
    switch (action) {
        case "submit":
            return {
                status: "submitted",
                submittedAt: now,
                rejectedReason: undefined,
                updatedBy: userId,
            };
        case "approve":
            return {
                status: "approved",
                approvedAt: now,
                approvedBy: userId,
                rejectedReason: undefined,
                updatedBy: userId,
            };
        case "reject":
            return { status: "rejected", rejectedReason: reason, updatedBy: userId };
        case "lock":
            return { status: "locked", lockedAt: now, lockedBy: userId, updatedBy: userId };
    }
}

/** Load and org-check a batch; ids outside the org are reported, not thrown. */
async function loadBatch(
    ctx: MutationCtx,
    orgId: Id<"organizations">,
    entryIds: Id<"timeEntries">[],
): Promise<{ entries: Doc<"timeEntries">[]; skipped: BatchResult["skipped"] }> {
    const unique = [...new Set(entryIds)];
    if (unique.length === 0) throw new ConvexError("Select at least one entry");
    if (unique.length > MAX_BATCH) {
        throw new ConvexError(`Select at most ${MAX_BATCH} entries per action`);
    }

    const entries: Doc<"timeEntries">[] = [];
    const skipped: BatchResult["skipped"] = [];
    for (const entryId of unique) {
        const entry = await ctx.db.get(entryId);
        if (!entry || entry.orgId !== orgId) {
            skipped.push({ entryId, reason: "Entry not found in this organisation" });
            continue;
        }
        entries.push(entry);
    }
    return { entries, skipped };
}

/**
 * The only place a day transition is applied. Shared with the legacy week
 * wrappers in `timesheets.ts` so the guards exist in exactly one place.
 */
export async function applyStatusBatch(
    ctx: MutationCtx,
    actor: { userId: Id<"users">; role: Doc<"members">["role"] },
    entries: Doc<"timeEntries">[],
    action: BatchAction,
    reason?: string,
): Promise<BatchResult> {
    const allowed = REQUIRED_FROM[action];
    const now = Date.now();
    const skipped: BatchResult["skipped"] = [];
    let applied = 0;

    for (const entry of entries) {
        if (!allowed.includes(entry.status)) {
            skipped.push({ entryId: entry._id, reason: `Already ${entry.status}` });
            continue;
        }
        if (action === "submit" && entry.createdBy !== actor.userId && actor.role !== "admin") {
            skipped.push({
                entryId: entry._id,
                reason: "Only the creator or an admin can submit this entry",
            });
            continue;
        }
        if (action !== "submit" && actor.role !== "admin") {
            skipped.push({ entryId: entry._id, reason: "Admin role required" });
            continue;
        }

        await ctx.db.patch(entry._id, patchFor(action, actor.userId, now, reason));
        await logAudit(ctx, {
            orgId: entry.orgId,
            actorId: actor.userId,
            action: AUDIT_ACTION[action],
            entityType: "timeEntries",
            entityId: entry._id,
        });
        applied += 1;
    }

    return { applied, skipped };
}

// ─── Mutations ─────────────────────────────────────────────────────────────

export const upsertForDay = mutation({
    args: {
        orgId: v.id("organizations"),
        employeeId: v.id("employees"),
        date: v.number(),
        intervals: v.array(intervalInput),
        notes: v.optional(v.string()),
    },
    handler: async (ctx, { orgId, employeeId, date, intervals: rawIntervals, notes }) => {
        const userId = await requireAuth(ctx);
        const membership = await requireMembership(ctx, userId, orgId);
        await assertEmployeeOrg(ctx, orgId, employeeId);

        const { intervals, totalMinutes } = validateIntervals(rawIntervals);
        const day = manilaMidnight(date);
        const existing = await ctx.db
            .query("timeEntries")
            .withIndex("by_org_employee_date", (q) =>
                q.eq("orgId", orgId).eq("employeeId", employeeId).eq("date", day)
            )
            .unique();

        if (existing && !["draft", "rejected"].includes(existing.status)) {
            throw new ConvexError("Only draft or rejected entries can be edited");
        }

        if (existing) {
            const isAdmin = membership.role === "admin";
            if (existing.createdBy !== userId && !isAdmin) {
                throw new ConvexError("Only creators or admins can edit this entry");
            }
            await ctx.db.patch(existing._id, {
                intervals,
                totalMinutes,
                notes,
                status: existing.status,
                updatedBy: userId,
            });
            return existing._id;
        }

        const createdId = await ctx.db.insert("timeEntries", {
            orgId,
            employeeId,
            date: day,
            intervals,
            totalMinutes,
            notes,
            source: "manual",
            status: "draft",
            createdBy: userId,
            updatedBy: userId,
        });
        return createdId;
    },
});

export const submit = mutation({
    args: { entryId: v.id("timeEntries") },
    handler: async (ctx, { entryId }) => {
        const userId = await requireAuth(ctx);
        const entry = await ctx.db.get(entryId);
        if (!entry) throw new ConvexError("Entry not found");
        const membership = await requireMembership(ctx, userId, entry.orgId);
        if (!["draft", "rejected"].includes(entry.status)) {
            throw new ConvexError("Only draft or rejected entries can be submitted");
        }
        if (entry.createdBy !== userId && membership.role !== "admin") {
            throw new ConvexError("Only creators or admins can submit this entry");
        }
        await ctx.db.patch(entryId, { status: "submitted", updatedBy: userId, rejectedReason: undefined });
    },
});

export const approve = mutation({
    args: { entryId: v.id("timeEntries") },
    handler: async (ctx, { entryId }) => {
        const userId = await requireAuth(ctx);
        const entry = await ctx.db.get(entryId);
        if (!entry) throw new ConvexError("Entry not found");
        await requireAdmin(ctx, userId, entry.orgId);
        if (entry.status !== "submitted") {
            throw new ConvexError("Only submitted entries can be approved");
        }
        await ctx.db.patch(entryId, { status: "approved", updatedBy: userId, rejectedReason: undefined });

        await logAudit(ctx, {
            orgId: entry.orgId,
            actorId: userId,
            action: "timeEntry.approve",
            entityType: "timeEntries",
            entityId: entryId,
        });
    },
});

export const reject = mutation({
    args: { entryId: v.id("timeEntries"), reason: v.optional(v.string()) },
    handler: async (ctx, { entryId, reason }) => {
        const userId = await requireAuth(ctx);
        const entry = await ctx.db.get(entryId);
        if (!entry) throw new ConvexError("Entry not found");
        await requireAdmin(ctx, userId, entry.orgId);
        if (entry.status !== "submitted") {
            throw new ConvexError("Only submitted entries can be rejected");
        }
        await ctx.db.patch(entryId, {
            status: "rejected",
            rejectedReason: reason,
            updatedBy: userId,
        });

        await logAudit(ctx, {
            orgId: entry.orgId,
            actorId: userId,
            action: "timeEntry.reject",
            entityType: "timeEntries",
            entityId: entryId,
        });
    },
});

export const deleteDraft = mutation({
    args: { entryId: v.id("timeEntries") },
    handler: async (ctx, { entryId }) => {
        const userId = await requireAuth(ctx);
        const entry = await ctx.db.get(entryId);
        if (!entry) throw new ConvexError("Entry not found");
        const membership = await requireMembership(ctx, userId, entry.orgId);

        if (entry.status !== "draft") throw new ConvexError("Only draft entries can be deleted");
        if (entry.createdBy !== userId && membership.role !== "admin") {
            throw new ConvexError("Only creators or admins can delete this entry");
        }
        await ctx.db.delete(entryId);

        await logAudit(ctx, {
            orgId: entry.orgId,
            actorId: userId,
            action: "timeEntry.delete",
            entityType: "timeEntries",
            entityId: entryId,
        });
    },
});

// ─── Daily batch mutations ────────────────────────────────────────────────────
//
// One transaction per action. `skipped` never aborts the batch: see applyStatusBatch.

export const submitDays = mutation({
    args: {
        orgId: v.id("organizations"),
        entryIds: v.array(v.id("timeEntries")),
    },
    handler: async (ctx, { orgId, entryIds }) => {
        const userId = await requireAuth(ctx);
        const membership = await requireMembership(ctx, userId, orgId);
        const { entries, skipped } = await loadBatch(ctx, orgId, entryIds);
        const result = await applyStatusBatch(
            ctx,
            { userId, role: membership.role },
            entries,
            "submit",
        );
        return { applied: result.applied, skipped: [...skipped, ...result.skipped] };
    },
});

export const approveDays = mutation({
    args: {
        orgId: v.id("organizations"),
        entryIds: v.array(v.id("timeEntries")),
    },
    handler: async (ctx, { orgId, entryIds }) => {
        const userId = await requireAuth(ctx);
        await requireAdmin(ctx, userId, orgId);
        const { entries, skipped } = await loadBatch(ctx, orgId, entryIds);
        const result = await applyStatusBatch(
            ctx,
            { userId, role: "admin" },
            entries,
            "approve",
        );
        return { applied: result.applied, skipped: [...skipped, ...result.skipped] };
    },
});

export const rejectDays = mutation({
    args: {
        orgId: v.id("organizations"),
        entryIds: v.array(v.id("timeEntries")),
        reason: v.optional(v.string()),
    },
    handler: async (ctx, { orgId, entryIds, reason }) => {
        const userId = await requireAuth(ctx);
        await requireAdmin(ctx, userId, orgId);
        const { entries, skipped } = await loadBatch(ctx, orgId, entryIds);
        const result = await applyStatusBatch(
            ctx,
            { userId, role: "admin" },
            entries,
            "reject",
            reason,
        );
        return { applied: result.applied, skipped: [...skipped, ...result.skipped] };
    },
});

export const lockDays = mutation({
    args: {
        orgId: v.id("organizations"),
        entryIds: v.array(v.id("timeEntries")),
    },
    handler: async (ctx, { orgId, entryIds }) => {
        const userId = await requireAuth(ctx);
        await requireAdmin(ctx, userId, orgId);
        const { entries, skipped } = await loadBatch(ctx, orgId, entryIds);
        const result = await applyStatusBatch(
            ctx,
            { userId, role: "admin" },
            entries,
            "lock",
        );
        return { applied: result.applied, skipped: [...skipped, ...result.skipped] };
    },
});
