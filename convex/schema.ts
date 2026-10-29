import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// role enum shared across members & invitations
export const roleValidator = v.union(v.literal("admin"), v.literal("hr"));

// ─── Payroll validators (Phase 2, P0) ──────────────────────────────────────
// Exported so mutations accept exactly the union the schema stores — a second
// hand-written copy is how the two drift.

/** How the person is paid. Decides whether an unworked holiday pays (D8). */
export const payTypeValidator = v.union(
    v.literal("monthly"),
    v.literal("daily"),
    v.literal("hourly"),
);

/** Divisor behind the daily rate (D7). 261/313 reproduce DOLE's worked examples. */
export const dailyRateBasisValidator = v.union(
    v.literal("261"),
    v.literal("313"),
    v.literal("22"),
    v.literal("26"),
);

export const workWeekValidator = v.union(v.literal("5_day"), v.literal("6_day"));

/** Contribution/tax base (D-PILOT-3). Org default with an optional per-position override. */
export const statutoryBasisValidator = v.union(
    v.literal("gross_taxable"),
    v.literal("basic"),
    v.literal("gross"),
);

/** One allowance attached to a position row (D15). */
export const allowanceValidator = v.object({
    code: v.string(),                       // key into allowanceTypes (RICE, TRANSPO, …)
    description: v.string(),
    amount: v.number(),                     // pesos, per the allowance type's unit
    taxable: v.boolean(),
    deMinimisCategory: v.optional(v.string()), // key into statutoryTables('deminimis')
});

/** Org payroll conventions — one row of settings, so a convention change is one edit (D15/D17). */
export const payrollSettingsValidator = v.object({
    workWeek: workWeekValidator,
    periodType: v.literal("semi_monthly"),
    cutoffDays: v.array(v.number()),        // [10, 25] for the pilot
    payDays: v.array(v.number()),           // [15, 30]
    statutoryBasis: statutoryBasisValidator,
    dailyRateBasis: dailyRateBasisValidator,
    /** TRUE only on a generated dataset. Teardown REFUSES when false (§8.1c). */
    isTestOrg: v.boolean(),
});

/** Statutory table kinds. `holiday` is here because §6.1 takes the holiday
 *  calendar from statutoryTables(kind:'holiday') and P0.4 requires it as data. */
export const statutoryKindValidator = v.union(
    v.literal("sss"),
    v.literal("philhealth"),
    v.literal("pagibig"),
    v.literal("tax"),
    v.literal("deminimis"),
    v.literal("holiday"),
);

