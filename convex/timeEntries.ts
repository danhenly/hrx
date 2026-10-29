import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import { logAudit } from "./audit";
import { entriesInFrozenRuns } from "./payroll/runs";
import { validateIntervals } from "./lib/intervals";
import { DAY_MS, PH_OFFSET_MS, manilaMidnight } from "./lib/week";
import { requireAdmin, requireAuth, requireMembership } from "./helpers";

const intervalInput = v.object({
    start: v.number(), // Unix ms
    end: v.number(),   // Unix ms
});

async function assertEmployeeOrg(ctx: any, orgId: any, employeeId: any) {
    const employee = await ctx.db.get(employeeId);
    if (!employee) throw new ConvexError("Employee not found");
    if (employee.orgId !== orgId) throw new ConvexError("Employee not in organisation");
    return employee;
}

/** "HH:mm" in Manila. The server's locale is not the employee's, so never toLocale*(). */
function manilaTime(ms: number) {
    const manila = new Date(ms + PH_OFFSET_MS);
    const hours = String(manila.getUTCHours()).padStart(2, "0");
    const minutes = String(manila.getUTCMinutes()).padStart(2, "0");
    return `${hours}:${minutes}`;
}

/** Bounds a payroll export: 50 employees x 7 days is 350 rows, so 2000 is 5x headroom. */
const MAX_EXPORT_ROWS = 2000;

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

export const exportRows = query({
    args: {
        orgId: v.id("organizations"),
        startDate: v.number(),
        endDate: v.number(),
        // A SET, not one status: payroll needs approved AND locked days, and
        // locking a day must not make it disappear from the export.
        statuses: v.optional(
            v.array(
                v.union(
                    v.literal("draft"),
                    v.literal("submitted"),
                    v.literal("approved"),
                    v.literal("rejected"),
                    v.literal("locked"),
                ),
            ),
        ),
    },
    handler: async (ctx, { orgId, startDate, endDate, statuses }) => {
        const userId = await requireAuth(ctx);
        await requireMembership(ctx, userId, orgId);

        const start = manilaMidnight(startDate);
        const end = manilaMidnight(endDate);
        if (end < start) {
            throw new ConvexError("End date must be on or after the start date");
        }
        if (end - start > MAX_RANGE_DAYS * DAY_MS) {
            throw new ConvexError(`Date range cannot exceed ${MAX_RANGE_DAYS} days`);
        }

        const entries = await ctx.db
            .query("timeEntries")
            .withIndex("by_org_date", (q) =>
                q.eq("orgId", orgId).gte("date", start).lte("date", end),
            )
            .collect();

        const employees = await ctx.db
            .query("employees")
            .withIndex("by_org", (q) => q.eq("orgId", orgId))
            .collect();
        const byId = new Map(
            employees.map((employee) => [employee._id as string, employee]),
        );

        const filtered =
            statuses && statuses.length > 0
                ? entries.filter((entry) => statuses.includes(entry.status))
                : entries;

        // Newest first so a payroll sheet opens on the latest days.
        const sorted = [...filtered].sort(
            (a, b) =>
                b.date - a.date ||
                String(a.employeeId).localeCompare(String(b.employeeId)),
        );

        const rows = sorted.slice(0, MAX_EXPORT_ROWS).map((entry) => {
            const employee = byId.get(entry.employeeId as string);
            return {
                employeeName: employee
                    ? `${employee.lastName}, ${employee.firstName}`
                    : "(deleted employee)",
                employeeEmail: employee?.email ?? "",
                date: entry.date,
                intervals: entry.intervals
                    .map(
                        (interval) =>
                            `${manilaTime(interval.start)}-${manilaTime(interval.end)}`,
                    )
                    .join("; "),
                totalMinutes: entry.totalMinutes,
                totalHours: (entry.totalMinutes / 60).toFixed(2),
                status: entry.status,
                rejectedReason: entry.rejectedReason ?? "",
                notes: entry.notes ?? "",
            };
        });

        return {
            startDate: start,
            endDate: end,
            rows,
            totalMinutes: filtered.reduce(
                (sum, entry) => sum + entry.totalMinutes,
                0,
            ),
            truncated: sorted.length > MAX_EXPORT_ROWS,
        };
    },
});

// ─── Daily lifecycle (batch) ──────────────────────────────────────────────────
//
// The day is the submission unit: one timeEntry row is one employee-day. These
// four mutations take an explicit id list so a selection is one transaction
// instead of one round-trip per row. Ineligible rows are reported, not fatal —
// a locked day in the selection must not abort the other forty.

type BatchAction = "submit" | "approve" | "reject" | "lock" | "unlock";
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
    unlock: ["locked"],
};

const AUDIT_ACTION: Record<BatchAction, string> = {
    submit: "timeEntry.submit",
    approve: "timeEntry.approve",
    reject: "timeEntry.reject",
    lock: "timeEntry.lock",
    unlock: "timeEntry.unlock",
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
        case "unlock":
            // The lock is evidence and stays on the document (lockedAt/lockedBy);
            // the day goes back to the employee as rejected so it must be
            // corrected and submitted again rather than silently re-approved.
            return {
                status: "rejected",
                rejectedReason: `Unlocked by admin: ${reason ?? ""}`.trim(),
                approvedAt: undefined,
                approvedBy: undefined,
                updatedBy: userId,
            };
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
 * The only place a day transition is applied: guards, patch and audit.
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

        // A rejected day has nothing to submit - an admin may clear it. Drafts stay
        // deletable by their creator; anything approved or locked is immutable.
        const isAdmin = membership.role === "admin";
        const deletable = entry.status === "draft" || (isAdmin && entry.status === "rejected");
        if (!deletable) {
            throw new ConvexError(
                "Only draft entries can be deleted (an admin may also delete a rejected entry)",
            );
        }
        if (entry.createdBy !== userId && !isAdmin) {
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

/**
 * Admin correction path out of `locked`. A reason is mandatory: the day returns
 * to the employee as rejected (never straight back to approved), the lock
 * timestamp and actor stay on the row as evidence, and the audit trail keeps the
 * correction. No bulk unlock at the week level - the selection IS the scope.
 */
export const unlockDays = mutation({
    args: {
        orgId: v.id("organizations"),
        entryIds: v.array(v.id("timeEntries")),
        reason: v.string(),
    },
    handler: async (ctx, { orgId, entryIds, reason }) => {
        const userId = await requireAuth(ctx);
        await requireAdmin(ctx, userId, orgId);

        const trimmed = reason.trim();
        if (trimmed.length < 3) {
            throw new ConvexError("A reason is required to unlock time");
        }

        const { entries, skipped } = await loadBatch(ctx, orgId, entryIds);

        // D14: a day inside an approved or paid run cannot be reopened. Allowed to
        // happen, the register would stop matching the days it was built from and no
        // filed period could be reproduced. The path out is a void + new version.
        const frozen = await entriesInFrozenRuns(ctx, orgId, entries);
        const frozenSkips = entries
            .filter((entry) => frozen.has(entry._id))
            .map((entry) => ({
                entryId: entry._id,
                reason: `Locked by ${frozen.get(entry._id)} — void the run or raise an adjustment on the next period`,
            }));
        const unlockable = entries.filter((entry) => !frozen.has(entry._id));

        const result = await applyStatusBatch(
            ctx,
            { userId, role: "admin" },
            unlockable,
            "unlock",
            trimmed,
        );
        return {
            applied: result.applied,
            skipped: [...skipped, ...frozenSkips, ...result.skipped],
        };
    },
});
