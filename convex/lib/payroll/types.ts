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

/** One allowance on a position row (D15). `amount` is pesos, per the type's unit. */
export type Allowance = {
    code: string;
    description: string;
    amount: number;
    taxable: boolean;
    deMinimisCategory?: string;
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
