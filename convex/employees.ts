import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireAdmin, requireAuth, requireMembership } from "./helpers";

// ─── Validators ────────────────────────────────────────────────────────────

const statusValidator = v.union(
    v.literal("active"),
    v.literal("terminated"),
    v.literal("on_leave"),
);

// ─── Employee Queries ───────────────────────────────────────────────────────

/**
 * List all employees for an org. Accessible by admin and hr.
 */
export const list = query({
    args: { orgId: v.id("organizations") },
    handler: async (ctx, { orgId }) => {
        const userId = await requireAuth(ctx);
        await requireMembership(ctx, userId, orgId);

        const employees = await ctx.db
            .query("employees")
            .withIndex("by_org", (q) => q.eq("orgId", orgId))
            .order("asc")
            .collect();

        // Attach the current (most-recent) position to each employee row.
        return Promise.all(
            employees.map(async (emp) => {
                const positions = await ctx.db
                    .query("employeePositions")
                    .withIndex("by_employee_effective", (q) =>
                        q.eq("employeeId", emp._id),
                    )
                    .order("desc")
                    .collect();
                const currentPosition = positions.find((p) => !p.endDate) ?? positions[0] ?? null;
                return { ...emp, currentPosition };
            }),
        );
    },
});

/**
 * Get a single employee with full position history. Accessible by admin and hr.
 */
export const get = query({
    args: { employeeId: v.id("employees") },
    handler: async (ctx, { employeeId }) => {
        const userId = await requireAuth(ctx);
        const employee = await ctx.db.get(employeeId);
        if (!employee) throw new ConvexError("Employee not found");
        await requireMembership(ctx, userId, employee.orgId);

        const positions = await ctx.db
            .query("employeePositions")
            .withIndex("by_employee_effective", (q) =>
                q.eq("employeeId", employeeId),
            )
            .order("desc")
            .collect();

        return { ...employee, positions };
    },
});

// ─── Employee Mutations ─────────────────────────────────────────────────────

/**
 * Create a new employee record. Both admin and hr may create employees.
 */
export const create = mutation({
    args: {
        orgId: v.id("organizations"),
        firstName: v.string(),
        lastName: v.string(),
        email: v.optional(v.string()),
        phone: v.optional(v.string()),
        dateOfBirth: v.optional(v.number()),
        hireDate: v.number(),
        status: statusValidator,
    },
    handler: async (ctx, { orgId, ...fields }) => {
        const userId = await requireAuth(ctx);
        await requireMembership(ctx, userId, orgId);
        return ctx.db.insert("employees", { orgId, ...fields });
    },
});

/**
 * Update an employee's profile. Both admin and hr may edit.
 */
export const update = mutation({
    args: {
        employeeId: v.id("employees"),
        firstName: v.optional(v.string()),
        lastName: v.optional(v.string()),
        email: v.optional(v.string()),
        phone: v.optional(v.string()),
        dateOfBirth: v.optional(v.number()),
        hireDate: v.optional(v.number()),
        status: v.optional(statusValidator),
    },
    handler: async (ctx, { employeeId, ...fields }) => {
        const userId = await requireAuth(ctx);
        const employee = await ctx.db.get(employeeId);
        if (!employee) throw new ConvexError("Employee not found");
        await requireMembership(ctx, userId, employee.orgId);
        await ctx.db.patch(employeeId, fields);
    },
});

/**
 * Permanently delete an employee and all their position history. Admin only.
 */
export const remove = mutation({
    args: { employeeId: v.id("employees") },
    handler: async (ctx, { employeeId }) => {
        const userId = await requireAuth(ctx);
        const employee = await ctx.db.get(employeeId);
        if (!employee) throw new ConvexError("Employee not found");
        await requireAdmin(ctx, userId, employee.orgId);

        // Delete all related position records first.
        const positions = await ctx.db
            .query("employeePositions")
            .withIndex("by_employee", (q) => q.eq("employeeId", employeeId))
            .collect();
        await Promise.all(positions.map((p) => ctx.db.delete(p._id)));

        await ctx.db.delete(employeeId);
    },
});

// ─── Position Mutations ─────────────────────────────────────────────────────

/**
 * Add a new position entry to an employee's history. Admin and hr may add.
 * Automatically closes the previous open position (sets its endDate).
 */
export const addPosition = mutation({
    args: {
        employeeId: v.id("employees"),
        jobTitle: v.string(),
        department: v.optional(v.string()),
        salary: v.optional(v.number()),
        effectiveDate: v.number(),
        notes: v.optional(v.string()),
    },
    handler: async (ctx, { employeeId, ...fields }) => {
        const userId = await requireAuth(ctx);
        const employee = await ctx.db.get(employeeId);
        if (!employee) throw new ConvexError("Employee not found");
        await requireMembership(ctx, userId, employee.orgId);

        // Close any currently-open position (endDate absent).
        const openPosition = await ctx.db
            .query("employeePositions")
            .withIndex("by_employee", (q) => q.eq("employeeId", employeeId))
            .filter((q) => q.eq(q.field("endDate"), undefined))
            .first();
        if (openPosition) {
            await ctx.db.patch(openPosition._id, { endDate: fields.effectiveDate });
        }

        return ctx.db.insert("employeePositions", {
            orgId: employee.orgId,
            employeeId,
            ...fields,
        });
    },
});

/**
 * Update an existing position entry. Admin and hr may edit.
 */
export const updatePosition = mutation({
    args: {
        positionId: v.id("employeePositions"),
        jobTitle: v.optional(v.string()),
        department: v.optional(v.string()),
        salary: v.optional(v.number()),
        effectiveDate: v.optional(v.number()),
        endDate: v.optional(v.number()),
        notes: v.optional(v.string()),
    },
    handler: async (ctx, { positionId, ...fields }) => {
        const userId = await requireAuth(ctx);
        const position = await ctx.db.get(positionId);
        if (!position) throw new ConvexError("Position not found");
        await requireMembership(ctx, userId, position.orgId);
        await ctx.db.patch(positionId, fields);
    },
});

/**
 * Delete a position entry. Admin only.
 */
export const removePosition = mutation({
    args: { positionId: v.id("employeePositions") },
    handler: async (ctx, { positionId }) => {
        const userId = await requireAuth(ctx);
        const position = await ctx.db.get(positionId);
        if (!position) throw new ConvexError("Position not found");
        await requireAdmin(ctx, userId, position.orgId);
        await ctx.db.delete(positionId);
    },
});
