import type { Doc, Id } from "../_generated/dataModel";
import { PH_OFFSET_MS } from "../lib/payroll/calendar";
import type { QueryCtx } from "../_generated/server";
import { ConvexError } from "convex/values";
import { computePayslip } from "../lib/payroll/engine";
import { resolvePayTerms } from "../lib/payroll/rates";
import type { Bracket } from "../lib/payroll/tax";
import type {
    PagibigTable,
    PhilhealthTable,
    SssTable,
} from "../lib/payroll/statutory";
import type {
    Adjustment,
    Allowance,
    DayRecord,
    DeminimisTable,
    HolidayRule,
    Money,
    PayResult,
} from "../lib/payroll/types";
import type { LoanState } from "../lib/payroll/loans";

/**
 * The ONE place an employee's payroll inputs are assembled.
 *
 * The preview and the run must never disagree about what an employee is owed — a
 * second loader is how "the preview said ₱X" becomes an argument during a payroll
 * review. Both call this, then hand the result to the same pure engine.
 */

export type StatutoryKind =
    | "sss"
    | "philhealth"
    | "pagibig"
    | "tax"
    | "deminimis"
    | "holiday";

export type TablesInForce = {
    sss?: SssTable;
    philhealth?: PhilhealthTable;
    pagibig?: PagibigTable;
    tax?: { annualBrackets: Bracket[]; thirteenthMonthExemptCeiling?: number };
    deminimis?: DeminimisTable;
    holidays: HolidayRule[];
    ids: {
        sss?: string;
        philhealth?: string;
        pagibig?: string;
        tax?: string;
        deminimis?: string;
        holiday?: string;
    };
    missing: StatutoryKind[];
};

export async function tableInForce(
    ctx: QueryCtx,
    kind: StatutoryKind,
    at: number,
): Promise<Doc<"statutoryTables"> | null> {
    const rows = await ctx.db
        .query("statutoryTables")
        .withIndex("by_kind_effective", (q) => q.eq("kind", kind))
        .collect();
    const eligible = rows
        .filter(
            (row) =>
                row.effectiveFrom <= at &&
                (row.effectiveTo === undefined || at < row.effectiveTo),
        )
        .sort((a, b) => a.effectiveFrom - b.effectiveFrom);
    return eligible.length > 0 ? eligible[eligible.length - 1] : null;
}

/** Every statutory table in force on `at`, with the ids a run must record. */
export async function loadStatutoryTables(
    ctx: QueryCtx,
    at: number,
): Promise<TablesInForce> {
    const [sss, philhealth, pagibig, tax, deminimis, holiday] = await Promise.all([
        tableInForce(ctx, "sss", at),
        tableInForce(ctx, "philhealth", at),
        tableInForce(ctx, "pagibig", at),
        tableInForce(ctx, "tax", at),
        tableInForce(ctx, "deminimis", at),
        tableInForce(ctx, "holiday", at),
    ]);
    const missing: StatutoryKind[] = [];
    if (!sss) missing.push("sss");
    if (!philhealth) missing.push("philhealth");
    if (!pagibig) missing.push("pagibig");
    if (!tax) missing.push("tax");

    return {
        sss: (sss?.payload as SssTable) ?? undefined,
        philhealth: (philhealth?.payload as PhilhealthTable) ?? undefined,
        pagibig: (pagibig?.payload as PagibigTable) ?? undefined,
        tax:
            (tax?.payload as {
                annualBrackets: Bracket[];
                thirteenthMonthExemptCeiling?: number;
            }) ?? undefined,
        deminimis: (deminimis?.payload as DeminimisTable) ?? undefined,
        holidays: ((holiday?.payload as { days?: HolidayRule[] })?.days ?? []),
        ids: {
            sss: sss?._id,
            philhealth: philhealth?._id,
            pagibig: pagibig?._id,
            tax: tax?._id,
            deminimis: deminimis?._id,
            holiday: holiday?._id,
        },
        missing,
    };
}

