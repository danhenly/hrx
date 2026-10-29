import { ConvexError, v } from "convex/values";
import { mutation, query } from "../_generated/server";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { logAudit } from "../audit";
import { requireAdmin, requireAuth, requireMembership } from "../helpers";
import {
    bucketLines,
    build1601C,
    buildMcrf,
    buildR3,
    buildRf1,
    formFilename,
    renderFormCsv,
    type GovForm,
    type GovRow,
} from "../lib/payroll/govForms";
import { sha256Hex } from "../lib/payroll/sha256";

/**
 * Government schedules (P6).
 *
 * Everything here is assembled from what the register ACTUALLY booked — the payslip
 * lines — never recomputed from the statutory tables. A form is therefore a
 * restatement of a filed period, and it carries the table version it was produced
 * under so a later rate change cannot be read back into it (D17, D19/A9).
 */

const PARTIAL_CONTRIBUTION_NOTE =
    "A calendar month's remittance is the sum of its cutoffs; this schedule covers one period.";

function periodLabel(period: Doc<"payrollPeriods">): string {
    const fmt = (ms: number) =>
        new Intl.DateTimeFormat("en-CA", {
            timeZone: "Asia/Manila",
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
        }).format(new Date(ms));
    return `${fmt(period.startDate)} to ${fmt(period.endDate)}`;
}

/** `sss@2026-01-01` — the version string stamped on every form (D17). */
async function tableVersion(ctx: QueryCtx | MutationCtx, kind: string): Promise<string> {
    const rows = await ctx.db
        .query("statutoryTables")
        .withIndex("by_kind_effective", (q) => q.eq("kind", kind as never))
        .collect();
    if (rows.length === 0) return `${kind}@unseeded`;
    const latest = rows.reduce((a, b) => (a.effectiveFrom > b.effectiveFrom ? a : b));
    const date = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Manila",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).format(new Date(latest.effectiveFrom));
    return `${kind}@${date}`;
}

interface LoadedForms {
    forms: GovForm[];
    runKey: string;
    totals: {
        sssEmployee: number;
        sssEmployer: number;
        sssEc: number;
        philhealthEmployee: number;
        philhealthEmployer: number;
        pagibigEmployee: number;
        pagibigEmployer: number;
        tax: number;
        gross: number;
        taxable: number;
    };
}

