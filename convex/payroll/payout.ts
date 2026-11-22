import { ConvexError, v } from "convex/values";
import { mutation, query } from "../_generated/server";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { logAudit } from "../audit";
import { requireAuth, requireMembership } from "../helpers";
import {
    BANK_LAYOUTS,
    renderBankFile,
    renderRegisterCsv,
    type DisbursementRow,
} from "../lib/payroll/bankFiles";
import { sha256Hex } from "../lib/payroll/sha256";

/**
 * Money out (P4.1/P4.2).
 *
 * Only an APPROVED run produces a bank file: paying from a computed-but-unapproved
 * register is the whole failure mode D12 exists to prevent. Every artefact is stored
 * with its SHA-256 so a re-download can be proven to be the same bytes.
 */

/** Payslip lines in the order a printed slip shows them. */
const LINE_ORDER: Record<string, number> = {
    BASIC: 0,
    RH: 1,
    SH: 2,
    RD: 3,
    RH_UNWORKED: 4,
    OT: 5,
    ND: 6,
    ABSENCE: 50,
    SSS: 51,
    PHIC: 52,
    HDMF: 53,
    TAX: 54,
};

/**
 * One printable sheet, assembled from documents already in memory.
 *
 * The employee copy never shows the employer shares: D3 is explicit that they are
 * cost, not deduction, and a payslip showing them reads as money taken from the
 * employee. They stay on the run pack (HR copy).
 */
function buildPayslipSheet({
    payslip,
    employee,
    org,
    run,
    period,
    lines,
}: {
    payslip: Doc<"payslips">;
    employee: Doc<"employees">;
    org: Doc<"organizations"> | null;
    run: Doc<"payrollRuns">;
    period: Doc<"payrollPeriods"> | null;
    lines: Doc<"payslipLines">[];
}) {
    const visible = lines
        .filter((line) => line.kind !== "employer_cost")
        .sort(
            (a, b) =>
                (LINE_ORDER[a.code] ?? 40) - (LINE_ORDER[b.code] ?? 40) ||
                a.code.localeCompare(b.code),
        );

    return {
        payslip,
        employee: {
            name: `${employee.firstName} ${employee.lastName}`.trim(),
        },
        org: { name: org?.name ?? "" },
        run: { version: run.version, status: run.status },
        period,
        lines: visible,
        memos: lines.filter((line) => line.kind === "memo"),
    };
}

/** The printable/payslip payload, shared by the HR view and the tokenised portal. */
export async function loadPrintablePayslip(
    ctx: QueryCtx,
    payslipId: Id<"payslips">,
) {
    const payslip = await ctx.db.get(payslipId);
    if (!payslip) throw new ConvexError("Payslip not found");
    const [employee, run, lines] = await Promise.all([
        ctx.db.get(payslip.employeeId),
        ctx.db.get(payslip.runId),
        ctx.db
            .query("payslipLines")
            .withIndex("by_payslip", (q) => q.eq("payslipId", payslipId))
            .collect(),
    ]);
    if (!employee || !run) throw new ConvexError("Payslip is missing its employee or run");
    const [period, org] = await Promise.all([
        ctx.db.get(run.periodId),
        ctx.db.get(payslip.orgId),
    ]);
    return buildPayslipSheet({ payslip, employee, org, run, period, lines });
}

/**
 * Every printable sheet of a run in ONE wave of reads.
 *
 * `printableForRun` used to call `loadPrintablePayslip` once per payslip, six reads
 * each — ~7,200 sequential reads to print a 1,200-head run. The run's lines,
 * employees, org and period are now read once and the sheets assembled from maps,
 * so the read count is the same for 1 payslip and for 1,200.
 */