export type EmployeeContext = {
    employee: Doc<"employees">;
    positionRow: Doc<"employeePositions">;
    terms: Awaited<ReturnType<typeof resolvePayTerms>>["terms"];
    issues: string[];
    days: DayRecord[];
    /** Approved/locked entries that were NOT priced, with their status. */
    excluded: { entryId: string; status: string }[];
    allowances: Allowance[];
    adjustments: Adjustment[];
    /** Identifiers D16 requires before a payslip may exist (TIN has a fallback). */
    missingIds: string[];
    /** Active loans with this period's scheduled amortisation (D9). */
    loans: LoanState[];
    /** 13th month ledger for the employee's calendar year (D5). */
    thirteenth: { accruedPesos: number; paidPesos: number; exemptUsedPesos: number };
    /** Set when this period is the employee's final one (P5.3). */
    separation?: { lastDay: number; reason: string; silDaysUnpaid: number; yearsOfService: number };
};

/**
 * Assemble one employee's inputs for one period.
 *
 * Reads `approved` AND `locked` days: an approved-only filter silently drops every
 * locked day, and locking is the last step before a run (the Phase 1 export trap).
 */
export async function loadEmployeeContext(
    ctx: QueryCtx,
    args: {
        orgId: Id<"organizations">;
        employeeId: Id<"employees">;
        period: Doc<"payrollPeriods">;
    },
): Promise<EmployeeContext | { unresolved: string[] } | { notEmployed: true }> {
    const { orgId, employeeId, period } = args;
    const employee = await ctx.db.get(employeeId);
    if (!employee || employee.orgId !== orgId) {
        throw new ConvexError("Employee not found in this organisation");
    }

    const history = await ctx.db
        .query("employeePositions")
        .withIndex("by_employee_effective", (q) => q.eq("employeeId", employeeId))
        .order("desc")
        .collect();
    // In force means the row had STARTED by the period's end and had not already
    // ended before it began — a separated employee is simply not in this run, which
    // is different from being blocked.
    const positionRow = history.find(
        (row) =>
            row.effectiveDate <= period.endDate &&
            (row.endDate === undefined || row.endDate >= period.startDate),
    );
    if (!positionRow) {
        return { notEmployed: true };
    }

    const org = await ctx.db.get(orgId);
    const resolved = resolvePayTerms({
        position: positionRow,
        settings: org?.payrollSettings,
    });
    if (resolved.issues.length > 0) return { unresolved: resolved.issues };

    const entries = await ctx.db
        .query("timeEntries")
        .withIndex("by_org_employee_date", (q) =>
            q
                .eq("orgId", orgId)
                .eq("employeeId", employeeId)
                .gte("date", period.startDate)
                .lte("date", period.endDate),
        )
        .collect();
    const included = entries.filter(
        (entry) => entry.status === "approved" || entry.status === "locked",
    );
    const days: DayRecord[] = included
        .sort((a, b) => a.date - b.date)
        .map((entry) => ({
            entryId: entry._id,
            date: entry.date,
            totalMinutes: entry.totalMinutes,
            intervals: entry.intervals.map((interval) => ({
                start: interval.start,
                end: interval.end,
            })),
            status: entry.status,
        }));

    const catalogue = await ctx.db
        .query("allowanceTypes")
        .withIndex("by_org", (q) => q.eq("orgId", orgId))
        .collect();
    const unitByCode = new Map(catalogue.map((row) => [row.code, row.unit]));
    const allowances: Allowance[] = resolved.terms.allowances.map((allowance) => ({
        ...allowance,
        unit: unitByCode.get(allowance.code) ?? "monthly",
    }));

    const adjustmentRows = await ctx.db
        .query("adjustments")
        .withIndex("by_org_target", (q) =>
            q.eq("orgId", orgId).eq("targetPeriodId", period._id),
        )
        .collect();
    const adjustments: Adjustment[] = adjustmentRows
        .filter((row) => row.employeeId === employeeId)
        .map((row) => ({
            code: row.code,
            description: row.reason,
            amountCentavos: Math.round(row.amount * 100),
            reason: row.reason,
        }));

    const ids = await ctx.db
        .query("employeeStatutoryIds")
        .withIndex("by_org_employee", (q) =>
            q.eq("orgId", orgId).eq("employeeId", employeeId),
        )
        .unique();
    const missingIds: string[] = [];
    if (!ids?.sssNumber) missingIds.push("sssNumber");
    if (!ids?.philhealthNumber) missingIds.push("philhealthNumber");
    if (!ids?.pagibigNumber) missingIds.push("pagibigNumber");

    const loanRows = await ctx.db
        .query("loanAccounts")
        .withIndex("by_org_employee", (q) =>
            q.eq("orgId", orgId).eq("employeeId", employeeId),
        )
        .collect();
    const loans: LoanState[] = loanRows
        .filter((row) => row.status === "active" && row.balance > 0)
        .map((row) => ({
            id: row._id,
            type: row.type,
            balanceCentavos: Math.round(row.balance * 100),
            amortisationCentavos: Math.round(row.amortisation * 100),
            reference: row.reference,
        }));

    const year = new Date(period.endDate + PH_OFFSET_MS).getUTCFullYear();
    const ledger = await ctx.db
        .query("thirteenthMonthLedger")
        .withIndex("by_org_employee_year", (q) =>
            q.eq("orgId", orgId).eq("employeeId", employeeId).eq("year", year),
        )
        .unique();

    // Final period? A position row that ENDS inside this period is a separation, and
    // final pay applies to it. SIL is 5 days per completed year of service when the
    // employer has no leave ledger to say otherwise (Art. 95 is mandatory), and the
    // engine says so in a note rather than pretending the number is known.
    const separating =
        positionRow.endDate !== undefined && positionRow.endDate <= period.endDate;
    const yearsOfService = separating
        ? Math.floor(
              (positionRow.endDate! - employee.hireDate) / (365.25 * 24 * 3_600_000),
          )
        : 0;

    return {
        employee,
        positionRow,
        terms: resolved.terms,
        issues: [],
        loans,
        thirteenth: {
            accruedPesos: ledger?.accrued ?? 0,
            paidPesos: ledger?.paid ?? 0,
            exemptUsedPesos: ledger?.exemptUsed ?? 0,
        },
        separation: separating
            ? {
                  lastDay: positionRow.endDate!,
                  reason: "separation",
                  silDaysUnpaid: 5 * Math.max(0, yearsOfService),
                  yearsOfService,
              }
            : undefined,
        days,
        excluded: entries
            .filter((entry) => entry.status !== "approved" && entry.status !== "locked")
            .map((entry) => ({ entryId: entry._id, status: entry.status })),
        allowances,
        adjustments,
        missingIds,
    };
}

