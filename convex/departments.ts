import { ConvexError, v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { logAudit } from "./audit";
import { requireAdmin, requireAnyAdmin, requireAuth, requireMembership } from "./helpers";
import { departmentDisplay, departmentKey, planDepartments } from "./lib/departments";
import { planRepair } from "./lib/positionHistory";

/**
 * Departments (P12).
 *
 * One master list per org, so a department is PICKED rather than typed. Normalisation
 * merges the messy spellings of one department; it never renames one department into
 * another — "Engg" and "Engineering" stay separate until a human says otherwise.
 */

export const list = query({
    args: { orgId: v.id("organizations"), includeInactive: v.optional(v.boolean()) },
    handler: async (ctx, { orgId, includeInactive }) => {
        const userId = await requireAuth(ctx);
        await requireMembership(ctx, userId, orgId);
        const rows = await ctx.db
            .query("departments")
            .withIndex("by_org", (q) => q.eq("orgId", orgId))
            .collect();
        return rows
            .filter((row) => (includeInactive ? true : row.isActive))
            .sort((a, b) => a.name.localeCompare(b.name));
    },
});

const nameArgs = { orgId: v.id("organizations"), name: v.string() };

export const create = mutation({
    args: nameArgs,
    handler: async (ctx, { orgId, name }) => {
        const userId = await requireAuth(ctx);
        await requireAdmin(ctx, userId, orgId);
        const display = departmentDisplay(name);
        if (display.length === 0) throw new ConvexError("A department needs a name");

        const key = departmentKey(display);
        const existing = await ctx.db
            .query("departments")
            .withIndex("by_org_name_key", (q) => q.eq("orgId", orgId).eq("nameKey", key))
            .unique();
        if (existing) throw new ConvexError(`"${existing.name}" already exists`);

        const id = await ctx.db.insert("departments", {
            orgId,
            name: display,
            nameKey: key,
            isActive: true,
            createdBy: userId,
            createdAt: Date.now(),
            updatedBy: userId,
            updatedAt: Date.now(),
        });
        await logAudit(ctx, {
            orgId,
            actorId: userId,
            action: "department.create",
            entityType: "organizations",
            entityId: orgId,
        });
        return { id };
    },
});

/**
 * Rename a department. Positions that point at it are updated; history rows keep their
 * own snapshot (a rename today must not rewrite what the org looked like last year).
 */
export const rename = mutation({
    args: { orgId: v.id("organizations"), id: v.id("departments"), name: v.string() },
    handler: async (ctx, args) => {
        const userId = await requireAuth(ctx);
        await requireAdmin(ctx, userId, args.orgId);
        const row = await ctx.db.get(args.id);
        if (!row || row.orgId !== args.orgId) throw new ConvexError("Department not found");

        const display = departmentDisplay(args.name);
        if (display.length === 0) throw new ConvexError("A department needs a name");
        const key = departmentKey(display);
        const clash = await ctx.db
            .query("departments")
            .withIndex("by_org_name_key", (q) => q.eq("orgId", args.orgId).eq("nameKey", key))
            .unique();
        if (clash && clash._id !== row._id) throw new ConvexError(`"${clash.name}" already exists`);

        await ctx.db.patch(row._id, {
            name: display,
            nameKey: key,
            updatedBy: userId,
            updatedAt: Date.now(),
        });

        const positions = await ctx.db
            .query("positions")
            .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
            .collect();
        for (const position of positions) {
            if (position.departmentId === row._id) {
                await ctx.db.patch(position._id, {
                    department: display,
                    updatedBy: userId,
                    updatedAt: Date.now(),
                });
            }
        }

        await logAudit(ctx, {
            orgId: args.orgId,
            actorId: userId,
            action: "department.rename",
            entityType: "organizations",
            entityId: args.orgId,
        });
        return { name: display };
    },
});

export const setActive = mutation({
    args: { orgId: v.id("organizations"), id: v.id("departments"), isActive: v.boolean() },
    handler: async (ctx, args) => {
        const userId = await requireAuth(ctx);
        await requireAdmin(ctx, userId, args.orgId);
        const row = await ctx.db.get(args.id);
        if (!row || row.orgId !== args.orgId) throw new ConvexError("Department not found");
        await ctx.db.patch(row._id, {
            isActive: args.isActive,
            updatedBy: userId,
            updatedAt: Date.now(),
        });
        return { ok: true };
    },
});

/**
 * Normalise: every spelling of one department becomes one department, and every position
 * and history row is pointed at it. Idempotent — running it twice changes nothing.
 */
async function normalise(ctx: MutationCtx, orgId: Id<"organizations">, actorId: Id<"users">) {
    const positions = await ctx.db
        .query("positions")
        .withIndex("by_org", (q) => q.eq("orgId", orgId))
        .collect();
    const history = await ctx.db
        .query("employeePositions")
        .withIndex("by_org", (q) => q.eq("orgId", orgId))
        .collect();

    const values = [
        ...positions.map((row) => row.department ?? ""),
        ...history.map((row) => row.department ?? ""),
    ];
    const plan = planDepartments(values);

    const existing = await ctx.db
        .query("departments")
        .withIndex("by_org", (q) => q.eq("orgId", orgId))
        .collect();
    const byKey = new Map(existing.map((row) => [row.nameKey, row]));

    let created = 0;
    const idByKey = new Map<string, Id<"departments">>();
    for (const department of plan.departments) {
        const found = byKey.get(department.key);
        if (found) {
            idByKey.set(department.key, found._id);
            continue;
        }
        const id = await ctx.db.insert("departments", {
            orgId,
            name: department.display,
            nameKey: department.key,
            isActive: true,
            createdBy: actorId,
            createdAt: Date.now(),
            updatedBy: actorId,
            updatedAt: Date.now(),
        });
        idByKey.set(department.key, id);
        created += 1;
    }

    let positionsUpdated = 0;
    for (const position of positions) {
        if (!position.department) continue;
        const key = departmentKey(position.department);
        const id = idByKey.get(key);
        if (!id) continue;
        const display = plan.departments.find((entry) => entry.key === key)?.display ?? position.department;
        if (position.departmentId === id && position.department === display) continue;
        await ctx.db.patch(position._id, {
            departmentId: id,
            department: display,
            updatedBy: actorId,
            updatedAt: Date.now(),
        });
        positionsUpdated += 1;
    }

    let historyUpdated = 0;
    for (const row of history) {
        if (!row.department) continue;
        const key = departmentKey(row.department);
        const id = idByKey.get(key);
        if (!id) continue;
        const display = plan.departments.find((entry) => entry.key === key)?.display ?? row.department;
        if (row.departmentId === id && row.department === display) continue;
        await ctx.db.patch(row._id, { departmentId: id, department: display });
        historyUpdated += 1;
    }

    return {
        departments: plan.departments.length,
        created,
        positionsUpdated,
        historyUpdated,
        merged: plan.renames,
    };
}

/** CLI / admin path: normalise this org's departments. */
export const normaliseDepartments = internalMutation({
    args: { orgId: v.id("organizations"), actorId: v.id("users") },
    handler: async (ctx, args) => {
        await requireAnyAdmin(ctx, args.actorId);
        const result = await normalise(ctx, args.orgId, args.actorId);
        await logAudit(ctx, {
            orgId: args.orgId,
            actorId: args.actorId,
            action: "department.normalise",
            entityType: "organizations",
            entityId: args.orgId,
        });
        return result;
    },
});

/**
 * Repair: make every employee's history contiguous and non-overlapping.
 *
 * `endDate` is inclusive, so a record that currently ends ON the next record's effective
 * date is pulled back one day. This is the migration for history written before the
 * d+1 rule existed.
 */
export const repairPositionDates = internalMutation({
    args: { orgId: v.id("organizations"), actorId: v.id("users") },
    handler: async (ctx, args) => {
        await requireAnyAdmin(ctx, args.actorId);
        const history = await ctx.db
            .query("employeePositions")
            .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
            .collect();

        const byEmployee = new Map<string, typeof history>();
        for (const row of history) {
            const key = String(row.employeeId);
            byEmployee.set(key, [...(byEmployee.get(key) ?? []), row]);
        }

        let changed = 0;
        let employees = 0;
        const remaining: string[] = [];

        for (const [employeeId, rows] of byEmployee) {
            const plan = planRepair(
                rows.map((row) => ({
                    id: String(row._id),
                    effectiveDate: row.effectiveDate,
                    endDate: row.endDate,
                })),
            );
            let touched = false;
            for (const step of plan) {
                const row = rows.find((candidate) => String(candidate._id) === step.id);
                if (!row) continue;
                if (row.endDate === step.endDate) continue;
                await ctx.db.patch(row._id, { endDate: step.endDate });
                changed += 1;
                touched = true;
            }
            if (touched) employees += 1;
        }

        await logAudit(ctx, {
            orgId: args.orgId,
            actorId: args.actorId,
            action: "positionHistory.repair",
            entityType: "organizations",
            entityId: args.orgId,
        });

        return { changed, employees, remaining };
    },
});
