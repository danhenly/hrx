// The checked-in mirror of plan §2 — the values an admin seeds into
// `statutoryTables` once, then maintains in the app (D17).
//
// RULES THIS FILE FOLLOWS
// 1. Every row carries the `source` string from Appendix A. A row without a
//    citation is not seedable, because a payroll number nobody can point at is
//    a number nobody can defend to an auditor.
// 2. Values appear here ONLY if the plan publishes them. Where the plan names a
//    figure without giving it (the WISP split, the EC bracket threshold) the
//    field is `null` with a note, and P2 must enter it through the editor rather
//    than ship a guess. `null` is a prompt; an invented 0.02 is a silent error.
// 3. `effectiveFrom` is a Manila wall-clock date ("YYYY-MM-DD"); the seeder
//    converts it to a Manila-midnight anchor.
//
// Appendix A requires re-reading the five agency sources on the day of the first
// live run and again each 1 January. Update THIS file and re-run the seeder, or
// edit the row in Settings → Payroll; the engine never needs a code change.

export type StatutoryKind =
    | "sss"
    | "philhealth"
    | "pagibig"
    | "tax"
    | "deminimis"
    | "holiday";

export type StatutorySeedRow = {
    kind: StatutoryKind;
    /** Manila wall-clock date, "YYYY-MM-DD". */
    effectiveFrom: string;
    payload: unknown;
    source: string;
};

// ─── Sources (Appendix A, verified 2026-10-28) ─────────────────────────────

const SSS_SOURCE =
    "SSS contribution schedule effective Jan 2025 — https://www.sss.gov.ph/sss-contribution-table/ (R-3 employer instructions: https://www.sss.gov.ph/wp-content/uploads/2022/03/SSSForms_ER_Contribution_Payment.pdf)";
const SSS_WISP_SOURCE =
    "SSS WISP primer — https://www.sss.gov.ph/wp-content/uploads/2024/10/PRIMER-PENSION-BOOSTER.pdf";
const PHILHEALTH_SOURCE =
    "PhilHealth 5% for 2026 (final UHC step), ₱10,000 floor / ₱100,000 ceiling — https://pia.gov.ph/news/philhealth-sets-5-premium-contribution-rate-for-2026/ (employer procedure: https://www.philhealth.gov.ph/partners/employers/pay_procedures.php). RA 11223";
const PAGIBIG_SOURCE =
    "Pag-IBIG 2%/2% on Maximum Fund Salary ₱10,000 — HDMF Circular 460 (Feb 2024), per https://pagibiginfo.com/pag-ibig-contribution; eSRS: HDMF Circular 499-2026 via https://www.pagibigfund.gov.ph/ESRS.html";
const TAX_SOURCE =
    "BIR TRAIN annual brackets (RA 10963, unchanged since 2023-01-01) and the ₱90,000 13th-month/benefits ceiling — https://pco.gov.ph/wp-content/uploads/2018/01/A-Guide-To-TRAIN-RA10963.pdf; https://www.bir.gov.ph/wtcalculator";
const DEMINIMIS_SOURCE =
    "BIR RR No. 29-2025 (27 Oct 2025, effective 06 Jan 2026) — https://bir-cdn.bir.gov.ph/BIR/pdf/RR%20No.%2029-2025.pdf; summary: https://kpmg.com/ph/en/insights/2026/01/intax-january-2026-issue-1-volume-1.html";
const HOLIDAY_SOURCE =
    "DOLE Labor Advisory No. 12, s. 2025 (2026 holiday pay rules and dates) — https://www.dole.gov.ph/php_assets/uploads/2025/09/Labor-Advisory-No.-12-25-Payment-of-Wages-for-the-Regular-Holidays-Special-Non-Working-Days-and-Special-Working-Day-for-the-Year-2026.pdf; Proclamation 1006, s. 2025 — https://pco.gov.ph/wp-content/uploads/2025/09/20250903-PROC-1006-FRM.pdf.pdf";

// ─── §2.1 SSS (RA 11199) ───────────────────────────────────────────────────

export type SssPayload = {
    totalRate: number;
    employeeRate: number;
    employerRate: number;
    mscMin: number;
    mscMax: number;
    /** Employer-only Employees' Compensation. Amounts are published; the MSC
     *  threshold that selects between them is NOT stated in the plan. */
    ecEmployer: {
        amounts: number[];
        thresholdMsc: number | null;
        note: string;
    };
    /** WISP split above the MSC threshold — the plan says to take the split from
     *  the current SSS schedule without reproducing it, so P2 must enter it. */
    wisp: {
        mscThreshold: number;
        regularMscCeiling: number;
        employeeRate: number | null;
        employerRate: number | null;
        note: string;
    };
};