/** The half-of-month a period belongs to (D3's residue rule). */
export function cutoffIndexOf(period: Doc<"payrollPeriods">): 0 | 1 {
    const manila = new Date(period.startDate + 8 * 3_600_000);
    return manila.getUTCDate() <= 15 ? 0 : 1;
}

/** Run the engine for an assembled context. Pure compute; writes nothing. */
export function computeFromContext(args: {
    context: EmployeeContext;
    period: Doc<"payrollPeriods">;
    tables: TablesInForce;
}): PayResult {
    return computePayslip({
        employee: {
            id: args.context.employee._id,
            name: `${args.context.employee.firstName} ${args.context.employee.lastName}`.trim(),
        },
        profile: {
            ...args.context.terms,
            allowances: args.context.allowances,
            positionRowId: args.context.positionRow._id,
        },
        days: args.context.days,
        holidayTable: args.tables.holidays,
        tables: {
            sss: args.tables.sss,
            philhealth: args.tables.philhealth,
            pagibig: args.tables.pagibig,
            tax: args.tables.tax,
            deminimis: args.tables.deminimis,
        },
        adjustments: args.context.adjustments,
        loans: args.context.loans,
        thirteenthMonth: {
            accruedCentavos: Math.round(args.context.thirteenth.accruedPesos * 100),
            paidCentavos: Math.round(args.context.thirteenth.paidPesos * 100),
            exemptUsedCentavos: Math.round(args.context.thirteenth.exemptUsedPesos * 100),
            ceilingCentavos: Math.round(
                (args.tables.tax?.thirteenthMonthExemptCeiling ?? 90_000) * 100,
            ),
            // D5: the run whose pay date precedes 24 December releases the accrual.
            isPayoutRun: (() => {
                const pay = new Date(args.period.payDate + PH_OFFSET_MS);
                return pay.getUTCMonth() === 11 && pay.getUTCDate() <= 24;
            })(),
        },
        separation: args.context.separation,
        period: {
            startDate: args.period.startDate,
            endDate: args.period.endDate,
            payDate: args.period.payDate,
            isYearEnd: new Date(args.period.payDate + PH_OFFSET_MS).getUTCMonth() === 11,
            cutoffIndex: cutoffIndexOf(args.period),
        },
        employment: { start: args.context.employee.hireDate },
    });
}
