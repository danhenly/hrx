import { ConvexError, v } from "convex/values";
import { mutation, query } from "../_generated/server";
import { logAudit } from "../audit";
import { requireAuth, requireMembership } from "../helpers";

// ─── Validation ────────────────────────────────────────────────────────────

/**
 * Government numbers are typed off a physical card, so the only real risk is a
 * typo or a pasted sentence. Rejecting letters catches both; the agencies'
 * exact groupings differ and are NOT enforced here, because a format rule that
 * disagrees with a card is a support ticket, not a safeguard.
 */
function cleanId(value: string | undefined, label: string): string | undefined {
    if (value === undefined) return undefined;
    const trimmed = value.trim();
    if (trimmed === "") return undefined;
    if (!/^[0-9][0-9\- ]{4,19}$/.test(trimmed)) {
        throw new ConvexError(
            `${label} must be digits with optional dashes, 5–20 characters`,
        );
    }
    return trimmed;
}

/** What D16 requires before a payslip may compute. */
function missingForPayroll(row: {
    sssNumber?: string;
    philhealthNumber?: string;
    pagibigNumber?: string;
    tin?: string;
    bank?: unknown;
}) {
    const missing: { field: string; required: boolean; note?: string }[] = [];
    if (!row.sssNumber) missing.push({ field: "sssNumber", required: true });
    if (!row.philhealthNumber) missing.push({ field: "philhealthNumber", required: true });
    if (!row.pagibigNumber) missing.push({ field: "pagibigNumber", required: true });
    if (!row.bank) missing.push({ field: "bank", required: true });
    if (!row.tin) {
        missing.push({
            field: "tin",
            required: false,
            note: "TIN has a documented fallback for new hires who have not been issued one yet (D16)",
        });
    }
    return missing;
}

// ─── Queries ───────────────────────────────────────────────────────────────

/** The employee's Government & Bank row (D16), or null before it is filled. */
export const get = query({
    args: { employeeId: v.id("employees") },
    handler: async (ctx, { employeeId }) => {
        const userId = await requireAuth(ctx);
        const employee = await ctx.db.get(employeeId);
        if (!employee) throw new ConvexError("Employee not found");
        await requireMembership(ctx, userId, employee.orgId);

        const row = await ctx.db
            .query("employeeStatutoryIds")
            .withIndex("by_org_employee", (q) =>
                q.eq("orgId", employee.orgId).eq("employeeId", employeeId),
            )
            .unique();

        return {
            row: row ?? null,
            // Surfaced so the section can show "3 things still missing" instead of
            // letting a payslip discover it at compute time.
            missingForPayroll: missingForPayroll(row ?? {}),
        };
    },
});

// ─── Mutations ─────────────────────────────────────────────────────────────

/**
 * Create or update an employee's government numbers and ATM/bank account
 * (D16). `admin` and `hr` only — in this app both roles are the payroll roles
 * (roleValidator), and the section is never rendered in a member-facing view.
 *
 * Audited PII-light: the audit row names the employee and the action, never the
 * numbers themselves (Phase 1 rule in convex/audit.ts).
 */
export const update = mutation({
    args: {
        employeeId: v.id("employees"),
        sssNumber: v.optional(v.string()),
        philhealthNumber: v.optional(v.string()),
        pagibigNumber: v.optional(v.string()),
        tin: v.optional(v.string()),
        bank: v.optional(
            v.object({
                bank: v.string(),
                accountName: v.string(),
                accountNumber: v.string(),
                accountType: v.union(
                    v.literal("atm"),
                    v.literal("savings"),
                    v.literal("current"),
                ),
            }),
        ),
        otherIds: v.optional(
            v.array(v.object({ label: v.string(), value: v.string() })),
        ),
    },
    handler: async (ctx, args) => {
        const userId = await requireAuth(ctx);
        const employee = await ctx.db.get(args.employeeId);
        if (!employee) throw new ConvexError("Employee not found");
        await requireMembership(ctx, userId, employee.orgId);

        const bank = args.bank
            ? {
                  bank: args.bank.bank.trim(),
                  accountName: args.bank.accountName.trim(),
                  accountNumber: args.bank.accountNumber.trim(),
                  accountType: args.bank.accountType,
              }
            : undefined;
        if (bank) {
            if (bank.bank.length < 2) throw new ConvexError("Bank name is required");
            if (bank.accountName.length < 2) {
                throw new ConvexError("Account name is required");
            }
            if (!/^[0-9\- ]{6,24}$/.test(bank.accountNumber)) {
                throw new ConvexError(
                    "Account number must be 6–24 digits (dashes allowed)",
                );
            }
        }

        const otherIds = args.otherIds
            ?.map((row) => ({ label: row.label.trim(), value: row.value.trim() }))
            .filter((row) => row.label !== "" && row.value !== "");
        if (otherIds && otherIds.length > 10) {
            throw new ConvexError("At most 10 other IDs");
        }

        const fields = {
            sssNumber: cleanId(args.sssNumber, "SSS number"),
            philhealthNumber: cleanId(args.philhealthNumber, "PhilHealth number"),
            pagibigNumber: cleanId(args.pagibigNumber, "Pag-IBIG number"),
            tin: cleanId(args.tin, "TIN"),
            bank,
            otherIds: otherIds && otherIds.length > 0 ? otherIds : undefined,
            updatedBy: userId,
            updatedAt: Date.now(),
        };

        const existing = await ctx.db
            .query("employeeStatutoryIds")
            .withIndex("by_org_employee", (q) =>
                q.eq("orgId", employee.orgId).eq("employeeId", args.employeeId),
            )
            .unique();

        const id = existing
            ? (await ctx.db.patch(existing._id, fields), existing._id)
            : await ctx.db.insert("employeeStatutoryIds", {
                  orgId: employee.orgId,
                  employeeId: args.employeeId,
                  ...fields,
              });

        await logAudit(ctx, {
            orgId: employee.orgId,
            actorId: userId,
            action: "employee.statutoryIds.update",
            entityType: "employees",
            entityId: args.employeeId,
        });

        return { id, missingForPayroll: missingForPayroll(fields) };
    },
});