export async function loadPrintablePayslips(
    ctx: QueryCtx,
    run: Doc<"payrollRuns">,
) {
    const [period, org, payslips, employees, lines] = await Promise.all([
        ctx.db.get(run.periodId),
        ctx.db.get(run.orgId),
        ctx.db
            .query("payslips")
            .withIndex("by_run", (q) => q.eq("runId", run._id))
            .collect(),
        ctx.db
            .query("employees")
            .withIndex("by_org", (q) => q.eq("orgId", run.orgId))
            .collect(),
        ctx.db
            .query("payslipLines")
            .withIndex("by_run", (q) => q.eq("runId", run._id))
            .collect(),
    ]);
    const employeeById = new Map(employees.map((employee) => [String(employee._id), employee]));
    const linesByPayslip = new Map<string, Doc<"payslipLines">[]>();
    for (const line of lines) {
        const key = String(line.payslipId);
        const bucket = linesByPayslip.get(key);
        if (bucket) bucket.push(line);
        else linesByPayslip.set(key, [line]);
    }
    return payslips.map((payslip) => {
        const employee = employeeById.get(String(payslip.employeeId));
        if (!employee) throw new ConvexError("Payslip is missing its employee or run");
        return buildPayslipSheet({
            payslip,
            employee,
            org,
            run,
            period,
            lines: linesByPayslip.get(String(payslip._id)) ?? [],
        });
    });
}

/** HR view of one printable payslip. */
export const printable = query({
    args: { payslipId: v.id("payslips") },
    handler: async (ctx, { payslipId }) => {
        const userId = await requireAuth(ctx);
        const payslip = await ctx.db.get(payslipId);
        if (!payslip) throw new ConvexError("Payslip not found");
        await requireMembership(ctx, userId, payslip.orgId);
        return loadPrintablePayslip(ctx, payslipId);
    },
});

/** Artefacts already generated for a run. */
export const listArtefacts = query({
    args: { runId: v.id("payrollRuns") },
    handler: async (ctx, { runId }) => {
        const userId = await requireAuth(ctx);
        const run = await ctx.db.get(runId);
        if (!run) throw new ConvexError("Run not found");
        await requireMembership(ctx, userId, run.orgId);
        return ctx.db
            .query("payrollArtefacts")
            .withIndex("by_run", (q) => q.eq("runId", runId))
            .collect();
    },
});

/**
 * Net pay per employee, joined to the bank account the money goes to.
 *
 * `preloaded` is for a caller that has already read the run's payslips and employees
 * (the run pack needs both for its register): without it they are read again in a
 * second full pass. The statutory ids are always read once, org-scoped — they used to
 * be an `.unique()` per payslip, i.e. 1,200 sequential reads on a 1,200-head run.
 */
async function disbursementRows(
    ctx: QueryCtx,
    orgId: Id<"organizations">,
    runId: Id<"payrollRuns">,
    reference: string,
    preloaded?: {
        payslips?: Doc<"payslips">[];
        employeeById?: Map<string, Doc<"employees">>;
    },
) {
    const [payslips, employeeById, statutoryIdRows] = await Promise.all([
        preloaded?.payslips
            ? preloaded.payslips
            : ctx.db
                  .query("payslips")
                  .withIndex("by_run", (q) => q.eq("runId", runId))
                  .collect(),
        preloaded?.employeeById
            ? preloaded.employeeById
            : ctx.db
                  .query("employees")
                  .withIndex("by_org", (q) => q.eq("orgId", orgId))
                  .collect()
                  .then(
                      (employees) =>
                          new Map(
                              employees.map((employee) => [
                                  String(employee._id),
                                  employee,
                              ]),
                          ),
                  ),
        // One org-scoped read: the bank account is the only field needed, and the
        // per-payslip `.unique()` this replaces made a 1,200-head run 1,200 reads.
        ctx.db
            .query("employeeStatutoryIds")
            .withIndex("by_org_employee", (q) => q.eq("orgId", orgId))
            .collect(),
    ]);

    const idsByEmployee = new Map(
        statutoryIdRows.map((row) => [String(row.employeeId), row]),
    );

    const rows: DisbursementRow[] = [];
    const missing: { employeeId: string; reason: string }[] = [];
    for (const payslip of payslips) {
        const employee = employeeById.get(String(payslip.employeeId));
        const ids = idsByEmployee.get(String(payslip.employeeId));
        const name = employee
            ? `${employee.firstName} ${employee.lastName}`.trim()
            : "(unknown)";
        if (!ids?.bank?.accountNumber) {
            // A row without an account cannot be paid, and silently dropping it
            // pays everyone except the one person who checks.
            missing.push({ employeeId: payslip.employeeId, reason: `No bank account for ${name}` });
            continue;
        }
        rows.push({
            accountNumber: ids.bank.accountNumber,
            accountName: ids.bank.accountName || name,
            amount: payslip.net,
            reference,
        });
    }
    return { rows, missing, total: rows.reduce((sum, row) => sum + row.amount, 0) };
}

