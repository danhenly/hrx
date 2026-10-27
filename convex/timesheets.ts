import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import { WEEK_MS, weekStartOf } from "./lib/week";
import { requireAdmin, requireAuth, requireMembership } from "./helpers";
import { applyStatusBatch } from "./timeEntries";

/**
 * LEGACY week layer — compatibility only.
 *
 * The daily model owns the lifecycle now: one `timeEntry` row is one
 * employee-day, and `timeEntries.submitDays/approveDays/rejectDays/lockDays`
 * are the real entry points. This module exists so a bundle built before that
 * change keeps working: the write mutations resolve the week's entries and run
 * them through the same `applyStatusBatch` engine, then mirror the outcome onto
 * the legacy sheet row the old UI reads. Nothing here materialises new sheets.
 *
 * Delete this file (and the `timesheets` table) once the daily bundle is
 * confirmed live — see the plan, Phase 5.
 */

async function assertEmployeeOrg(ctx: any, orgId: any, employeeId: any) {
    const employee = await ctx.db.get(employeeId);
    if (!employee) throw new ConvexError("Employee not found");
    if (employee.orgId !== orgId) throw new ConvexError("Employee not in organisation");
    return employee;
}

// ─── Legacy reads ─────────────────────────────────────────────────────────

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

        return status ? rows.filter((row) => row.status === status) : rows;
    },
});

/** The timesheet for one employee-week, or null. Legacy read. */
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

// ─── Shared helpers ───────────────────────────────────────────────────────

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

/** All entries for one employee-week. The week's real state, day by day. */
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
 * Mirror a day-level outcome onto the legacy sheet so the old UI is coherent
 * for the rest of its deploy window. Dies with this file.
 */
async function mirrorSheet(
    ctx: MutationCtx,
    sheet: Doc<"timesheets">,
    action: "submit" | "approve" | "reject" | "lock",
    userId: Id<"users">,
    reason?: string,
) {
    const now = Date.now();
    const status: Doc<"timesheets">["status"] =
        action === "submit"
            ? "submitted"
            : action === "approve"
              ? "approved"
              : action === "reject"
                ? "rejected"
                : "locked";

    await ctx.db.patch(sheet._id, {
        status,
        submittedAt: action === "submit" ? now : sheet.submittedAt,
        approvedAt: action === "approve" ? now : sheet.approvedAt,
        approvedBy: action === "approve" ? userId : sheet.approvedBy,
        lockedAt: action === "lock" ? now : sheet.lockedAt,
        lockedBy: action === "lock" ? userId : sheet.lockedBy,
        rejectedReason: action === "reject" ? reason : sheet.rejectedReason,
    });
}

async function applyWeekAction(
    ctx: MutationCtx,
    sheet: Doc<"timesheets">,
    actor: { userId: Id<"users">; role: Doc<"members">["role"] },
    action: "submit" | "approve" | "reject" | "lock",
    reason?: string,
) {
    const entries = await weekEntriesFor(
        ctx,
        sheet.orgId,
        sheet.employeeId,
        sheet.weekStart,
    );
    const result = await applyStatusBatch(ctx, actor, entries, action, reason);
    if (result.applied > 0) await mirrorSheet(ctx, sheet, action, actor.userId, reason);
    return result;
}

// ─── Legacy write paths (re-pointed at the daily engine) ──────────────────

export const submitForWeek = mutation({
    args: {
        orgId: v.id("organizations"),
        employeeId: v.id("employees"),
        weekStart: v.number(),
    },
    handler: async (ctx, { orgId, employeeId, weekStart }) => {
        const userId = await requireAuth(ctx);
        const membership = await requireMembership(ctx, userId, orgId);
        await assertEmployeeOrg(ctx, orgId, employeeId);

        const sheet = await ensureTimesheet(ctx, orgId, employeeId, weekStartOf(weekStart));
        if (sheet.status === "locked") throw new ConvexError("This week is locked");

        const result = await applyWeekAction(
            ctx,
            sheet,
            { userId, role: membership.role },
            "submit",
        );
        if (result.applied === 0 && result.skipped.length > 0) {
            throw new ConvexError(result.skipped[0].reason);
        }
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

export const submit = mutation({
    args: { timesheetId: v.id("timesheets") },
    handler: async (ctx, { timesheetId }) => {
        const userId = await requireAuth(ctx);
        const sheet = await ctx.db.get(timesheetId);
        if (!sheet) throw new ConvexError("Timesheet not found");
        const membership = await requireMembership(ctx, userId, sheet.orgId);
        await applyWeekAction(ctx, sheet, { userId, role: membership.role }, "submit");
    },
});

export const approve = mutation({
    args: { timesheetId: v.id("timesheets") },
    handler: async (ctx, { timesheetId }) => {
        const userId = await requireAuth(ctx);
        const sheet = await ctx.db.get(timesheetId);
        if (!sheet) throw new ConvexError("Timesheet not found");
        await requireAdmin(ctx, userId, sheet.orgId);
        await applyWeekAction(ctx, sheet, { userId, role: "admin" }, "approve");
    },
});

export const reject = mutation({
    args: { timesheetId: v.id("timesheets"), reason: v.optional(v.string()) },
    handler: async (ctx, { timesheetId, reason }) => {
        const userId = await requireAuth(ctx);
        const sheet = await ctx.db.get(timesheetId);
        if (!sheet) throw new ConvexError("Timesheet not found");
        await requireAdmin(ctx, userId, sheet.orgId);
        await applyWeekAction(ctx, sheet, { userId, role: "admin" }, "reject", reason);
    },
});

export const lock = mutation({
    args: { timesheetId: v.id("timesheets") },
    handler: async (ctx, { timesheetId }) => {
        const userId = await requireAuth(ctx);
        const sheet = await ctx.db.get(timesheetId);
        if (!sheet) throw new ConvexError("Timesheet not found");
        await requireAdmin(ctx, userId, sheet.orgId);
        await applyWeekAction(ctx, sheet, { userId, role: "admin" }, "lock");
    },
});
