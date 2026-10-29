// Shared payroll types. Pure: no Convex imports, no ctx — this module is what
// the engine, the fixtures and (later) the run writer all agree on.
//
// MONEY IS INTEGER CENTAVOS. Every `Money` below is a whole number of centavos,
// computed with integer arithmetic and rounded half-up at the LINE level, then
// summed for totals. Never round a total and derive a line from it — that is how
// payslips stop adding up (§6.1).

/** Integer centavos. 12345 === PHP 123.45 */
export type Money = number;

export type PayType = "monthly" | "daily" | "hourly";

/** Divisor behind the daily rate (D7). */
export type DailyRateBasis = "261" | "313" | "22" | "26";

export type WorkWeek = "5_day" | "6_day";

/** Contribution/tax base (D-PILOT-3). */
export type StatutoryBasis = "gross_taxable" | "basic" | "gross";

export type DayType =
    | "regular"
    | "special_non_working"
    | "special_working"
    | "ordinary";

/** How often an allowance's amount is paid (from the `allowanceTypes` catalogue). */
export type AllowanceUnit =
    | "monthly"
    | "semi_monthly"
    | "annual"
    | "per_day"
    | "per_period";

/** One allowance on a position row (D15). `amount` is pesos, per `unit`. */
export type Allowance = {
    code: string;
    description: string;
    amount: number;
    taxable: boolean;
    deMinimisCategory?: string;
    /** Resolved from `allowanceTypes` by the caller; defaults to "monthly". */
    unit?: AllowanceUnit;
};

/** One ceiling row from `statutoryTables(kind: "deminimis")`. */
export type DeminimisCeiling = {
    key: string;
    label: string;
    unit: string;
    /** Pesos (or days); null where the regulation states a percentage instead. */
    ceiling: number | null;
    period: string;
    monthlyEquivalent?: number;
    percentOfMinWage?: number;
};

export type DeminimisTable = {
    effectiveNote?: string;
    ceilings: DeminimisCeiling[];
};

/** A correction applied to a period, booked as a line (D2: never an edit). */
export type Adjustment = {
    code: string;
    description: string;
    /** Positive = earning, negative = deduction. */
    amountCentavos: Money;
    reason: string;
};

/** Pay terms resolved for a period — always complete, never partial (D15). */
export type PayTerms = {
    payType: PayType;
    /** Monthly / daily / hourly pesos, matching payType. */
    basicRate: number;
    dailyRateBasis: DailyRateBasis;
    workWeek: WorkWeek;
    statutoryBasis: StatutoryBasis;
    allowances: Allowance[];
};

/** Org conventions, as stored on organizations.payrollSettings. */
export type PayrollSettings = {
    workWeek: WorkWeek;
    periodType: "semi_monthly";
    cutoffDays: number[];
    payDays: number[];
    statutoryBasis: StatutoryBasis;
    dailyRateBasis: DailyRateBasis;
    isTestOrg: boolean;
};

/** A holiday, as published (DOLE LA 12-25 for 2026). Data, never code. */
export type HolidayRule = {
    /** "YYYY-MM-DD" Manila wall-clock date. */
    date: string;
    name: string;
    type: Exclude<DayType, "ordinary">;
};

export type PayslipLineKind =
    | "earning"
    | "deduction"
    | "employer_cost"
    | "memo";

/** One line of a payslip. `amount` is integer centavos. */
export type PayslipLine = {
    kind: PayslipLineKind;
    /** BASIC, OT, ND, RH, SH, RD, SIL, 13M, SSS, PHIC, HDMF, TAX, SSS_LOAN, … */
    code: string;
    description: string;
    quantity?: number;
    rate?: number;
    amount: Money;
    taxable: boolean;
    source?: { type: string; id: string };
};

/** §6.1 — the engine's return shape. Totals are Money (centavos). */
export type PayResult = {
    lines: PayslipLine[];
    gross: Money;
    totalDeductions: Money;
    net: Money;
    employerCost: Money;
    /** Hours actually worked in the period, from the frozen day records. */
    hoursWorked?: number;
    /** Hours inside the 22:00–06:00 window. */
    nightHours?: number;
    /** Calendar days that produced at least one line. */
    pricedDays?: number;
    /** Days deducted as unpaid absence or undertime (monthly-paid). */
    absentDays?: number;
    /** Anything the reviewer must know that is not a line (unevaluated ceilings…). */
    notes?: string[];
    blocked?: { code: string; reason: string };
};

/** A frozen day record — the payroll snapshot, never a live join (§5, D6). */
export type DayRecord = {
    entryId: string;
    /** Manila midnight, Unix ms. */
    date: number;
    totalMinutes: number;
    intervals: { start: number; end: number }[];
    status: string;
};

export type PayProfile = PayTerms & {
    /** Position-history row the terms were resolved from. */
    positionRowId?: string;
    effectiveDate?: number;
};
