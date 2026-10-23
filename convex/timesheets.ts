import { ConvexError, v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import { logAudit } from "./audit";
import { weekStartOf } from "./lib/week";
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

async function ensureTimesheet(
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
        // Members can submit their org's timesheets; admins may also submit on behalf of others.
        await ctx.db.patch(timesheetId, {
            status: "submitted",
            submittedAt: Date.now(),
            rejectedReason: undefined,
        });
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
        await ctx.db.patch(timesheetId, {
            status: "approved",
            approvedAt: Date.now(),
            approvedBy: userId,
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