const SSS_2025: SssPayload = {
    totalRate: 0.15,
    employeeRate: 0.05,
    employerRate: 0.1,
    mscMin: 5000,
    mscMax: 35000,
    ecEmployer: {
        amounts: [10, 30],
        thresholdMsc: null,
        note: "§2.1 publishes ₱10 or ₱30 depending on the MSC bracket but not the bracket boundary itself. Confirm against the SSS schedule before P2 computes EC, then enter the threshold here or in the editor.",
    },
    wisp: {
        mscThreshold: 20000,
        regularMscCeiling: 35000,
        employeeRate: null,
        employerRate: null,
        note: "§2.1: contributions above MSC ₱20,000 split into regular SS and WISP portions, 'take the split from the current SSS schedule'. That schedule is not reproduced in the plan, so the split rates are deliberately unset — enter the current WISP schedule in Settings → Payroll before P2 computes contributions.",
    },
};

// ─── §2.2 PhilHealth (RA 11223) ────────────────────────────────────────────

const PHILHEALTH_2026 = {
    rate: 0.05,
    employeeShare: 0.025,
    employerShare: 0.025,
    floor: 10000,
    ceiling: 100000,
    premiumFloor: 500,
    premiumCeiling: 5000,
};

// ─── §2.3 Pag-IBIG / HDMF ──────────────────────────────────────────────────

const PAGIBIG_2024 = {
    employeeRate: 0.02,
    employerRate: 0.02,
    /** 1% employee share at or below the low-compensation threshold. */
    employeeRateLow: 0.01,
    lowCompensationThreshold: 1500,
    maxFundSalary: 10000,
    maxEmployeeShare: 200,
    maxEmployerShare: 200,
};

// ─── §2.4 BIR withholding tax (RA 10963, TRAIN) ────────────────────────────

/** Annual brackets — the ONLY hand-entered tax numbers. The semi-monthly table
 *  is derived from these by convex/lib/payroll/tax.ts (§6.4). */
const TAX_2023 = {
    annualBrackets: [
        { from: 0, to: 250000, base: 0, rate: 0 },
        { from: 250000, to: 400000, base: 0, rate: 0.15 },
        { from: 400000, to: 800000, base: 22500, rate: 0.2 },
        { from: 800000, to: 2000000, base: 102500, rate: 0.25 },
        { from: 2000000, to: 8000000, base: 402500, rate: 0.3 },
        { from: 8000000, to: null, base: 2202500, rate: 0.35 },
    ],
    /** 13th month + other benefits, combined, per year. */
    thirteenthMonthExemptCeiling: 90000,
};

// ─── §2.4 de minimis ceilings (RR 29-2025, effective 06 Jan 2026) ──────────

/** `ceiling` is pesos per the stated `period`; `percentOfMinWage` is used where
 *  the regulation states a percentage instead of an amount. */
const DEMINIMIS_2026 = {
    effectiveNote:
        "RR 29-2025 replaced the RR 4-2025 figures from 06 Jan 2026 — any 2024-era spreadsheet is already wrong.",
    ceilings: [
        { key: "MONETIZED_VL", label: "Monetised unused vacation leave (private employees)", unit: "days", ceiling: 12, period: "annual" },
        { key: "MEDICAL_CASH", label: "Medical cash allowance to dependants", unit: "peso", ceiling: 2000, period: "semester", monthlyEquivalent: 333 },
        { key: "RICE", label: "Rice subsidy", unit: "peso", ceiling: 2500, period: "monthly" },
        { key: "UNIFORM", label: "Uniform and clothing allowance", unit: "peso", ceiling: 8000, period: "annual" },
        { key: "MEDICAL_ACTUAL", label: "Actual annual medical assistance", unit: "peso", ceiling: 12000, period: "annual" },
        { key: "LAUNDRY", label: "Laundry allowance", unit: "peso", ceiling: 400, period: "monthly" },
        { key: "ACHIEVEMENT", label: "Employee achievement awards", unit: "peso", ceiling: 12000, period: "annual" },
        { key: "GIFTS", label: "Gifts at Christmas / major anniversaries", unit: "peso", ceiling: 6000, period: "annual" },
        { key: "MEAL_OT", label: "Daily meal allowance for OT and night/graveyard shift", unit: "percent_of_min_wage", ceiling: null, period: "per_day", percentOfMinWage: 0.3 },
        { key: "CBA_PRODUCTIVITY", label: "CBA and productivity incentive benefits", unit: "peso", ceiling: 12000, period: "annual" },
    ],
};

// ─── §2.5 DOLE 2026 holidays (LA 12-25) ────────────────────────────────────

/** Dates exactly as §2.5 prints them. Eidul Fitr / Eidul Adha have no fixed
 *  Gregorian date and §2.5 lists them without one, so they are held as
 *  `undated` until a proclamation fixes them — never guessed onto a date. */
