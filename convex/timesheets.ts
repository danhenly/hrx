import { ConvexError, v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { Doc } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import { logAudit } from "./audit";
import { WEEK_MS, weekStartOf } from "./lib/week";
import { requireAdmin, requireAuth, requireMembership } from "./helpers";

async function assertEmployeeOrg(ctx: any, orgId: any, employeeId: any) {
    const employee = await ctx.db.get(employeeId);
    if (!employee) throw new ConvexError("Employee not found");
    if (employee.orgId !== orgId) throw new ConvexError("Employee not in organisation");
    return employee;
}

// ─── Queries ──────────────────────────────────────────────────────────────

export const listForOrg = query({
    args: {
        orgId: v.id("organizations"),
        status: v.optional(v.union(
            v.literal("open"),
            v.literal("submitted"),
            v.literal("approved"),
            v.literal("rejected"),
            v.literal("locked"),
        )),
        weekStart: v.optional(v.number()),
    },
    handler: async (ctx, { orgId, status, weekStart }) => {
        const userId = await requireAuth(ctx);
        await requireMembership(ctx, userId, orgId);

        const rows = weekStart === undefined
            ? await ctx.db
                .query("timesheets")
                .withIndex("by_org", (q) => q.eq("orgId", orgId))
                .collect()
            : await ctx.db
                .query("timesheets")
                .withIndex("by_org_week", (q) =>
                    q.eq("orgId", orgId).eq("weekStart", weekStartOf(weekStart)),
                )
                .collect();

        // JS status filter: there is no (orgId, status) index; adding one is a
        // recorded deferral, not worth a second schema push this phase.
        return status ? rows.filter((row) => row.status === status) : rows;
    },
});

export async function ensureTimesheet(
    ctx: MutationCtx,
    orgId: Id<"organizations">,
    employeeId: Id<"employees">,
    weekStart: number,
) {
    const existing = await ctx.db
        .query("timesheets")
        .withIndex("by_org_employee_week", (q) =>
            q.eq("orgId", orgId).eq("employeeId", employeeId).eq("weekStart", weekStart),
        )
        .unique();
    if (existing) return existing;
    const timesheetId = await ctx.db.insert("timesheets", {
        orgId,
        employeeId,
        weekStart,
        status: "open",
        totalMinutes: 0,
    });
    const created = await ctx.db.get(timesheetId);
    if (!created) throw new ConvexError("Failed to create timesheet");
    return created;
}

/** All entries for one employee-week, in date order. */
export async function weekEntriesFor(
    ctx: MutationCtx,
    orgId: Id<"organizations">,
    employeeId: Id<"employees">,
    weekStart: number,
) {
    return ctx.db
        .query("timeEntries")
        .withIndex("by_org_employee_date", (q) =>
            q.eq("orgId", orgId)
                .eq("employeeId", employeeId)
                .gte("date", weekStart)
                .lt("date", weekStart + WEEK_MS),
        )
        .collect();
}

/**
 * Materialise the sheet for a week and keep its total honest. Called whenever an
 * entry is written or removed, so a week with drafts *has* a timesheet row for
 * the Timesheets page to list (previously nothing ever created one, which is why
 * drafts and submitted weeks were invisible there).
 */
export async function syncSheetForWeek(
    ctx: MutationCtx,
    orgId: Id<"organizations">,
    employeeId: Id<"employees">,
    weekStart: number,
) {
    const sheet = await ensureTimesheet(ctx, orgId, employeeId, weekStart);
    // Frozen states keep the total they were approved with; edits are blocked
    // before they can reach here, so this is defence in depth only.
    if (!["open", "rejected"].includes(sheet.status)) return sheet;

    const entries = await weekEntriesFor(ctx, orgId, employeeId, weekStart);
    const totalMinutes = entries.reduce((sum, entry) => sum + entry.totalMinutes, 0);
    if (sheet.totalMinutes !== totalMinutes) {
        await ctx.db.patch(sheet._id, { totalMinutes });
    }
    return sheet;
}

/** Shared submit path: total the week, then flip the sheet and every child together. */
async function submitWeekInternal(
    ctx: MutationCtx,
    userId: Id<"users">,
    sheet: Doc<"timesheets">,
) {
    const entries = await weekEntriesFor(
        ctx,
        sheet.orgId,
        sheet.employeeId,
        sheet.weekStart,
    );
    if (entries.length === 0) throw new ConvexError("No time entries for this week");

    const editable = entries.filter(
        (entry) => entry.status === "draft" || entry.status === "rejected",
    );
    if (editable.length !== entries.length) {
        throw new ConvexError("Some entries in this week are already submitted or approved");
    }

    const totalMinutes = entries.reduce((sum, entry) => sum + entry.totalMinutes, 0);
    const now = Date.now();

    for (const entry of entries) {
        await ctx.db.patch(entry._id, {
            status: "submitted",
            timesheetId: sheet._id,
            rejectedReason: undefined,
            updatedBy: userId,
        });
    }

    await ctx.db.patch(sheet._id, {
        status: "submitted",
        submittedAt: now,
        totalMinutes,
        rejectedReason: undefined,
    });

    await logAudit(ctx, {
        orgId: sheet.orgId,
        actorId: userId,
        action: "timesheet.submit",
        entityType: "timesheets",
        entityId: sheet._id,
    });
}

export const submitForWeek = mutation({
    args: {
        orgId: v.id("organizations"),
        employeeId: v.id("employees"),
        weekStart: v.number(),
    },
    handler: async (ctx, { orgId, employeeId, weekStart }) => {
        const userId = await requireAuth(ctx);
        await requireMembership(ctx, userId, orgId);
        await assertEmployeeOrg(ctx, orgId, employeeId);

        const week = weekStartOf(weekStart);
        const sheet = await ensureTimesheet(ctx, orgId, employeeId, week);
        if (!["open", "rejected"].includes(sheet.status)) {
            throw new ConvexError(`This week is already ${sheet.status}`);
        }
        await submitWeekInternal(ctx, userId, sheet);
        return sheet._id;
    },
});

export const getOrCreate = mutation({
    args: {
        orgId: v.id("organizations"),
        employeeId: v.id("employees"),
        weekStart: v.number(),
    },
    handler: async (ctx, { orgId, employeeId, weekStart }) => {
        const userId = await requireAuth(ctx);
        await requireMembership(ctx, userId, orgId);
        await assertEmployeeOrg(ctx, orgId, employeeId);

        const sheet = await ensureTimesheet(ctx, orgId, employeeId, weekStartOf(weekStart));
        return sheet._id;
    },
});

/** The timesheet for one employee-week, or null. Drives the entry grid's lock state. */
export const getForWeek = query({
    args: {
        orgId: v.id("organizations"),
        employeeId: v.id("employees"),
        weekStart: v.number(),
    },
    handler: async (ctx, { orgId, employeeId, weekStart }) => {
        const userId = await requireAuth(ctx);
        await requireMembership(ctx, userId, orgId);
        return ctx.db
            .query("timesheets")
            .withIndex("by_org_employee_week", (q) =>
                q.eq("orgId", orgId)
                    .eq("employeeId", employeeId)
                    .eq("weekStart", weekStartOf(weekStart)),
            )
            .unique();
    },
});

// ─── Mutations ─────────────────────────────────────────────────────────────

export const submit = mutation({
    args: { timesheetId: v.id("timesheets") },
    handler: async (ctx, { timesheetId }) => {
        const userId = await requireAuth(ctx);
        const timesheet = await ctx.db.get(timesheetId);
        if (!timesheet) throw new ConvexError("Timesheet not found");
        await requireMembership(ctx, userId, timesheet.orgId);
        if (!["open", "rejected"].includes(timesheet.status)) {
            throw new ConvexError("Only open or rejected timesheets can be submitted");
        }
        // Same transactional path as submitForWeek: total the week and mirror the
        // status onto every entry, instead of flipping the sheet alone.
        await submitWeekInternal(ctx, userId, timesheet);
    },
});

export const approve = mutation({
    args: { timesheetId: v.id("timesheets") },
    handler: async (ctx, { timesheetId }) => {
        const userId = await requireAuth(ctx);
        const timesheet = await ctx.db.get(timesheetId);
        if (!timesheet) throw new ConvexError("Timesheet not found");
        await requireAdmin(ctx, userId, timesheet.orgId);
        if (timesheet.status !== "submitted") {
            throw new ConvexError("Only submitted timesheets can be approved");
        }
        const entries = await ctx.db
            .query("timeEntries")
            .withIndex("by_timesheet", (q) => q.eq("timesheetId", timesheetId))
            .collect();
        if (entries.length === 0) {
            throw new ConvexError("Timesheet has no entries to approve");
        }

        const now = Date.now();
        for (const entry of entries) {
            await ctx.db.patch(entry._id, {
                status: "approved",
                rejectedReason: undefined,
                updatedBy: userId,
            });
        }

        await ctx.db.patch(timesheetId, {
            status: "approved",
            approvedAt: now,
            approvedBy: userId,
            // Recomputed from the children: approve is the last moment stale
            // totals can be caught.
            totalMinutes: entries.reduce((sum, entry) => sum + entry.totalMinutes, 0),
            rejectedReason: undefined,
        });

        await logAudit(ctx, {
            orgId: timesheet.orgId,
            actorId: userId,
            action: "timesheet.approve",
            entityType: "timesheets",
            entityId: timesheetId,
        });
    },
});

export const reject = mutation({
    args: { timesheetId: v.id("timesheets"), reason: v.optional(v.string()) },
    handler: async (ctx, { timesheetId, reason }) => {
        const userId = await requireAuth(ctx);
        const timesheet = await ctx.db.get(timesheetId);
        if (!timesheet) throw new ConvexError("Timesheet not found");
        await requireAdmin(ctx, userId, timesheet.orgId);
        if (timesheet.status !== "submitted") {
            throw new ConvexError("Only submitted timesheets can be rejected");
        }
        const entries = await ctx.db
            .query("timeEntries")
            .withIndex("by_timesheet", (q) => q.eq("timesheetId", timesheetId))
            .collect();
        for (const entry of entries) {
            await ctx.db.patch(entry._id, {
                status: "rejected",
                rejectedReason: reason,
                updatedBy: userId,
            });
        }

        await ctx.db.patch(timesheetId, {
            status: "rejected",
            rejectedReason: reason,
        });

        await logAudit(ctx, {
            orgId: timesheet.orgId,
            actorId: userId,
            action: "timesheet.reject",
            entityType: "timesheets",
            entityId: timesheetId,
        });
    },
});

export const lock = mutation({
    args: { timesheetId: v.id("timesheets") },
    handler: async (ctx, { timesheetId }) => {
        const userId = await requireAuth(ctx);
        const timesheet = await ctx.db.get(timesheetId);
        if (!timesheet) throw new ConvexError("Timesheet not found");
        await requireAdmin(ctx, userId, timesheet.orgId);
        if (timesheet.status !== "approved") {
            throw new ConvexError("Only approved timesheets can be locked");
        }
        await ctx.db.patch(timesheetId, {
            status: "locked",
            lockedAt: Date.now(),
            lockedBy: userId,
        });

        await logAudit(ctx, {
            orgId: timesheet.orgId,
            actorId: userId,
            action: "timesheet.lock",
            entityType: "timesheets",
            entityId: timesheetId,
        });
    },
});
