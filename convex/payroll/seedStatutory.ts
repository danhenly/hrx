import { ConvexError, v } from "convex/values";
import { internalMutation } from "../_generated/server";
import { logAudit } from "../audit";
import { requireAnyAdmin, requireMembership } from "../helpers";
import { msOfDateKey } from "../lib/payroll/calendar";
import { semiMonthlyBrackets } from "../lib/payroll/tax";
import { ALLOWANCE_CATALOGUE, STATUTORY_SEED } from "./statutorySeed";

/**
 * Seeds plan §2 into `statutoryTables` (P0.2).
 *
 * INTERNAL, so it cannot be called from a browser at all; `npx convex run` has no
 * session, which is why the caller passes `actorId` and the mutation verifies
 * that actor is an admin of `orgId` (for the audit row and the refusal path).
 *
 * IDEMPOTENT by (kind, effectiveFrom): re-running skips rows that already exist
 * rather than duplicating them or overwriting an admin's edited values — the app
 * is the system of record after the first seed (D17), this file is only the
 * starting point.
 *
 *   npx convex run payroll/seedStatutory:seedStatutoryTables \
 *     '{"orgId":"<id>","actorId":"<admin user id>"}'
 */
export const seedStatutoryTables = internalMutation({
    args: {
        orgId: v.id("organizations"),
        actorId: v.id("users"),
        dryRun: v.optional(v.boolean()),
    },
    returns: v.object({
        dryRun: v.boolean(),
        inserted: v.number(),
        skipped: v.number(),
        rows: v.array(
            v.object({
                kind: v.string(),
                effectiveFrom: v.string(),
                action: v.union(v.literal("insert"), v.literal("skip")),
            }),
        ),
    }),
    handler: async (ctx, { orgId, actorId, dryRun = false }) => {
        await requireAnyAdmin(ctx, actorId);
        await requireMembership(ctx, actorId, orgId);

        const existing = await ctx.db.query("statutoryTables").collect();
        const byKey = new Map(
            existing.map((row) => [`${row.kind}|${row.effectiveFrom}`, row]),
        );

        const rows: {
            kind: string;
            effectiveFrom: string;
            action: "insert" | "skip";
        }[] = [];
        let inserted = 0;
        let skipped = 0;

        for (const seedRow of STATUTORY_SEED) {
            const effectiveFrom = msOfDateKey(seedRow.effectiveFrom);
            const key = `${seedRow.kind}|${effectiveFrom}`;
            if (byKey.has(key)) {
                rows.push({
                    kind: seedRow.kind,
                    effectiveFrom: seedRow.effectiveFrom,
                    action: "skip",
                });
                skipped += 1;
                continue;
            }

            // The tax row stores its derived semi-monthly table, exactly as
            // statutoryTables.upsert would, so a seeded table and an edited one
            // have the same shape.
            const payload =
                seedRow.kind === "tax"
                    ? {
                          ...(seedRow.payload as {
                              annualBrackets: {
                                  from: number;
                                  to: number | null;
                                  base: number;
                                  rate: number;
                              }[];
                          }),
                          semiMonthly: semiMonthlyBrackets(
                              (
                                  seedRow.payload as {
                                      annualBrackets: {
                                          from: number;
                                          to: number | null;
                                          base: number;
                                          rate: number;
                                      }[];
                                  }
                              ).annualBrackets,
                          ),
                      }
                    : seedRow.payload;

            if (!dryRun) {
                await ctx.db.insert("statutoryTables", {
                    kind: seedRow.kind,
                    effectiveFrom,
                    payload,
                    source: seedRow.source,
                });
            }
            rows.push({
                kind: seedRow.kind,
                effectiveFrom: seedRow.effectiveFrom,
                action: "insert",
            });
            inserted += 1;
        }

        if (!dryRun && inserted > 0) {
            await logAudit(ctx, {
                orgId,
                actorId,
                action: "payroll.statutoryTable.seed",
                entityType: "organizations",
                entityId: orgId,
            });
        }

        return { dryRun, inserted, skipped, rows };
    },
});

/**
 * Seeds the §2.6 allowance catalogue into `allowanceTypes` for one org (P0.2).
 *
 * IDEMPOTENT by (orgId, code) and never overwrites: once an org renames RICE to
 * "Rice allowance ₱2,500", a reseed must not undo that edit. Codes are the join
 * key from a position row's `allowances[]`, so they are not renamed by the seed.
 */
export const seedAllowanceTypes = internalMutation({
    args: {
        orgId: v.id("organizations"),
        actorId: v.id("users"),
        dryRun: v.optional(v.boolean()),
    },
    returns: v.object({
        dryRun: v.boolean(),
        inserted: v.number(),
        skipped: v.number(),
    }),
    handler: async (ctx, { orgId, actorId, dryRun = false }) => {
        await requireAnyAdmin(ctx, actorId);
        await requireMembership(ctx, actorId, orgId);

        const existing = await ctx.db
            .query("allowanceTypes")
            .withIndex("by_org", (q) => q.eq("orgId", orgId))
            .collect();
        const codes = new Set(existing.map((row) => row.code));

        let inserted = 0;
        let skipped = 0;
        for (const type of ALLOWANCE_CATALOGUE) {
            if (codes.has(type.code)) {
                skipped += 1;
                continue;
            }
            if (!dryRun) {
                await ctx.db.insert("allowanceTypes", {
                    orgId,
                    code: type.code,
                    description: type.description,
                    unit: type.unit,
                    taxable: type.taxable,
                    deMinimisKind: type.deMinimisKind,
                    active: true,
                });
            }
            inserted += 1;
        }

        if (!dryRun && inserted > 0) {
            await logAudit(ctx, {
                orgId,
                actorId,
                action: "payroll.allowanceTypes.seed",
                entityType: "organizations",
                entityId: orgId,
            });
        }

        return { dryRun, inserted, skipped };
    },
});