/**
 * Render and store a bank file for an approved run (P4.1).
 *
 * Refuses a run that is not approved, and refuses to quietly omit an employee with
 * no bank account — it returns them in `missing` so the run cannot be paid short.
 */
export async function generateBankFileCore(
    ctx: MutationCtx,
    {
        userId,
        orgId,
        runId,
        layoutId,
    }: {
        userId: Id<"users">;
        orgId: Id<"organizations">;
        runId: Id<"payrollRuns">;
        layoutId: "bdo" | "generic";
    },
) {
    {
        const run = await ctx.db.get(runId);
        if (!run || run.orgId !== orgId) throw new ConvexError("Run not found");
        if (run.status !== "approved" && run.status !== "paid") {
            throw new ConvexError(
                "Only an approved run produces a bank file — approve it first",
            );
        }

        const layout = BANK_LAYOUTS.find((entry) => entry.id === layoutId);
        if (!layout) throw new ConvexError("Unknown bank layout");

        const reference = `RUN-${runId}-v${run.version}`;
        const { rows, missing, total } = await disbursementRows(ctx, orgId, runId, reference);

        // Name the employees the file would leave out BEFORE the totals are compared:
        // an omitted row only surfaces as a net-total mismatch, which reads as a broken
        // register rather than "these people have no bank account".
        if (missing.length > 0) {
            const listed = missing
                .slice(0, 5)
                .map((row) => row.reason)
                .join("; ");
            const rest = missing.length > 5 ? `; ...and ${missing.length - 5} more` : "";
            throw new ConvexError(
                `${missing.length} employee(s) have no bank account, so the bank file cannot cover the run's net pay: ${listed}${rest}. Add their bank details under Employees > Government & Bank, then generate the file again.`,
            );
        }

        const file = renderBankFile({ layout, rows, runId, version: run.version });

        // The register's net total and the file's total must agree to the centavo.
        if (Math.abs(total - run.totals.net) > 0.005) {
            throw new ConvexError(
                `The bank file totals ${total.toFixed(2)} but the register's net is ${run.totals.net.toFixed(2)} — refusing to emit a file that does not reconcile`,
            );
        }

        const artefactId = await ctx.db.insert("payrollArtefacts", {
            orgId,
            runId,
            kind: "bank_file",
            layout: layout.id,
            filename: file.filename,
            content: file.content,
            sha256: file.sha256,
            rowCount: file.rowCount,
            total: file.total,
            createdBy: userId,
            createdAt: Date.now(),
        });

        await logAudit(ctx, {
            orgId,
            actorId: userId,
            action: "payroll.bankFile.generate",
            entityType: "payrollRuns",
            entityId: runId,
        });

        return {
            artefactId,
            filename: file.filename,
            content: file.content,
            sha256: file.sha256,
            rowCount: file.rowCount,
            total: file.total,
            verified: layout.verified,
            layoutNote: layout.note,
            missing,
        };
    }
}

export const generateBankFile = mutation({
    args: {
        orgId: v.id("organizations"),
        runId: v.id("payrollRuns"),
        layoutId: v.union(v.literal("bdo"), v.literal("generic")),
    },
    handler: async (ctx, args) => {
        const userId = await requireAuth(ctx);
        await requireMembership(ctx, userId, args.orgId);
        return generateBankFileCore(ctx, { userId, ...args });
    },
});

/**
 * The run pack (P4.2): register CSV + bank file + a payslip index, in one download.
 * The government schedules are P6 and are omitted with a visible note rather than a
 * section that looks broken.
 */
