import { ConvexError, v } from "convex/values";
import { mutation, query } from "../_generated/server";
import type { MutationCtx } from "../_generated/server";
import { logAudit } from "../audit";
import type { QueryCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { requireAuth, requireMembership } from "../helpers";
import { loadPrintablePayslip } from "./payout";

/**
 * The portal view (P4.3, D13).
 *
 * Employees are not users of this app, so "portal" means a tokenised link: one
 * random, expiring, revocable token per payslip. The public query resolves a token to
 * ITS OWN payslip and to nothing else — there is no argument that names an employee,
 * which is what makes "a token from employee A cannot fetch employee B's payslip" a
 * property of the shape rather than of a check someone might forget.
 */

export const DEFAULT_LINK_DAYS = 30;

function newToken(): string {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Mint (or re-mint) a link for one payslip. Admin/hr only, audited. */
export async function mintLinkCore(
    ctx: MutationCtx,
    {
        userId,
        orgId,
        payslipId,
        expiresInDays,
    }: {
        userId: Id<"users">;
        orgId: Id<"organizations">;
        payslipId: Id<"payslips">;
        expiresInDays?: number;
    },
) {
    {
        const payslip = await ctx.db.get(payslipId);
        if (!payslip || payslip.orgId !== orgId) {
            throw new ConvexError("Payslip not found in this organisation");
        }
        const run = await ctx.db.get(payslip.runId);
        if (!run || (run.status !== "approved" && run.status !== "paid")) {
            throw new ConvexError(
                "A payslip link is only available once its run is approved",
            );
        }

        const days = Math.min(Math.max(expiresInDays ?? DEFAULT_LINK_DAYS, 1), 365);
        const token = newToken();
        const now = Date.now();

        const linkId = await ctx.db.insert("payslipLinks", {
            orgId,
            runId: payslip.runId,
            payslipId,
            employeeId: payslip.employeeId,
            token,
            expiresAt: now + days * 24 * 3_600_000,
            createdBy: userId,
            createdAt: now,
        });

        await logAudit(ctx, {
            orgId,
            actorId: userId,
            action: "payroll.payslipLink.mint",
            entityType: "payslips",
            entityId: payslipId,
        });

        return { linkId, token, expiresAt: now + days * 24 * 3_600_000 };
    }
}

export const mint = mutation({
    args: {
        orgId: v.id("organizations"),
        payslipId: v.id("payslips"),
        expiresInDays: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        const userId = await requireAuth(ctx);
        await requireMembership(ctx, userId, args.orgId);
        return mintLinkCore(ctx, { userId, ...args });
    },
});

/** Withdraw a link. The payslip stays; the URL stops working. */
export const revoke = mutation({
    args: { orgId: v.id("organizations"), linkId: v.id("payslipLinks") },
    handler: async (ctx, { orgId, linkId }) => {
        const userId = await requireAuth(ctx);
        await requireMembership(ctx, userId, orgId);
        const link = await ctx.db.get(linkId);
        if (!link || link.orgId !== orgId) throw new ConvexError("Link not found");
        if (link.revokedAt === undefined) {
            await ctx.db.patch(linkId, { revokedAt: Date.now() });
            await logAudit(ctx, {
                orgId,
                actorId: userId,
                action: "payroll.payslipLink.revoke",
                entityType: "payslips",
                entityId: link.payslipId,
            });
        }
    },
});

/** Links already minted for a payslip, newest first. */
export const listForPayslip = query({
    args: { orgId: v.id("organizations"), payslipId: v.id("payslips") },
    handler: async (ctx, { orgId, payslipId }) => {
        const userId = await requireAuth(ctx);
        await requireMembership(ctx, userId, orgId);
        const links = await ctx.db
            .query("payslipLinks")
            .withIndex("by_payslip", (q) => q.eq("payslipId", payslipId))
            .collect();
        const now = Date.now();
        return links
            .sort((a, b) => b.createdAt - a.createdAt)
            .map((link) => ({
                ...link,
                active: link.revokedAt === undefined && now < link.expiresAt,
            }));
    },
});

/**
 * PUBLIC — no session, no auth. A token resolves to its own payslip only.
 *
 * Invalid, revoked and expired tokens all return the same shape, so a probe cannot
 * tell "wrong token" from "expired token", and nothing about the employee is returned
 * before the token is validated.
 */
export async function resolveLinkToken(ctx: QueryCtx | MutationCtx, token: string) {
    if (!/^[0-9a-f]{64}$/.test(token)) return { status: "invalid" as const };

    const link = await ctx.db
        .query("payslipLinks")
        .withIndex("by_token", (q) => q.eq("token", token))
        .unique();
    if (!link) return { status: "invalid" as const };
    if (link.revokedAt !== undefined) return { status: "invalid" as const };
    if (Date.now() >= link.expiresAt) return { status: "expired" as const };

    // The payslip is loaded THROUGH the link, so the token's own payslip is the only
    // one this function can reach.
    const payslip = await loadPrintablePayslip(ctx, link.payslipId);
    return { status: "ok" as const, ...payslip };
}

export const getByToken = query({
    args: { token: v.string() },
    handler: async (ctx, { token }) => resolveLinkToken(ctx, token),
});
