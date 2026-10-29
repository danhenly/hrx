import { ConvexError, v } from "convex/values";
import { internalMutation } from "../_generated/server";
import { logAudit } from "../audit";
import { requireAnyAdmin, requireMembership } from "../helpers";
import { msOfDateKey } from "../lib/payroll/calendar";
import { semiMonthlyBrackets } from "../lib/payroll/tax";
import { ALLOWANCE_CATALOGUE, STATUTORY_SEED, type StatutorySeedRow } from "./statutorySeed";

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
/**
 * The payload to store for a seed row. The tax row carries its DERIVED semi-monthly
 * table, exactly as statutoryTables.upsert would, so a seeded table and an
 * admin-edited one have the same shape.
 */
function buildPayload(seedRow: StatutorySeedRow): unknown {
    if (seedRow.kind !== "tax") return seedRow.payload;
    const annualBrackets = (
        seedRow.payload as {
            annualBrackets: {
                from: number;
                to: number | null;
                base: number;
                rate: number;
            }[];
        }
    ).annualBrackets;
    return { ...(seedRow.payload as object), semiMonthly: semiMonthlyBrackets(annualBrackets) };
}

export const seedStatutoryTables = internalMutation({
    args: {
        orgId: v.id("organizations"),
        actorId: v.id("users"),
        dryRun: v.optional(v.boolean()),
        /**
         * Overwrite rows whose (kind, effectiveFrom) already exists. Off by default
         * because after the first seed the app is the system of record and an
         * admin's edits must survive a re-seed; it exists so a CORRECTED mirror
         * (e.g. the EC bands and MPF split added after the first seed) can be
         * applied before go-live without hand-editing six rows.
         */
        refresh: v.optional(v.boolean()),
    },
    returns: v.object({
        dryRun: v.boolean(),
        inserted: v.number(),
        refreshed: v.number(),
        skipped: v.number(),
        rows: v.array(
            v.object({
                kind: v.string(),
                effectiveFrom: v.string(),
                action: v.union(
                    v.literal("insert"),
                    v.literal("refresh"),
                    v.literal("skip"),
                ),
            }),
        ),
    }),
    handler: async (ctx, { orgId, actorId, dryRun = false, refresh = false }) => {
        await requireAnyAdmin(ctx, actorId);
        await requireMembership(ctx, actorId, orgId);

        const existing = await ctx.db.query("statutoryTables").collect();
        const byKey = new Map(
            existing.map((row) => [`${row.kind}|${row.effectiveFrom}`, row]),
        );

        const rows: {
            kind: string;
            effectiveFrom: string;
            action: "insert" | "refresh" | "skip";
        }[] = [];
        let inserted = 0;
        let refreshed = 0;
        let skipped = 0;

        for (const seedRow of STATUTORY_SEED) {
            const effectiveFrom = msOfDateKey(seedRow.effectiveFrom);
            const key = `${seedRow.kind}|${effectiveFrom}`;
            const existingRow = byKey.get(key);
            if (existingRow) {
                if (!refresh) {
                    rows.push({
                        kind: seedRow.kind,
                        effectiveFrom: seedRow.effectiveFrom,
                        action: "skip",
                    });
                    skipped += 1;
                    continue;
                }
                if (!dryRun) {
                    await ctx.db.patch(existingRow._id, {
                        payload: buildPayload(seedRow),
                        source: seedRow.source,
                    });
                }
                rows.push({
                    kind: seedRow.kind,
                    effectiveFrom: seedRow.effectiveFrom,
                    action: "refresh",
                });
                refreshed += 1;
                continue;
            }

            const payload = buildPayload(seedRow);

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

        return { dryRun, inserted, refreshed, skipped, rows };
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
        /**
         * Overwrite rows whose (kind, effectiveFrom) already exists. Off by default
         * because after the first seed the app is the system of record and an
         * admin's edits must survive a re-seed; it exists so a CORRECTED mirror
         * (e.g. the EC bands and MPF split added after the first seed) can be
         * applied before go-live without hand-editing six rows.
         */
        refresh: v.optional(v.boolean()),
    },
    returns: v.object({
        dryRun: v.boolean(),
        inserted: v.number(),
        skipped: v.number(),
    }),
    handler: async (ctx, { orgId, actorId, dryRun = false, refresh = false }) => {
        await requireAnyAdmin(ctx, actorId);
        await requireMembership(ctx, actorId, orgId);

        const existing = await ctx.db
            .query("allowanceTypes")
            .withIndex("by_org", (q) => q.eq("orgId", orgId))
            .collect();
        const codes = new Set(existing.map((row) => row.code));

        let inserted = 0;
        let refreshed = 0;
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