export async function generateRunPackCore(
    ctx: MutationCtx,
    {
        userId,
        orgId,
        runId,
    }: { userId: Id<"users">; orgId: Id<"organizations">; runId: Id<"payrollRuns"> },
) {
    {
        const run = await ctx.db.get(runId);
        if (!run || run.orgId !== orgId) throw new ConvexError("Run not found");
        if (run.status !== "approved" && run.status !== "paid") {
            throw new ConvexError("Only an approved run has a pack");
        }

        const [period, org, payslips, employees] = await Promise.all([
            ctx.db.get(run.periodId),
            ctx.db.get(orgId),
            ctx.db
                .query("payslips")
                .withIndex("by_run", (q) => q.eq("runId", runId))
                .collect(),
            // The register and the bank file both name these employees; reading the
            // org once here is what stops `disbursementRows` reading them a second time.
            ctx.db
                .query("employees")
                .withIndex("by_org", (q) => q.eq("orgId", orgId))
                .collect(),
        ]);
        const employeeById = new Map(
            employees.map((employee) => [String(employee._id), employee]),
        );

        const registerRows = payslips.map((payslip) => {
            const employee = employeeById.get(String(payslip.employeeId));
            return {
                employeeName: employee
                    ? `${employee.firstName} ${employee.lastName}`.trim()
                    : "(unknown)",
                gross: payslip.gross,
                totalDeductions: payslip.totalDeductions,
                net: payslip.net,
                employerCost: payslip.employerCost,
            };
        });
        const registerCsv = renderRegisterCsv(
            registerRows.sort((a, b) => a.employeeName.localeCompare(b.employeeName)),
        );

        const reference = `RUN-${runId}-v${run.version}`;
        const { rows, missing } = await disbursementRows(ctx, orgId, runId, reference, {
            payslips,
            employeeById,
        });
        const generic = BANK_LAYOUTS.find((entry) => entry.id === "generic");
        const bank = generic
            ? renderBankFile({
                  layout: generic,
                  rows,
                  runId,
                  version: run.version,
              })
            : null;

        const day = (ms: number) => new Date(ms + 8 * 3_600_000).toISOString().slice(0, 10);
        const header = [
            `HRX payroll run pack`,
            `organisation: ${org?.name ?? ""}`,
            `period: ${period ? `${day(period.startDate)} -> ${day(period.endDate)}` : "?"}`,
            `pay date: ${period ? day(period.payDate) : "?"}`,
            `run: v${run.version} (${run.status})`,
            `payslips: ${run.totals.employeeCount}`,
            `gross: ${run.totals.gross.toFixed(2)}  deductions: ${run.totals.deductions.toFixed(2)}  net: ${run.totals.net.toFixed(2)}`,
            `employer cost: ${run.totals.employerCost.toFixed(2)}`,
            "",
            `NOTE: the SSS R-3 / PhilHealth EPRS / Pag-IBIG MCRF / BIR 1601-C schedules are P6 and are NOT in this pack.`,
            missing.length > 0
                ? `WARNING: ${missing.length} employee(s) have no bank account: ${missing.map((row) => row.reason).join("; ")}`
                : "All employees have a bank account.",
            "",
            "== REGISTER (CSV) ==",
            registerCsv.trimEnd(),
            "",
            "== BANK FILE (generic) ==",
            bank ? bank.content.trimEnd() : "(not generated)",
        ].join("\r\n");

        const content = `${header}\r\n`;
        const sha256OfPack = sha256Hex(content);

        const artefactId = await ctx.db.insert("payrollArtefacts", {
            orgId,
            runId,
            kind: "run_pack",
            layout: "",
            filename: `hrx-${runId}-v${run.version}-pack.txt`,
            content,
            sha256: sha256OfPack,
            rowCount: payslips.length,
            total: run.totals.net,
            createdBy: userId,
            createdAt: Date.now(),
        });

        await logAudit(ctx, {
            orgId,
            actorId: userId,
            action: "payroll.runPack.generate",
            entityType: "payrollRuns",
            entityId: runId,
        });

        return {
            artefactId,
            filename: `hrx-${runId}-v${run.version}-pack.txt`,
            content,
            sha256: sha256OfPack,
            rowCount: payslips.length,
            total: run.totals.net,
            missing,
        };
    }
}

export const generateRunPack = mutation({
    args: { orgId: v.id("organizations"), runId: v.id("payrollRuns") },
    handler: async (ctx, { orgId, runId }) => {
        const userId = await requireAuth(ctx);
        await requireMembership(ctx, userId, orgId);
        return generateRunPackCore(ctx, { userId, orgId, runId });
    },
});

/** Every payslip of a run, ready to print one per A4 page (P4.3). */
export const printableForRun = query({
    args: { runId: v.id("payrollRuns") },
    handler: async (ctx, { runId }) => {
        const userId = await requireAuth(ctx);
        const run = await ctx.db.get(runId);
        if (!run) throw new ConvexError("Run not found");
        await requireMembership(ctx, userId, run.orgId);
        const sheets = await loadPrintablePayslips(ctx, run);
        return sheets.sort((a, b) => a.employee.name.localeCompare(b.employee.name));
    },
});