export async function loadGovForms(
    ctx: QueryCtx | MutationCtx,
    { orgId, runId }: { orgId: Id<"organizations">; runId: Id<"payrollRuns"> },
): Promise<LoadedForms> {
    const run = await ctx.db.get(runId);
    if (!run || run.orgId !== orgId) throw new ConvexError("Run not found");
    if (run.status !== "approved" && run.status !== "paid") {
        throw new ConvexError("Only an approved run produces government schedules — approve it first");
    }

    const period = await ctx.db.get(run.periodId);
    if (!period) throw new ConvexError("Period not found");

    const [payslips, versions] = await Promise.all([
        ctx.db.query("payslips").withIndex("by_run", (q) => q.eq("runId", runId)).collect(),
        Promise.all([
            tableVersion(ctx, "sss"),
            tableVersion(ctx, "philhealth"),
            tableVersion(ctx, "pagibig"),
            tableVersion(ctx, "tax"),
        ]),
    ]);
    const [sssVersion, phVersion, hdmfVersion, taxVersion] = versions;

    const lines = await ctx.db
        .query("payslipLines")
        .withIndex("by_run", (q) => q.eq("runId", runId))
        .collect();

    // One bucket per payslip — the bucketing itself is pure and fixture-tested.
    const buckets = bucketLines(
        payslips.map((slip) => String(slip._id)),
        lines.map((line) => ({
            payslipId: String(line.payslipId),
            kind: line.kind,
            code: line.code,
            amount: line.amount,
            taxable: line.taxable,
        })),
    );

    const sssRows: GovRow[] = [];
    const phRows: GovRow[] = [];
    const hdmfRows: GovRow[] = [];
    const taxRows: GovRow[] = [];

    for (const slip of payslips) {
        const bucket = buckets[String(slip._id)];
        if (!bucket) continue;
        const employee = await ctx.db.get(slip.employeeId);
        const ids = await ctx.db
            .query("employeeStatutoryIds")
            .withIndex("by_org_employee", (q) =>
                q.eq("orgId", orgId).eq("employeeId", slip.employeeId),
            )
            .unique();
        const name = employee
            ? `${employee.lastName}, ${employee.firstName}`
            : String(slip.employeeId);
        sssRows.push({
            employeeId: String(slip.employeeId),
            name,
            reference: ids?.sssNumber ?? "",
            employeeCentavos: bucket.sss,
            employerCentavos: bucket.sssEr,
            extraCentavos: bucket.ec,
            loanCentavos: bucket.sssLoan,
        });
        phRows.push({
            employeeId: String(slip.employeeId),
            name,
            reference: ids?.philhealthNumber ?? "",
            employeeCentavos: bucket.phic,
            employerCentavos: bucket.phicEr,
        });
        hdmfRows.push({
            employeeId: String(slip.employeeId),
            name,
            reference: ids?.pagibigNumber ?? "",
            employeeCentavos: bucket.hdmf,
            employerCentavos: bucket.hdmfEr,
        });
        taxRows.push({
            employeeId: String(slip.employeeId),
            name,
            reference: ids?.tin ?? "",
            employeeCentavos: bucket.tax,
            employerCentavos: 0,
            grossCentavos: bucket.gross,
            taxableCentavos: bucket.taxable,
        });
    }

    const label = periodLabel(period);
    const forms: GovForm[] = [
        buildR3({ rows: sssRows, tableVersion: sssVersion, periodLabel: label }),
        buildRf1({ rows: phRows, tableVersion: phVersion, periodLabel: label }),
        buildMcrf({ rows: hdmfRows, tableVersion: hdmfVersion, periodLabel: label }),
        build1601C({ rows: taxRows, tableVersion: taxVersion, periodLabel: label }),
    ];
    forms[1].notes.push(PARTIAL_CONTRIBUTION_NOTE);
    forms[2].notes.push(PARTIAL_CONTRIBUTION_NOTE);

    const sss = forms[0].totals;
    const ph = forms[1].totals;
    const hdmf = forms[2].totals;
    const tax = forms[3].totals;

    return {
        forms,
        runKey: `${runId}-v${run.version}`,
        totals: {
            sssEmployee: sss.employeeCentavos,
            sssEmployer: sss.employerCentavos,
            sssEc: sss.extraCentavos,
            philhealthEmployee: ph.employeeCentavos,
            philhealthEmployer: ph.employerCentavos,
            pagibigEmployee: hdmf.employeeCentavos,
            pagibigEmployer: hdmf.employerCentavos,
            tax: tax.employeeCentavos,
            gross: tax.grossCentavos,
            taxable: tax.taxableCentavos,
        },
    };
}

/** Preview the four schedules without storing anything. */
export const previewGovForms = query({
    args: { orgId: v.id("organizations"), runId: v.id("payrollRuns") },
    handler: async (ctx, args) => {
        const userId = await requireAuth(ctx);
        await requireMembership(ctx, userId, args.orgId);
        return loadGovForms(ctx, args);
    },
});

/**
 * Store the four schedules as run artefacts. Regenerating a closed period is allowed
 * — the artefact keeps its own timestamp and table version, so the older file stays
 * as evidence of what was filed.
 */
export async function generateGovFormsCore(
    ctx: MutationCtx,
    {
        userId,
        orgId,
        runId,
    }: { userId: Id<"users">; orgId: Id<"organizations">; runId: Id<"payrollRuns"> },
) {
    const { forms, runKey } = await loadGovForms(ctx, { orgId, runId });

    const created: { id: string; filename: string; sha256: string; total: number }[] = [];
    for (const form of forms) {
        const content = renderFormCsv(form);
        const filename = formFilename(form, runKey);
        const sha256 = await sha256Hex(content);
        const id = await ctx.db.insert("payrollArtefacts", {
            orgId,
            runId,
            kind: "gov_schedule",
            layout: form.id,
            filename,
            content,
            sha256,
            rowCount: form.rows.length,
            total: form.totals.employeeCentavos + form.totals.employerCentavos,
            createdBy: userId,
            createdAt: Date.now(),
            tableVersion: form.tableVersion,
        });
        created.push({ id: String(id), filename, sha256, total: form.totals.employeeCentavos });
    }

    await logAudit(ctx, {
        orgId,
        actorId: userId,
        action: "payroll.govForms.generate",
        entityType: "payrollRuns",
        entityId: runId,
    });

    return { created };
}

export const generateGovForms = mutation({
    args: { orgId: v.id("organizations"), runId: v.id("payrollRuns") },
    handler: async (ctx, args) => {
        const userId = await requireAuth(ctx);
        await requireAdmin(ctx, userId, args.orgId);
        return generateGovFormsCore(ctx, { userId, ...args });
    },
});
