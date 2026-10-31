import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { logAudit } from "./audit";
import { requireAdmin, requireAuth, requireMembership } from "./helpers";

// ==== Queries ====

/** The org's position masterlist, newest first, with usage counts. Any member. */
export const list = query({
    args: { orgId: v.id("organizations"), includeInactive: v.optional(v.boolean()) },
    handler: async (ctx, { orgId, includeInactive = false }) => {
        const userId = await requireAuth(ctx);
        await requireMembership(ctx, userId, orgId);

        const [positions, history] = await Promise.all([
            ctx.db
                .query("positions")
                .withIndex("by_org", (q) => q.eq("orgId", orgId))
                .collect(),
            ctx.db
                .query("employeePositions")
                .withIndex("by_org", (q) => q.eq("orgId", orgId))
                .collect(),
        ]);

        // Usage is what the delete guard counts: linked rows by id, pre-masterlist
        // rows by title. Surfacing it stops an admin discovering the block only
        // after clicking delete.
        const byId = new Map<string, number>();
        const byTitle = new Map<string, number>();
        for (const row of history) {
            if (row.positionId) {
                byId.set(row.positionId, (byId.get(row.positionId) ?? 0) + 1);
            } else {
                const key = row.jobTitle.trim().toLowerCase();
                byTitle.set(key, (byTitle.get(key) ?? 0) + 1);
            }
        }

        return positions
            .filter((position) => includeInactive || position.isActive)
            .map((position) => ({
                ...position,
                usageCount:
                    (byId.get(position._id as string) ?? 0) +
                    (byTitle.get(position.nameKey) ?? 0),
            }));
    },
});

// ==== Mutations ====

/** Create a position. admin + hr = data entry, not a structural change. */
export const create = mutation({
    args: {
        orgId: v.id("organizations"),
        name: v.string(),
        department: v.optional(v.string()),
        departmentId: v.optional(v.id("departments")),
        description: v.optional(v.string()),
    },
    handler: async (ctx, { orgId, name, department, departmentId, description }) => {
        const userId = await requireAuth(ctx);
        await requireMembership(ctx, userId, orgId);

        const cleanName = name.trim();
        if (cleanName.length < 2) throw new ConvexError("Position name must be at least 2 characters");
        if (cleanName.length > 80) throw new ConvexError("Position name must be 80 characters or fewer");
        const nameKey = cleanName.toLowerCase();

        // A department is PICKED from the master list (P12). The free-text field is kept
        // for older callers and normalised through the same rules, so the two cannot diverge.
        let resolvedDepartment = department;
        if (departmentId !== undefined) {
            const target = await ctx.db.get(departmentId);
            if (!target || target.orgId !== orgId) throw new ConvexError("Department not found");
            resolvedDepartment = target.name;
        } else if (department !== undefined) {
            resolvedDepartment =
                department.trim().replace(/\s+/g, " ").replace(/[.,;:]+$/, "") || undefined;
        }

        const duplicate = await ctx.db
            .query("positions")
            .withIndex("by_org_name_key", (q) => q.eq("orgId", orgId).eq("nameKey", nameKey))
            .unique();
        if (duplicate) {
            throw new ConvexError(
                duplicate.isActive
                    ? `"${cleanName}" already exists`
                    : `"${cleanName}" already exists but is inactive — reactivate it instead`,
            );
        }

        const now = Date.now();
        const positionId = await ctx.db.insert("positions", {
            orgId,
            name: cleanName,
            nameKey,
            department: resolvedDepartment || undefined,
            departmentId,
            description: description?.trim() || undefined,
            isActive: true,
            createdBy: userId,
            createdAt: now,
            updatedBy: userId,
            updatedAt: now,
        });

        await logAudit(ctx, {
            orgId,
            actorId: userId,
            action: "position.create",
            entityType: "positions",
            entityId: positionId,
        });

        return positionId;
    },
});

/** Update name/department/description. admin + hr. Renaming never rewrites history. */
export const update = mutation({
    args: {
        positionId: v.id("positions"),
        name: v.optional(v.string()),
        department: v.optional(v.string()),
        departmentId: v.optional(v.id("departments")),
        description: v.optional(v.string()),
    },
    handler: async (ctx, { positionId, name, department, departmentId, description }) => {
        const userId = await requireAuth(ctx);
        const position = await ctx.db.get(positionId);
        if (!position) throw new ConvexError("Position not found");
        await requireMembership(ctx, userId, position.orgId);

        // Typed patch — a Record<string, unknown> would not satisfy ctx.db.patch.
        const patch: Partial<Doc<"positions">> = { updatedBy: userId, updatedAt: Date.now() };

        if (name !== undefined) {
            const cleanName = name.trim();
            if (cleanName.length < 2) throw new ConvexError("Position name must be at least 2 characters");
            if (cleanName.length > 80) throw new ConvexError("Position name must be 80 characters or fewer");
            const nameKey = cleanName.toLowerCase();
            const clash = await ctx.db
                .query("positions")
                .withIndex("by_org_name_key", (q) =>
                    q.eq("orgId", position.orgId).eq("nameKey", nameKey),
                )
                .unique();
            if (clash && clash._id !== positionId) {
                throw new ConvexError(`"${cleanName}" already exists`);
            }
            patch.name = cleanName;
            patch.nameKey = nameKey;
        }
        if (departmentId !== undefined) {
            const target = await ctx.db.get(departmentId);
            if (!target || target.orgId !== position.orgId) throw new ConvexError("Department not found");
            patch.departmentId = departmentId;
            patch.department = target.name;
        } else if (department !== undefined) {
            patch.department =
                department.trim().replace(/\s+/g, " ").replace(/[.,;:]+$/, "") || undefined;
        }
        if (description !== undefined) patch.description = description.trim() || undefined;

        await ctx.db.patch(positionId, patch);

        await logAudit(ctx, {
            orgId: position.orgId,
            actorId: userId,
            action: "position.update",
            entityType: "positions",
            entityId: positionId,
        });
    },
});

