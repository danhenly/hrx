import { ConvexError, v } from "convex/values";
import { mutation, query } from "../_generated/server";
import { logAudit } from "../audit";
import { requireAuth, requireMembership } from "../helpers";
import { equalInstalments } from "../lib/payroll/thirteenth";

/**
 * Loan accounts (P5.3, D9). One ledger for statutory and employer loans, because the
 * amortisation order has to sort something uniform.
 *
 * The pilot's policy for an SSS salary loan is the standard 10-month schedule, so a
 * new loan defaults to 10 months and an amortisation derived from it (principal ÷ 10,
 * then split across the two cutoffs). A loan that carries interest enters its own
 * fixed `amortisation` instead — the schedule here is principal-only.
 */

const loanTypeValidator = v.union(
    v.literal("sss"),
    v.literal("pagibig"),
    v.literal("company"),
    v.literal("advance"),
);

export const list = query({
    args: { orgId: v.id("organizations"), employeeId: v.id("employees") },
    handler: async (ctx, { orgId, employeeId }) => {
        const userId = await requireAuth(ctx);
        await requireMembership(ctx, userId, orgId);
        const rows = await ctx.db
            .query("loanAccounts")
            .withIndex("by_org_employee", (q) =>
                q.eq("orgId", orgId).eq("employeeId", employeeId),
            )
            .collect();
        return rows.sort((a, b) => b.createdAt - a.createdAt);
    },
});

/** The amortisations booked against one loan, newest first. */
export const history = query({
    args: { orgId: v.id("organizations"), loanId: v.id("loanAccounts") },
    handler: async (ctx, { orgId, loanId }) => {
        const userId = await requireAuth(ctx);
        await requireMembership(ctx, userId, orgId);
        return ctx.db
            .query("loanAmortizations")
            .withIndex("by_loan", (q) => q.eq("loanId", loanId))
            .collect();
    },
});

export const create = mutation({
    args: {
        orgId: v.id("organizations"),
        employeeId: v.id("employees"),
        type: loanTypeValidator,
        principal: v.number(),
        termMonths: v.optional(v.number()),
        /** Pesos per cutoff. Defaults to principal ÷ term ÷ 2. */
        amortisation: v.optional(v.number()),
        reference: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const userId = await requireAuth(ctx);
        await requireMembership(ctx, userId, args.orgId);

        const employee = await ctx.db.get(args.employeeId);
        if (!employee || employee.orgId !== args.orgId) {
            throw new ConvexError("Employee not found in this organisation");
        }
        if (!(args.principal > 0)) {
            throw new ConvexError("A loan needs a positive principal");
        }
        const termMonths = args.termMonths ?? 10;
        if (!Number.isInteger(termMonths) || termMonths < 1 || termMonths > 60) {
            throw new ConvexError("The term must be a whole number of months (1–60)");
        }

        // Principal ÷ term, with the residue on the last month, then split across the
        // two cutoffs. Derived rather than typed so the schedule always sums to the
        // principal.
        const instalments = equalInstalments({
            principalCentavos: Math.round(args.principal * 100),
            termMonths,
        });
        const perCutoff = instalments[0] / 2 / 100;
        const amortisation =
            args.amortisation !== undefined
                ? args.amortisation
                : Math.round(perCutoff * 100) / 100;

        if (!(amortisation > 0)) {
            throw new ConvexError("The amortisation must be positive");
        }
        if (amortisation * 2 > args.principal) {
            throw new ConvexError(
                "The amortisation would clear the principal in less than one month — check the term",
            );
        }

        const loanId = await ctx.db.insert("loanAccounts", {
            orgId: args.orgId,
            employeeId: args.employeeId,
            type: args.type,
            principal: args.principal,
            balance: args.principal,
            amortisation,
            termMonths,
            reference: args.reference?.trim() || undefined,
            status: "active",
            createdBy: userId,
            createdAt: Date.now(),
        });

        await logAudit(ctx, {
            orgId: args.orgId,
            actorId: userId,
            action: "payroll.loan.create",
            entityType: "employeeLoans",
            entityId: loanId,
        });

        return { loanId, amortisation, termMonths };
    },
});

/** Write a loan off (an abandoned balance is closed explicitly, never deleted). */
export const writeOff = mutation({
    args: {
        orgId: v.id("organizations"),
        loanId: v.id("loanAccounts"),
        reason: v.string(),
    },
    handler: async (ctx, { orgId, loanId, reason }) => {
        const userId = await requireAuth(ctx);
        await requireMembership(ctx, userId, orgId);
        const loan = await ctx.db.get(loanId);
        if (!loan || loan.orgId !== orgId) throw new ConvexError("Loan not found");
        const trimmed = reason.trim();
        if (trimmed.length < 3) throw new ConvexError("A reason is required");
        await ctx.db.patch(loanId, { status: "written_off" });
        await logAudit(ctx, {
            orgId,
            actorId: userId,
            action: "payroll.loan.writeOff",
            entityType: "employeeLoans",
            entityId: loanId,
        });
    },
});