export default defineSchema({
    // Convex Auth tables: users, authAccounts, authSessions,
    // authRefreshTokens, authVerificationCodes, authRateLimits
    ...authTables,

    /**
     * Organizations — the top-level tenant.
     * Every piece of HR data will carry an orgId reference.
     */
    organizations: defineTable({
        name: v.string(),
        address: v.optional(v.string()),
        city: v.optional(v.string()),
        state: v.optional(v.string()),
        country: v.optional(v.string()),
        createdBy: v.id("users"),
        /** Absent on every pre-P0 org — resolvePayTerms() supplies the defaults. */
        payrollSettings: v.optional(payrollSettingsValidator),
    }),

    /**
     * Members — join table linking a user to an organization with a role.
     * This is the source-of-truth for tenant isolation checks.
     */
    members: defineTable({
        userId: v.id("users"),
        orgId: v.id("organizations"),
        role: roleValidator,
    })
        .index("by_user", ["userId"])
        .index("by_org", ["orgId"])
        .index("by_user_org", ["userId", "orgId"]),

    /**
     * Invitations — pending email invitations to join an org.
     * token is a cryptographically random URL-safe string.
     */
    invitations: defineTable({
        email: v.string(),
        orgId: v.id("organizations"),
        role: roleValidator,
        token: v.string(),
        invitedBy: v.id("users"),
        expiresAt: v.number(), // Unix ms
        acceptedAt: v.optional(v.number()),
    })
        .index("by_token", ["token"])
        .index("by_org", ["orgId"])
        .index("by_email", ["email"])
        .index("by_email_org", ["email", "orgId"]),

    // ─── HR: Employee Management ───────────────────────────────────────────

    /**
     * Employees — workforce records managed within the tenant.
     * Deliberately separate from `users` (who log in to the app).
     */
    employees: defineTable({
        orgId: v.id("organizations"),
        firstName: v.string(),
        lastName: v.string(),
        email: v.optional(v.string()),
        phone: v.optional(v.string()),
        dateOfBirth: v.optional(v.number()),   // Unix ms
        hireDate: v.number(),                  // Unix ms
        status: v.union(
            v.literal("active"),
            v.literal("terminated"),
            v.literal("on_leave"),
        ),
        /** BIR tax status code (S, M, ME, …). Annual-relevant, so it belongs to
         *  the person rather than the position (plan §5). */
        taxStatus: v.optional(v.string()),
        taxStatusUpdatedAt: v.optional(v.number()),
    })
        .index("by_org", ["orgId"])
        .index("by_org_status", ["orgId", "status"]),

    /**
     * Employee Positions — immutable history of titles, departments & salaries.
     * The "current" position is the row with no endDate (or the most-recent one).
     */
    employeePositions: defineTable({
        orgId: v.id("organizations"),        // denormalised for easier scoping queries
        employeeId: v.id("employees"),
        jobTitle: v.string(),
        department: v.optional(v.string()),
        salary: v.optional(v.number()),      // gross annual, base currency units
        effectiveDate: v.number(),           // Unix ms — when this position started
        endDate: v.optional(v.number()),     // Unix ms — null / absent = still current
        notes: v.optional(v.string()),
        positionId: v.optional(v.id("positions")),   // absent on pre-masterlist rows

        // ─── Pay terms (D15) ───────────────────────────────────────────────
        // Optional on purpose: this table already ships Phase 1 rows, so every
        // field resolves through resolvePayTerms() with a documented default
        // instead of throwing (P0.1).
        payType: v.optional(payTypeValidator),
        /** Per-position override of the org's statutory basis. */
        statutoryBasis: v.optional(statutoryBasisValidator),
        /** Monthly / daily / hourly rate, matching payType. When payType is
         *  monthly, `salary` (gross annual) === basicRate * 12. */
        basicRate: v.optional(v.number()),
        dailyRateBasis: v.optional(dailyRateBasisValidator),
        workWeek: v.optional(workWeekValidator),
        allowances: v.optional(v.array(allowanceValidator)),
        /** Stored for display only — the engine recomputes it from `allowances`
         *  and a fixture asserts the two agree (D15). */
        allowanceTotal: v.optional(v.number()),
    })
        .index("by_employee", ["employeeId"])
        .index("by_org", ["orgId"])
        .index("by_employee_effective", ["employeeId", "effectiveDate"])
        .index("by_org_position", ["orgId", "positionId"]),    // NEW — delete guard

    /**
     * Positions — the org's masterlist of job titles.
     * Deactivation is the retirement path: history keeps referring to a position
     * that is no longer offered. Deletion is blocked while any history row uses it.
     */
    positions: defineTable({
        orgId: v.id("organizations"),
        name: v.string(),
        nameKey: v.string(),        // name.trim().toLowerCase() — case-insensitive uniqueness
        department: v.optional(v.string()),
        description: v.optional(v.string()),
        isActive: v.boolean(),
        createdBy: v.id("users"),
        createdAt: v.number(),
        updatedBy: v.id("users"),
        updatedAt: v.number(),
    })
        .index("by_org", ["orgId"])
        .index("by_org_active", ["orgId", "isActive"])
        .index("by_org_name_key", ["orgId", "nameKey"]),

    // ─── Timekeeping ────────────────────────────────────────────────────────

    /**
     * Time entries — per employee per day with up to 3 intervals.
     */
    timeEntries: defineTable({
        orgId: v.id("organizations"),
        employeeId: v.id("employees"),
        date: v.number(), // Unix ms (start-of-day)
        intervals: v.array(
            v.object({
                start: v.number(), // Unix ms
                end: v.number(),   // Unix ms (can cross midnight, counted on start date)
                durationMinutes: v.number(),
            }),
        ),
        totalMinutes: v.number(),
        notes: v.optional(v.string()),
        source: v.literal("manual"),
        status: v.union(
            v.literal("draft"),
            v.literal("submitted"),
            v.literal("approved"),
            v.literal("rejected"),
            v.literal("locked"), // frozen for payroll; replaces the week sheet's state
        ),
        rejectedReason: v.optional(v.string()),
        submittedAt: v.optional(v.number()),
        approvedAt: v.optional(v.number()),
        approvedBy: v.optional(v.id("users")),
        lockedAt: v.optional(v.number()),
        lockedBy: v.optional(v.id("users")),
        createdBy: v.id("users"),
        updatedBy: v.id("users"),
    })
        .index("by_org", ["orgId"])
        .index("by_org_employee_date", ["orgId", "employeeId", "date"])
        .index("by_org_date", ["orgId", "date"]),

    // ─── Payroll (Phase 2) ──────────────────────────────────────────────────

    /**
     * Government numbers and the ATM/bank account (D16). One row per employee,
     * in its own table so D13 can gate it separately from salary data: these do
     * not change when pay changes and must never be duplicated per position.
     * Payroll refuses to compute a payslip whose required IDs are missing.
     */
    employeeStatutoryIds: defineTable({
        orgId: v.id("organizations"),
        employeeId: v.id("employees"),
        sssNumber: v.optional(v.string()),
        philhealthNumber: v.optional(v.string()),
        pagibigNumber: v.optional(v.string()),
        tin: v.optional(v.string()),
        bank: v.optional(
            v.object({
                bank: v.string(),               // "BDO" for the pilot (D-PILOT-7)
                accountName: v.string(),
                accountNumber: v.string(),
                accountType: v.union(
                    v.literal("atm"),
                    v.literal("savings"),
                    v.literal("current"),
                ),
            }),
        ),
        /** UMID, driver's licence, passport, … */
        otherIds: v.optional(
            v.array(v.object({ label: v.string(), value: v.string() })),
        ),
        updatedBy: v.id("users"),
        updatedAt: v.number(),
    }).index("by_org_employee", ["orgId", "employeeId"]),

    /**
     * Statutory tables (D17) — the published SSS / PhilHealth / Pag-IBIG / BIR /
     * de minimis / holiday data, versioned by effective date. Every number the
     * engine uses is a row here, never a constant in a computation function.
     *
     * Deliberately NOT org-scoped: these are national schedules, identical for
     * every tenant. Rows are editable in the app (statutoryTables.upsert) so a
     * new schedule is entered before it applies, with a source citation.
     */
    statutoryTables: defineTable({
        kind: statutoryKindValidator,
        effectiveFrom: v.number(),              // Manila midnight, Unix ms
        effectiveTo: v.optional(v.number()),    // closed by the next row's start
        payload: v.any(),                       // bands/schedule as published
        source: v.string(),                     // citation captured at seed time
    }).index("by_kind_effective", ["kind", "effectiveFrom"]),

    /**
     * Allowance catalogue (§2.6) — codes are org data, seeded with the
     * PH-standard set and editable. `employeePositions.allowances[].code`
     * references this.
     */
    allowanceTypes: defineTable({
        orgId: v.id("organizations"),
        code: v.string(),                       // RICE, LAUNDRY, UNIFORM, TRANSPO, …
        description: v.string(),
        unit: v.union(
            v.literal("monthly"),
            v.literal("semi_monthly"),
            v.literal("annual"),
            v.literal("per_day"),
            v.literal("per_period"),
        ),
        taxable: v.boolean(),
        deMinimisKind: v.optional(v.string()),  // key into statutoryTables('deminimis')
        active: v.boolean(),
    })
        .index("by_org", ["orgId"])
        .index("by_org_code", ["orgId", "code"]),

    /**
     * Payroll periods (D1) — three dates, never "the month". Built by P3; P0
     * creates the table so the seed dataset and P1 previews have a period to
     * point at.
     */
    payrollPeriods: defineTable({
        orgId: v.id("organizations"),
        periodType: v.literal("semi_monthly"),
        startDate: v.number(),                  // Manila midnight
        endDate: v.number(),                    // Manila midnight, inclusive
        payDate: v.number(),                    // Manila midnight
        status: v.union(v.literal("open"), v.literal("closed")),
    }).index("by_org_start", ["orgId", "startDate"]),

    /**
     * A payroll run — one period, one version (D1). `status` runs
     * draft → computed → reviewed → approved → paid, plus void. A recompute creates
     * version + 1 and voids nothing; a paid run is immutable, so no mutation in this
     * repo patches a payslip (D2).
     */
    payrollRuns: defineTable({
        orgId: v.id("organizations"),
        periodId: v.id("payrollPeriods"),
        version: v.number(),
        status: v.union(
            v.literal("draft"),
            v.literal("computed"),
            v.literal("reviewed"),
            v.literal("approved"),
            v.literal("paid"),
            v.literal("void"),
        ),
        totals: v.object({
            gross: v.number(),
            deductions: v.number(),
            net: v.number(),
            employerCost: v.number(),
            employeeCount: v.number(),
        }),
        /** Employees this run could not compute, with the reason. Never silently skipped. */
        blocked: v.array(v.object({ employeeId: v.id("employees"), reason: v.string() })),
        computedAt: v.optional(v.number()),
        reviewedAt: v.optional(v.number()),
        approvedAt: v.optional(v.number()),
        paidAt: v.optional(v.number()),
        approvedBy: v.optional(v.id("users")),
    })
        .index("by_org_period", ["orgId", "periodId"])
        .index("by_org_period_version", ["orgId", "periodId", "version"]),

    payslips: defineTable({
        orgId: v.id("organizations"),
        runId: v.id("payrollRuns"),
        employeeId: v.id("employees"),
        gross: v.number(),
        totalDeductions: v.number(),
        net: v.number(),
        /** Employer shares of statutory contributions — cost, never a deduction. */
        employerCost: v.number(),
        daysWorked: v.number(),
        minutesWorked: v.number(),
    })
        .index("by_run", ["runId"])
        .index("by_org_employee", ["orgId", "employeeId"]),

    payslipLines: defineTable({
        orgId: v.id("organizations"),
        payslipId: v.id("payslips"),
        runId: v.id("payrollRuns"),
        kind: v.union(
            v.literal("earning"),
            v.literal("deduction"),
            v.literal("employer_cost"),
            v.literal("memo"),
        ),
        code: v.string(),
        description: v.string(),
        quantity: v.optional(v.number()),
        rate: v.optional(v.number()),
        amount: v.number(),
        taxable: v.boolean(),
        source: v.optional(v.object({ type: v.string(), id: v.string() })),
    })
        .index("by_payslip", ["payslipId"])
        .index("by_run", ["runId"])
        .index("by_org", ["orgId"]),

    /**
     * The frozen snapshot behind one payslip (§5, "snapshot the inputs").
     *
     * Without it, a recompute six months later cannot reproduce the register and
     * "why is this different from what we filed" has no answer. It records the day
     * records used, the pay terms resolved for the period, and the ids of the
     * statutory-table versions in force — the payroll equivalent of Phase 1
     * snapshotting `jobTitle` into position history.
     */
    payrollInputs: defineTable({
        orgId: v.id("organizations"),
        runId: v.id("payrollRuns"),
        employeeId: v.id("employees"),
        days: v.array(
            v.object({
                entryId: v.string(),
                date: v.number(),
                totalMinutes: v.number(),
                intervals: v.array(v.object({ start: v.number(), end: v.number() })),
                status: v.string(),
            }),
        ),
        terms: v.any(),
        tableIds: v.object({
            sss: v.optional(v.string()),
            philhealth: v.optional(v.string()),
            pagibig: v.optional(v.string()),
            tax: v.optional(v.string()),
            deminimis: v.optional(v.string()),
            holiday: v.optional(v.string()),
        }),
        computedAt: v.number(),
    })
        .index("by_run", ["runId"])
        .index("by_org", ["orgId"]),

    /**
     * A generated artefact stored against the run (D11): the bank file, the run pack,
     * a payslip set. `sha256` is the fingerprint of exactly the bytes that were
     * produced, so a re-download can be proven identical to what was approved.
     */
    payrollArtefacts: defineTable({
        orgId: v.id("organizations"),
        runId: v.id("payrollRuns"),
        kind: v.union(
            v.literal("bank_file"),
            v.literal("run_pack"),
            v.literal("register_csv"),
            v.literal("gov_schedule"),
        ),
        /** Layout id for a bank file (bdo, generic); "" for the others. */
        layout: v.string(),
        filename: v.string(),
        content: v.string(),
        sha256: v.string(),
        rowCount: v.number(),
        total: v.number(),
        createdBy: v.id("users"),
        createdAt: v.number(),
        /** Statutory table version this artefact was produced from (D17). */
        tableVersion: v.optional(v.string()),
    })
        .index("by_run", ["runId"])
        .index("by_org", ["orgId"]),

    /**
     * A closed year (P7). One row per org per year, written only when the alphalist
     * reconciles to the remittances — the §1.3 rejection is enforced here, not in a UI.
     */
    /**
     * Leave types (P8.1) — org data, seeded with the PH-standard set and editable.
     * `leaveTypes.daysPerYear` is an entitlement, never a computed balance.
     */
    leaveTypes: defineTable({
        orgId: v.id("organizations"),
        code: v.string(),
        name: v.string(),
        paid: v.boolean(),
        accrualBasis: v.union(
            v.literal("monthly"),
            v.literal("annual"),
            v.literal("none"),
        ),
        daysPerYear: v.number(),
        convertibleOnSeparation: v.boolean(),
        /** Minimum service before anything accrues (SIL: 12 months). */
        minServiceMonths: v.number(),
        statutory: v.boolean(),
        updatedBy: v.id("users"),
        updatedAt: v.number(),
    })
        .index("by_org_code", ["orgId", "code"])
        .index("by_org", ["orgId"]),

    /**
     * Leave requests (P8.3). Usage hits the ledger on APPROVAL, never on request, so a
     * pending request can never quietly reduce a balance.
     */
    leaveRequests: defineTable({
        orgId: v.id("organizations"),
        employeeId: v.id("employees"),
        leaveTypeId: v.id("leaveTypes"),
        leaveCode: v.string(),
        /** Manila-midnight anchors, inclusive. */
        startDate: v.number(),
        endDate: v.number(),
        /** Working days covered, excluding rest days. */
        days: v.number(),
        reason: v.optional(v.string()),
        status: v.union(
            v.literal("pending"),
            v.literal("approved"),
            v.literal("rejected"),
            v.literal("cancelled"),
        ),
        decidedBy: v.optional(v.id("users")),
        decidedAt: v.optional(v.number()),
        rejectReason: v.optional(v.string()),
        createdBy: v.id("users"),
        createdAt: v.number(),
    })
        .index("by_org_employee", ["orgId", "employeeId"])
        .index("by_org_status", ["orgId", "status"])
        .index("by_org", ["orgId"]),

    /**
     * Leave ledger (P8.2) — one row per employee, leave type and payroll period. Written
     * by the payroll run that accrued it, so a balance can never disagree with the
     * register that produced it.
     */
    leaveLedger: defineTable({
        orgId: v.id("organizations"),
        employeeId: v.id("employees"),
        leaveTypeId: v.id("leaveTypes"),
        leaveCode: v.string(),
        periodId: v.id("payrollPeriods"),
        year: v.number(),
        accruedDays: v.number(),
        usedDays: v.number(),
        adjustedDays: v.number(),
        updatedAt: v.number(),
    })
        .index("by_org_employee_period", ["orgId", "employeeId", "periodId"])
        .index("by_org_year", ["orgId", "year"])
        .index("by_org", ["orgId"]),

    payrollYearEnds: defineTable({
        orgId: v.id("organizations"),
        year: v.number(),
        employeeCount: v.number(),
        grossPesos: v.number(),
        nonTaxablePesos: v.number(),
        taxablePesos: v.number(),
        taxDuePesos: v.number(),
        withheldPesos: v.number(),
        trueUpPesos: v.number(),
        alphalistSha256: v.string(),
        /** Statutory tax table version the year was computed under (D17). */
        tableVersion: v.string(),
        closedBy: v.id("users"),
        closedAt: v.number(),
    })
        .index("by_org_year", ["orgId", "year"])
        .index("by_org", ["orgId"]),

    /**
     * A tokenised link to ONE payslip (D13: an employee sees only their own payslip,
     * with no HR account). The token is random, expiring and revocable; the public
     * query resolves the token to its own payslip and to nothing else.
     */
    payslipLinks: defineTable({
        orgId: v.id("organizations"),
        runId: v.id("payrollRuns"),
        payslipId: v.id("payslips"),
        employeeId: v.id("employees"),
        token: v.string(),
        expiresAt: v.number(),
        createdBy: v.id("users"),
        createdAt: v.number(),
        revokedAt: v.optional(v.number()),
    })
        .index("by_token", ["token"])
        .index("by_payslip", ["payslipId"])
        .index("by_org", ["orgId"]),

    /**
     * A loan the employee is repaying (P5.3, D9). Statutory loans (SSS salary loan,
     * Pag-IBIG MPL) and the employer's own loans/advances share one ledger so the
     * priority order has something uniform to sort.
     */
    loanAccounts: defineTable({
        orgId: v.id("organizations"),
        employeeId: v.id("employees"),
        type: v.union(
            v.literal("sss"),
            v.literal("pagibig"),
            v.literal("company"),
            v.literal("advance"),
        ),
        /** Pesos. */
        principal: v.number(),
        balance: v.number(),
        /** Scheduled deduction per cutoff, pesos. */
        amortisation: v.number(),
        /** Term in months; the pilot's SSS salary loan uses the standard 10. */
        termMonths: v.optional(v.number()),
        reference: v.optional(v.string()),
        startPeriodId: v.optional(v.id("payrollPeriods")),
        status: v.union(
            v.literal("active"),
            v.literal("closed"),
            v.literal("written_off"),
        ),
        createdBy: v.id("users"),
        createdAt: v.number(),
    })
        .index("by_org_employee", ["orgId", "employeeId"])
        .index("by_org_status", ["orgId", "status"]),

    /** One row per loan per run — including the periods where nothing was paid (D9). */
    loanAmortizations: defineTable({
        orgId: v.id("organizations"),
        loanId: v.id("loanAccounts"),
        runId: v.id("payrollRuns"),
        employeeId: v.id("employees"),
        amount: v.number(),
        balanceAfter: v.number(),
        createdAt: v.number(),
    })
        .index("by_loan", ["loanId"])
        .index("by_run", ["runId"])
        .index("by_org", ["orgId"]),

    /**
     * The 13th month ledger (D5): what has accrued per employee per calendar year and
     * what has been released. The accrual is a memo line on every payslip; this is the
     * running liability the December payout is computed from.
     */
    thirteenthMonthLedger: defineTable({
        orgId: v.id("organizations"),
        employeeId: v.id("employees"),
        year: v.number(),
        /** Pesos. */
        accrued: v.number(),
        paid: v.number(),
        /** Benefits exemption consumed this year (13th month and other benefits). */
        exemptUsed: v.number(),
        updatedAt: v.number(),
    }).index("by_org_employee_year", ["orgId", "employeeId", "year"]),

    /**
     * A final-pay statement produced on separation (P5.3). One per employee per
     * separation date — the mutation refuses a second, so a resigned employee cannot
     * be paid twice out of two clicks.
     */
    finalPayStatements: defineTable({
        orgId: v.id("organizations"),
        employeeId: v.id("employees"),
        separationDate: v.number(),
        lastDay: v.number(),
        reason: v.string(),
        lines: v.any(),
        totals: v.object({
            gross: v.number(),
            deductions: v.number(),
            net: v.number(),
        }),
        createdBy: v.id("users"),
        createdAt: v.number(),
    })
        .index("by_org_employee", ["orgId", "employeeId"])
        .index("by_org", ["orgId"]),

    /**
     * Adjustments (D2) — a correction is a LINE applied to a period, never an edit
     * to a computed register. Created in P3 with the run; P1 only reads them.
     */
    adjustments: defineTable({
        orgId: v.id("organizations"),
        employeeId: v.id("employees"),
        targetPeriodId: v.id("payrollPeriods"),
        code: v.string(),
        /** Pesos. Positive = earning, negative = deduction. */
        amount: v.number(),
        reason: v.string(),
        createdBy: v.id("users"),
        appliedRunId: v.optional(v.id("payrollRuns")),
    }).index("by_org_target", ["orgId", "targetPeriodId"]),

    // ─── Audit ──────────────────────────────────────────────────────────────

    /**
     * Audit logs — append-only trail of who did what, when, in which org.
     * Written inside the mutation that performs the change (same
     * transaction), never from an action. No update/delete functions are
     * exported.
     */
    auditLogs: defineTable({
        orgId: v.id("organizations"),
        actorId: v.id("users"),
        action: v.string(), // e.g. "employee.create", "timesheet.approve"
        entity: v.object({ type: v.string(), id: v.string() }),
        at: v.number(), // Unix ms
    })
        .index("by_org_at", ["orgId", "at"])
        .index("by_org_entity", ["orgId", "entity.type", "entity.id"]),
});