// ==== Admin-only lifecycle ====

/** Deactivate/reactivate. admin only — it changes what the whole org can record. */
export const setActive = mutation({
    args: { positionId: v.id("positions"), isActive: v.boolean() },
    handler: async (ctx, { positionId, isActive }) => {
        const userId = await requireAuth(ctx);
        const position = await ctx.db.get(positionId);
        if (!position) throw new ConvexError("Position not found");
        await requireAdmin(ctx, userId, position.orgId);

        if (position.isActive === isActive) return;

        await ctx.db.patch(positionId, { isActive, updatedBy: userId, updatedAt: Date.now() });

        await logAudit(ctx, {
            orgId: position.orgId,
            actorId: userId,
            action: isActive ? "position.reactivate" : "position.deactivate",
            entityType: "positions",
            entityId: positionId,
        });
    },
});

/** Delete. admin only, and only when no history row references the position. */
export const remove = mutation({
    args: { positionId: v.id("positions") },
    handler: async (ctx, { positionId }) => {
        const userId = await requireAuth(ctx);
        const position = await ctx.db.get(positionId);
        if (!position) throw new ConvexError("Position not found");
        await requireAdmin(ctx, userId, position.orgId);

        const linked = await ctx.db
            .query("employeePositions")
            .withIndex("by_org_position", (q) =>
                q.eq("orgId", position.orgId).eq("positionId", positionId),
            )
            .collect();
        if (linked.length > 0) {
            throw new ConvexError(
                `Position is used by ${linked.length} position history ` +
                `${linked.length === 1 ? "entry" : "entries"} — deactivate it instead`,
            );
        }

        // Pre-masterlist rows carry only a title string; they still count as usage.
        const unlinked = await ctx.db
            .query("employeePositions")
            .withIndex("by_org", (q) => q.eq("orgId", position.orgId))
            .collect();
        const titleMatches = unlinked.filter(
            (row) =>
                row.positionId === undefined &&
                row.jobTitle.trim().toLowerCase() === position.nameKey,
        );
        if (titleMatches.length > 0) {
            throw new ConvexError(
                `Position is referenced by ${titleMatches.length} unlinked history ` +
                `${titleMatches.length === 1 ? "row" : "rows"} — run the backfill, then delete`,
            );
        }

        await ctx.db.delete(positionId);

        await logAudit(ctx, {
            orgId: position.orgId,
            actorId: userId,
            action: "position.delete",
            entityType: "positions",
            entityId: positionId,
        });
    },
});

/** Seed the masterlist from existing history titles. admin only, dry-run first. */
export const seedFromHistory = mutation({
    args: { orgId: v.id("organizations"), dryRun: v.optional(v.boolean()) },
    handler: async (ctx, { orgId, dryRun = false }) => {
        const userId = await requireAuth(ctx);
        await requireAdmin(ctx, userId, orgId);

        const [history, existing] = await Promise.all([
            ctx.db
                .query("employeePositions")
                .withIndex("by_org", (q) => q.eq("orgId", orgId))
                .collect(),
            ctx.db
                .query("positions")
                .withIndex("by_org", (q) => q.eq("orgId", orgId))
                .collect(),
        ]);

        if (history.length > 500) {
            throw new ConvexError(
                `Org has ${history.length} history rows; seed in smaller batches`,
            );
        }

        const idByKey = new Map(existing.map((position) => [position.nameKey, position._id]));
        const missing = new Map<string, { name: string; department?: string }>();
        for (const row of history) {
            const name = row.jobTitle.trim();
            const key = name.toLowerCase();
            if (!key || idByKey.has(key) || missing.has(key)) continue;
            missing.set(key, { name, department: row.department });
        }

        let created = 0;
        let linked = 0;

        if (!dryRun) {
            const now = Date.now();
            for (const [key, group] of missing) {
                const id = await ctx.db.insert("positions", {
                    orgId,
                    name: group.name,
                    nameKey: key,
                    department: group.department,
                    isActive: true,
                    createdBy: userId,
                    createdAt: now,
                    updatedBy: userId,
                    updatedAt: now,
                });
                idByKey.set(key, id);
                created += 1;
            }

            for (const row of history) {
                if (row.positionId) continue;
                const target = idByKey.get(row.jobTitle.trim().toLowerCase());
                if (!target) continue;
                await ctx.db.patch(row._id, { positionId: target });
                linked += 1;
            }

            await logAudit(ctx, {
                orgId,
                actorId: userId,
                action: "position.backfill",
                entityType: "organizations",
                entityId: orgId,
            });
        }

        return {
            dryRun,
            wouldCreate: missing.size,
            wouldLink: history.filter((row) => !row.positionId).length,
            created,
            linked,
        };
    },
});
