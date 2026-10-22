import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { requireAdmin, requireAuth, requireMembership } from "./helpers";

/**
 * Append one audit row. Call from inside the mutation that performs the
 * change — Convex mutations are transactional, so the audit row rolls back
 * with the write. Never call this from an action.
 */
export async function logAudit(
    ctx: MutationCtx,
    args: {
        orgId: Id<"organizations">;
        actorId: Id<"users">;
        action: string;
        entityType: string;
        entityId: string;
    },
) {
    await ctx.db.insert("auditLogs", {
        orgId: args.orgId,
        actorId: args.actorId,
        action: args.action,
        entity: { type: args.entityType, id: args.entityId },
        at: Date.now(),
    });
}

/** Org audit trail, newest first, with actor names joined. Admin only. */
export const listForOrg = query({
    args: { orgId: v.id("organizations"), limit: v.optional(v.number()) },
    handler: async (ctx, { orgId, limit }) => {
        const userId = await requireAuth(ctx);
        await requireAdmin(ctx, userId, orgId);
        const rows = await ctx.db
            .query("auditLogs")
            .withIndex("by_org_at", (q) => q.eq("orgId", orgId))
            .order("desc")
            .take(limit ?? 100);
        return Promise.all(
            rows.map(async (row) => {
                const actor = await ctx.db.get(row.actorId);
                return { ...row, actorName: actor?.name ?? null };
            }),
        );
    },
});

/** Trail for one entity, newest first. Any member. */
export const listForEntity = query({
    args: {
        orgId: v.id("organizations"),
        entityType: v.string(),
        entityId: v.string(),
    },
    handler: async (ctx, { orgId, entityType, entityId }) => {
        const userId = await requireAuth(ctx);
        await requireMembership(ctx, userId, orgId);
        return ctx.db
            .query("auditLogs")
            .withIndex("by_org_entity", (q) =>
                q
                    .eq("orgId", orgId)
                    .eq("entity.type", entityType)
                    .eq("entity.id", entityId),
            )
            .order("desc")
            .collect();
    },
});
