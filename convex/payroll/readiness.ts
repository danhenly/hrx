import { v } from "convex/values";
import { query } from "../_generated/server";
import { requireAuth, requireMembership } from "../helpers";
import { readinessReport, type ReadinessItem } from "../lib/payroll/readiness";

/**
 * Readiness audit (P9).
 *
 * Everything here is a fact read from the org's own data, ordered so the first blocker
 * is the thing that would break payday soonest. It never mutates anything: a fix is
 * always an action the admin takes on the page it points at.
 */
export const audit = query({
    args: { orgId: v.id("organizations") },
    handler: async (ctx, { orgId }) => {
        const userId = await requireAuth(ctx);
        await requireMembership(ctx, userId, orgId);

        const [employees, positions, statutoryIds, tables, periods, runs, leaveTypes, loans, organisation] =
            await Promise.all([
                ctx.db.query("employees").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect(),
                ctx.db.query("employeePositions").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect(),
                ctx.db.query("employeeStatutoryIds").withIndex("by_org_employee", (q) => q.eq("orgId", orgId)).collect(),
                ctx.db.query("statutoryTables").collect(),
                ctx.db.query("payrollPeriods").withIndex("by_org_start", (q) => q.eq("orgId", orgId)).collect(),
                ctx.db.query("payrollRuns").withIndex("by_org_period", (q) => q.eq("orgId", orgId)).collect(),
                ctx.db.query("leaveTypes").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect(),
                ctx.db.query("loanAccounts").withIndex("by_org_employee", (q) => q.eq("orgId", orgId)).collect(),
                ctx.db.get(orgId),
            ]);

        // "active" is the only status that gets paid; on_leave and terminated do not.
        const activeEmployees = employees.filter((employee) => employee.status === "active");
        const items: ReadinessItem[] = [];

        const idsByEmployee = new Map(statutoryIds.map((row) => [String(row.employeeId), row]));
        const positionsByEmployee = new Map<string, number>();
        for (const row of positions) {
            const key = String(row.employeeId);
            positionsByEmployee.set(key, (positionsByEmployee.get(key) ?? 0) + 1);
        }

        // 1. Statutory tables: without these nothing can be computed at all.
        for (const kind of ["sss", "philhealth", "pagibig", "tax"] as const) {
            const rows = tables.filter((row) => row.kind === kind);
            items.push({
                id: `table.${kind}`,
                severity: "blocker",
                title: `No ${kind.toUpperCase()} table is seeded`,
                count: rows.length === 0 ? 1 : 0,
                detail:
                    rows.length === 0
                        ? `${kind.toUpperCase()} contributions cannot be computed, so no payslip can be produced.`
                        : `${rows.length} version(s) seeded.`,
                fix: "Settings → Payroll → Statutory tables",
            });
        }

        // 2. Every active employee needs a position row; pay terms live there (D15).
        const withoutPosition = activeEmployees.filter((employee) => !positionsByEmployee.has(String(employee._id)));
        items.push({
            id: "employee.position",
            severity: "blocker",
            title: "Active employees with no position row",
            count: withoutPosition.length,
            detail:
                withoutPosition.length === 0
                    ? "Every active employee has a pay-bearing position."
                    : `${withoutPosition.slice(0, 5).map((e) => `${e.lastName}, ${e.firstName}`).join("; ")}${withoutPosition.length > 5 ? " …" : ""}`,
            fix: "Employees → Position History → add a position with pay terms",
        });

        // 3. Statutory identifiers: an incomplete filing.
        for (const field of ["sssNumber", "philhealthNumber", "pagibigNumber", "tin"] as const) {
            const missing = activeEmployees.filter((employee) => {
                const row = idsByEmployee.get(String(employee._id));
                return !row || !row[field] || String(row[field]).trim().length === 0;
            });
            items.push({
                id: `id.${field}`,
                severity: "warning",
                title: `Missing ${field}`,
                count: missing.length,
                detail:
                    missing.length === 0
                        ? "All active employees have this number."
                        : `${missing.length} active employee(s) cannot be filed for this identifier.`,
                fix: "Employees → Government & Bank",
            });
        }

        // 4. A bank account is needed for the disbursement file (D11).
        const withoutBank = activeEmployees.filter(
            (employee) => !idsByEmployee.get(String(employee._id))?.bank,
        );
        items.push({
            id: "bank.account",
            severity: "blocker",
            title: "Active employees with no bank account",
            count: withoutBank.length,
            detail:
                withoutBank.length === 0
                    ? "Every active employee has an ATM account for the bank file."
                    : `${withoutBank.length} employee(s) would be excluded from the bank file — they would not be paid by transfer.`,
            fix: "Employees → Government & Bank",
        });

        // 5. Periods and an approved run.
        items.push({
            id: "period.exists",
            severity: "blocker",
            title: "No payroll period exists",
            count: periods.length === 0 ? 1 : 0,
            detail: periods.length === 0 ? "A run needs a period to compute." : `${periods.length} period(s) defined.`,
            fix: "Payroll → create a period",
        });
        const approved = runs.filter((run) => run.status === "approved" || run.status === "paid");
        items.push({
            id: "run.approved",
            severity: "warning",
            title: "No approved run yet",
            count: approved.length === 0 ? 1 : 0,
            detail:
                approved.length === 0
                    ? "Nothing has been approved, so no artefact (bank file, schedules) can be produced."
                    : `${approved.length} run(s) approved or paid.`,
            fix: "Payroll → compute → review → approve",
        });

        // 6. Leave types, so SIL is a balance and not an assumption (P8).
        items.push({
            id: "leave.types",
            severity: "warning",
            title: "Leave types not seeded",
            count: leaveTypes.length === 0 ? 1 : 0,
            detail:
                leaveTypes.length === 0
                    ? "SIL will convert as zero at separation because nothing accrued."
                    : `${leaveTypes.length} leave type(s) configured.`,
            fix: "Employees → Leave → Seed leave types",
        });

        // 7. Loans that cannot be amortised block the payslip (D9).
        const blockedLoans = loans.filter((loan) => loan.status === "active" && loan.amortisation <= 0);
        items.push({
            id: "loan.schedule",
            severity: "warning",
            title: "Active loans with no amortisation",
            count: blockedLoans.length,
            detail:
                blockedLoans.length === 0
                    ? "Every active loan has a scheduled amortisation."
                    : `${blockedLoans.length} loan(s) will never be collected.`,
            fix: "Employees → Loans",
        });

        // 8. Test data left behind is a blocker for a live run: it is real money.
        items.push({
            id: "org.testdata",
            severity: "blocker",
            title: "This organisation is flagged as TEST data",
            count: organisation?.payrollSettings?.isTestOrg ? 1 : 0,
            detail: organisation?.payrollSettings?.isTestOrg
                ? "A test org must not receive a live payroll run."
                : "Not a test org.",
            fix: "Settings → Payroll",
        });

        const report = readinessReport(items);
        return { ...report, items, employees: activeEmployees.length };
    },
});
