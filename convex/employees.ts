import { ConvexError, v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { logAudit } from "./audit";
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

        const [employees, positions] = await Promise.all([
            ctx.db
                .query("employees")
                .withIndex("by_org", (q) => q.eq("orgId", orgId))
                .order("asc")
                .collect(),
            ctx.db
                .query("employeePositions")
                .withIndex("by_org", (q) => q.eq("orgId", orgId))
                .collect(),
        ]);

        // Prefer the open row (no endDate); otherwise the latest effectiveDate.
        const current = new Map<string, (typeof positions)[number]>();
        for (const position of positions) {
            const incumbent = current.get(position.employeeId);
            if (!incumbent) {
                current.set(position.employeeId, position);
                continue;
            }
            const positionOpen = position.endDate === undefined;
            const incumbentOpen = incumbent.endDate === undefined;
            if (positionOpen !== incumbentOpen) {
                if (positionOpen) current.set(position.employeeId, position);
                continue;
            }
            if (position.effectiveDate > incumbent.effectiveDate) {
                current.set(position.employeeId, position);
            }
        }

        return employees.map((employee) => ({
            ...employee,
            currentPosition: current.get(employee._id) ?? null,
        }));
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
        const employeeId = await ctx.db.insert("employees", { orgId, ...fields });
        await logAudit(ctx, {
            orgId,
            actorId: userId,
            action: "employee.create",
            entityType: "employees",
            entityId: employeeId,
        });
        return employeeId;
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
        await logAudit(ctx, {
            orgId: employee.orgId,
            actorId: userId,
            action: "employee.update",
            entityType: "employees",
            entityId: employeeId,
        });
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
        await logAudit(ctx, {
            orgId: employee.orgId,
            actorId: userId,
            action: "employee.delete",
            entityType: "employees",
            entityId: employeeId,
        });
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
        positionId: v.id("positions"),
        salary: v.optional(v.number()),
        effectiveDate: v.number(),
        notes: v.optional(v.string()),
    },
    handler: async (ctx, { employeeId, positionId, ...fields }) => {
        const userId = await requireAuth(ctx);
        const employee = await ctx.db.get(employeeId);
        if (!employee) throw new ConvexError("Employee not found");
        await requireMembership(ctx, userId, employee.orgId);

        const masterPosition = await ctx.db.get(positionId);
        if (!masterPosition) throw new ConvexError("Position not found");
        if (masterPosition.orgId !== employee.orgId) {
            throw new ConvexError("Position is not in this organisation");
        }
        if (!masterPosition.isActive) {
            throw new ConvexError("Position is inactive — reactivate it or add a new one");
        }

        // Latest position by effectiveDate (index covers the sort; no scan).
        const latest = await ctx.db
            .query("employeePositions")
            .withIndex("by_employee_effective", (q) => q.eq("employeeId", employeeId))
            .order("desc")
            .first();

        if (latest) {
            if (fields.effectiveDate <= latest.effectiveDate) {
                throw new ConvexError(
                    "Effective date must be after the previous position's effective date",
                );
            }
            if (latest.endDate && fields.effectiveDate <= latest.endDate) {
                throw new ConvexError(
                    "Effective date must be after the previous position ended",
                );
            }
            if (latest.endDate === undefined) {
                await ctx.db.patch(latest._id, { endDate: fields.effectiveDate });
            }
        }

        if (fields.salary !== undefined && fields.salary < 0) {
            throw new ConvexError("Salary cannot be negative");
        }

        const positionRowId = await ctx.db.insert("employeePositions", {
            orgId: employee.orgId,
            employeeId,
            positionId,
            jobTitle: masterPosition.name,          // snapshot — history must not follow renames
            department: masterPosition.department,  // snapshot
            ...fields,
        });
        await logAudit(ctx, {
            orgId: employee.orgId,
            actorId: userId,
            action: "employeePosition.create",
            entityType: "employeePositions",
            entityId: positionRowId,
        });
        return positionRowId;
    },
});

/**
 * Update an existing position entry. Admin and hr may edit.
 */
export const updatePosition = mutation({
    args: {
        positionId: v.id("employeePositions"),
        positionRefId: v.optional(v.id("positions")),
        salary: v.optional(v.number()),
        effectiveDate: v.optional(v.number()),
        endDate: v.optional(v.number()),
        notes: v.optional(v.string()),
    },
    handler: async (ctx, { positionId, positionRefId, ...fields }) => {
        const userId = await requireAuth(ctx);
        const position = await ctx.db.get(positionId);
        if (!position) throw new ConvexError("Position not found");
        await requireMembership(ctx, userId, position.orgId);
        const effectiveDate = fields.effectiveDate ?? position.effectiveDate;
        const endDate = fields.endDate ?? position.endDate;
        if (endDate !== undefined && endDate <= effectiveDate) {
            throw new ConvexError("End date must be after the effective date");
        }
        if (fields.salary !== undefined && fields.salary < 0) {
            throw new ConvexError("Salary cannot be negative");
        }

        // Typed patch — a Record<string, unknown> would not satisfy ctx.db.patch.
        const patch: Partial<Doc<"employeePositions">> = {};

        if (positionRefId !== undefined) {
            const target = await ctx.db.get(positionRefId);
            if (!target) throw new ConvexError("Position not found");
            if (target.orgId !== position.orgId) {
                throw new ConvexError("Position is not in this organisation");
            }
            if (!target.isActive && target._id !== position.positionId) {
                throw new ConvexError("Position is inactive — reactivate it first");
            }
            patch.positionId = target._id;
            patch.jobTitle = target.name;      // re-snapshot on a deliberate correction
            patch.department = target.department;
        }

        if (fields.salary !== undefined) patch.salary = fields.salary;
        if (fields.effectiveDate !== undefined) patch.effectiveDate = fields.effectiveDate;
        if (fields.endDate !== undefined) patch.endDate = fields.endDate;
        if (fields.notes !== undefined) patch.notes = fields.notes;

        if (Object.keys(patch).length > 0) await ctx.db.patch(positionId, patch);
        await logAudit(ctx, {
            orgId: position.orgId,
            actorId: userId,
            action: "employeePosition.update",
            entityType: "employeePositions",
            entityId: positionId,
        });
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
        await logAudit(ctx, {
            orgId: position.orgId,
            actorId: userId,
            action: "employeePosition.delete",
            entityType: "employeePositions",
            entityId: positionId,
        });
    },
});
