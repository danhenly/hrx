// Leave (P8.1/P8.2) — pure rules, no ctx.
//
// The point of this module is that SIL stops being an assumption: an employee's
// convertible balance is a number the register computed, not "5 days per year".
import type { Money } from "./types";

export type LeaveAccrualBasis = "monthly" | "annual" | "none";

export interface LeaveTypeSpec {
    code: string;
    name: string;
    paid: boolean;
    accrualBasis: LeaveAccrualBasis;
    /** Days granted per year (0 when the basis is none). */
    daysPerYear: number;
    /** Unused days convertible to cash at separation (SIL: Art. 95). */
    convertibleOnSeparation: boolean;
    /** Minimum service before anything accrues, in months (SIL: 12). */
    minServiceMonths: number;
    statutory: boolean;
}

/** The standard PH set (D19/A8). Every value is editable per org after seeding. */
export const STANDARD_LEAVE_TYPES: LeaveTypeSpec[] = [
    {
        code: "SIL",
        name: "Service incentive leave",
        paid: true,
        accrualBasis: "monthly",
        daysPerYear: 5,
        convertibleOnSeparation: true,
        minServiceMonths: 12,
        statutory: true,
    },
    {
        code: "VL",
        name: "Vacation leave",
        paid: true,
        accrualBasis: "monthly",
        daysPerYear: 10,
        convertibleOnSeparation: false,
        minServiceMonths: 0,
        statutory: false,
    },
    {
        code: "SL",
        name: "Sick leave",
        paid: true,
        accrualBasis: "monthly",
        daysPerYear: 10,
        convertibleOnSeparation: false,
        minServiceMonths: 0,
        statutory: false,
    },
    {
        code: "MAT",
        name: "Maternity leave (RA 11210)",
        paid: true,
        accrualBasis: "none",
        daysPerYear: 105,
        convertibleOnSeparation: false,
        minServiceMonths: 0,
        statutory: true,
    },
    {
        code: "PAT",
        name: "Paternity leave (RA 8187)",
        paid: true,
        accrualBasis: "none",
        daysPerYear: 7,
        convertibleOnSeparation: false,
        minServiceMonths: 0,
        statutory: true,
    },
    {
        code: "SPL",
        name: "Solo parent leave (RA 8972)",
        paid: true,
        accrualBasis: "none",
        daysPerYear: 7,
        convertibleOnSeparation: false,
        minServiceMonths: 6,
        statutory: true,
    },
    {
        code: "BEREAVE",
        name: "Bereavement leave",
        paid: true,
        accrualBasis: "none",
        daysPerYear: 3,
        convertibleOnSeparation: false,
        minServiceMonths: 0,
        statutory: false,
    },
    {
        code: "LWOP",
        name: "Leave without pay",
        paid: false,
        accrualBasis: "none",
        daysPerYear: 0,
        convertibleOnSeparation: false,
        minServiceMonths: 0,
        statutory: false,
    },
];

export function findLeaveType(types: LeaveTypeSpec[], code: string): LeaveTypeSpec | null {
    return types.find((type) => type.code === code) ?? null;
}

/**
 * Days accrued for one payroll period.
 *
 * Monthly types accrue `daysPerYear / 12` per period, rounded to 4 decimals and
 * half-up; the year's residue is trued up by `annualResidue` so the year always
 * totals `daysPerYear` exactly (the D3 rounding discipline applied to days).
 */
export function periodAccrual(type: LeaveTypeSpec, serviceMonths: number): number {
    if (type.accrualBasis === "none" || type.daysPerYear <= 0) return 0;
    if (serviceMonths < type.minServiceMonths) return 0;
    if (type.accrualBasis === "annual") {
        // A once-a-year grant lands on the anniversary period; callers pass the year.
        return type.daysPerYear;
    }
    return roundDays(type.daysPerYear / 12);
}

/** The residue owed at the end of a 12-period year so the total is exact. */
export function annualResidue(type: LeaveTypeSpec, periodsAccrued: number, serviceMonths: number): number {
    if (type.accrualBasis !== "monthly" || type.daysPerYear <= 0) return 0;
    if (serviceMonths < type.minServiceMonths) return 0;
    const granted = roundDays(periodAccrual(type, serviceMonths) * periodsAccrued);
    return roundDays(type.daysPerYear - granted);
}

export function roundDays(days: number): number {
    return Math.round(days * 10000) / 10000;
}

export interface LeaveBalanceInput {
    accruedDays: number;
    usedDays: number;
    adjustedDays: number;
}

/** Balance = accrued − used ± adjustments. One definition, used everywhere. */
export function leaveBalance(input: LeaveBalanceInput): number {
    return roundDays(input.accruedDays - input.usedDays + input.adjustedDays);
}

/** Cash value of an unconverted balance at separation. */
export function conversionCentavos(balanceDays: number, dailyRateCentavos: Money): Money {
    if (balanceDays <= 0) return 0;
    return Math.round(balanceDays * dailyRateCentavos);
}

/**
 * Only CONVERTIBLE balances pay out. A VL balance that policy says is forfeited must
 * never become cash just because the employee resigned.
 */
export function convertibleDays(type: LeaveTypeSpec, balanceDays: number): number {
    if (!type.convertibleOnSeparation) return 0;
    return Math.max(0, balanceDays);
}

/** Service in whole months between two Manila-midnight anchors. */
export function serviceMonths(hireMs: number, atMs: number): number {
    if (atMs <= hireMs) return 0;
    const days = (atMs - hireMs) / (24 * 60 * 60 * 1000);
    return Math.floor(days / 30.436875);
}
