import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { logAudit } from "./audit";
import { manilaMidnight, weekStartOf } from "./lib/week";
import { requireAdmin, requireAuth, requireMembership } from "./helpers";
import { syncSheetForWeek } from "./timesheets";

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

        if (employeeId) await assertEmployeeOrg(ctx, orgId, employeeId);

        const entries = await ctx.db
            .query("timeEntries")
            .withIndex("by_org_date", (q) =>
                q.eq("orgId", orgId).gte("date", startDate).lte("date", endDate)
            )
            .collect();

        return employeeId
            ? entries.filter((e) => e.employeeId === employeeId)
            : entries;
    },
});

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
        const weekStart = weekStartOf(day);

        // A submitted/approved/locked week is immutable — the entry grid must not
        // be able to edit around the approval it was granted.
        const sheet = await ctx.db
            .query("timesheets")
            .withIndex("by_org_employee_week", (q) =>
                q.eq("orgId", orgId).eq("employeeId", employeeId).eq("weekStart", weekStart),
            )
            .unique();
        if (sheet && !["open", "rejected"].includes(sheet.status)) {
            throw new ConvexError(
                sheet.status === "locked"
                    ? "This week is locked and cannot be edited"
                    : "This week has been submitted — it must be rejected before editing",
            );
        }

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
            await syncSheetForWeek(ctx, orgId, employeeId, weekStart);
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
        // A week with drafts must still have a sheet, otherwise the Timesheets
        // page has nothing to list until someone submits.
        await syncSheetForWeek(ctx, orgId, employeeId, weekStart);
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

        // Same immutability guard as upsertForDay: never delete out of an
        // already-submitted/approved/locked week.
        const weekStart = weekStartOf(entry.date);
        const sheet = await ctx.db
            .query("timesheets")
            .withIndex("by_org_employee_week", (q) =>
                q.eq("orgId", entry.orgId).eq("employeeId", entry.employeeId).eq("weekStart", weekStart),
            )
            .unique();
        if (sheet && !["open", "rejected"].includes(sheet.status)) {
            throw new ConvexError(
                sheet.status === "locked"
                    ? "This week is locked and cannot be edited"
                    : "This week has been submitted — it must be rejected before editing",
            );
        }

        if (entry.status !== "draft") throw new ConvexError("Only draft entries can be deleted");
        if (entry.createdBy !== userId && membership.role !== "admin") {
            throw new ConvexError("Only creators or admins can delete this entry");
        }
        await ctx.db.delete(entryId);
        await syncSheetForWeek(ctx, entry.orgId, entry.employeeId, weekStart);
    },
});
