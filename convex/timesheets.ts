import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
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
    },
    handler: async (ctx, { orgId, status }) => {
        const userId = await requireAuth(ctx);
        await requireMembership(ctx, userId, orgId);

        const rows = await ctx.db
            .query("timesheets")
            .withIndex("by_org", (q) => q.eq("orgId", orgId))
            .collect();

        return status ? rows.filter((row) => row.status === status) : rows;
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

        const existing = await ctx.db
            .query("timesheets")
            .withIndex("by_org_week", (q) => q.eq("orgId", orgId).eq("weekStart", weekStart))
            .filter((q) => q.eq(q.field("employeeId"), employeeId))
            .unique();

        if (existing) return existing._id;

        return ctx.db.insert("timesheets", {
            orgId,
            employeeId,
            weekStart,
            status: "open",
            totalMinutes: 0,
        });
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
        await ctx.db.patch(timesheetId, { status: "locked" });
    },
});