const HOLIDAYS_2026 = {
    year: 2026,
    days: [
        { date: "2026-01-01", name: "New Year's Day", type: "regular" },
        { date: "2026-02-17", name: "Chinese New Year", type: "special_non_working" },
        { date: "2026-02-25", name: "EDSA People Power Revolution Anniversary", type: "special_working" },
        { date: "2026-04-02", name: "Maundy Thursday", type: "regular" },
        { date: "2026-04-03", name: "Good Friday", type: "regular" },
        { date: "2026-04-04", name: "Black Saturday", type: "special_non_working" },
        { date: "2026-04-09", name: "Araw ng Kagitingan", type: "regular" },
        { date: "2026-05-01", name: "Labor Day", type: "regular" },
        { date: "2026-06-12", name: "Independence Day", type: "regular" },
        { date: "2026-08-21", name: "Ninoy Aquino Day", type: "special_non_working" },
        { date: "2026-08-31", name: "National Heroes Day", type: "regular" },
        { date: "2026-11-01", name: "All Saints' Day", type: "special_non_working" },
        { date: "2026-11-02", name: "All Souls' Day", type: "special_non_working" },
        { date: "2026-11-30", name: "Bonifacio Day", type: "regular" },
        { date: "2026-12-08", name: "Feast of the Immaculate Conception", type: "special_non_working" },
        { date: "2026-12-24", name: "Christmas Eve", type: "special_non_working" },
        { date: "2026-12-25", name: "Christmas Day", type: "regular" },
        { date: "2026-12-30", name: "Rizal Day", type: "regular" },
        { date: "2026-12-31", name: "Last Day of the Year", type: "special_non_working" },
    ],
    undated: [
        { name: "Eidul Fitr", type: "regular", note: "Date fixed by proclamation; §2.5 lists the day type only." },
        { name: "Eidul Adha", type: "regular", note: "Date fixed by proclamation; §2.5 lists the day type only." },
    ],
};

// ─── The seed rows ─────────────────────────────────────────────────────────

export const STATUTORY_SEED: StatutorySeedRow[] = [
    {
        kind: "sss",
        // The schedule in force is the one effective January 2025 (15%).
        effectiveFrom: "2025-01-01",
        payload: SSS_2025,
        source: `${SSS_SOURCE} | ${SSS_WISP_SOURCE}`,
    },
    {
        kind: "philhealth",
        effectiveFrom: "2026-01-01",
        payload: PHILHEALTH_2026,
        source: PHILHEALTH_SOURCE,
    },
    {
        kind: "pagibig",
        // HDMF Circular 460 took effect February 2024.
        effectiveFrom: "2024-02-01",
        payload: PAGIBIG_2024,
        source: PAGIBIG_SOURCE,
    },
    {
        kind: "tax",
        effectiveFrom: "2023-01-01",
        payload: TAX_2023,
        source: TAX_SOURCE,
    },
    {
        kind: "deminimis",
        effectiveFrom: "2026-01-06",
        payload: DEMINIMIS_2026,
        source: DEMINIMIS_SOURCE,
    },
    {
        kind: "holiday",
        effectiveFrom: "2026-01-01",
        payload: HOLIDAYS_2026,
        source: HOLIDAY_SOURCE,
    },
];

/**
 * §2.6 standard allowance catalogue — seeded per org into `allowanceTypes`,
 * editable, and referenced by code from a position row's `allowances[]`.
 */
export const ALLOWANCE_CATALOGUE: {
    code: string;
    description: string;
    unit: "monthly" | "semi_monthly" | "annual" | "per_day" | "per_period";
    taxable: boolean;
    deMinimisKind?: string;
}[] = [
    { code: "RICE", description: "Rice subsidy", unit: "monthly", taxable: false, deMinimisKind: "RICE" },
    { code: "LAUNDRY", description: "Laundry allowance", unit: "monthly", taxable: false, deMinimisKind: "LAUNDRY" },
    { code: "UNIFORM", description: "Uniform and clothing allowance", unit: "annual", taxable: false, deMinimisKind: "UNIFORM" },
    { code: "MEDICAL_CASH", description: "Medical cash allowance to dependants", unit: "semi_monthly", taxable: false, deMinimisKind: "MEDICAL_CASH" },
    { code: "MEDICAL_ACTUAL", description: "Actual annual medical assistance (reimbursed)", unit: "annual", taxable: false, deMinimisKind: "MEDICAL_ACTUAL" },
    { code: "MEAL_OT", description: "Meal allowance for OT and night-shift days", unit: "per_day", taxable: false, deMinimisKind: "MEAL_OT" },
    { code: "TRANSPO", description: "Transportation allowance", unit: "monthly", taxable: true },
    { code: "COLA", description: "Cost-of-living allowance", unit: "monthly", taxable: true },
    { code: "HOLIDAY_ALLOWANCE", description: "Holiday allowance", unit: "monthly", taxable: true },
    { code: "INCENTIVE", description: "Incentive (taxable above the CBA/productivity ceiling)", unit: "per_period", taxable: true, deMinimisKind: "CBA_PRODUCTIVITY" },
];
