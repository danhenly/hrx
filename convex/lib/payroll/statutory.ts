// SSS / PhilHealth / Pag-IBIG contributions (P2.1, D3).
//
// Pure: no ctx, no DB. The tables arrive as data (statutoryTables), so a new
// schedule is an edit in Settings → Payroll, never a code change.
//
// D3's contract, which is what makes the numbers reconcile with what the employer
// must remit: contributions are computed on a MONTHLY base and then split across
// the cutoffs, with the centavo residue on the SECOND cutoff. Computing each
// half-month separately against a half-month base produces totals that do not
// match the R-3 / EPRS / MCRF the agency expects.
import { ConvexError } from "convex/values";
import { roundHalfUp } from "./rates";
import type { Money } from "./types";

/** The `sss` payload as seeded (see payroll/statutorySeed.ts). */
export type SssTable = {
    totalRate: number;
    employeeRate: number;
    employerRate: number;
    mscMin: number;
    mscMax: number;
    mscStep: number;
    ec: { low: number; high: number; lowMaxMsc: number };
    mpf: { mscThreshold: number; employeeRate: number; employerRate: number };
};

export type PhilhealthTable = {
    rate: number;
    employeeShare: number;
    employerShare: number;
    floor: number;
    ceiling: number;
};

export type PagibigTable = {
    employeeRate: number;
    employerRate: number;
    employeeRateLow: number;
    lowCompensationThreshold: number;
    maxFundSalary: number;
};

function pesosToCentavos(pesos: number): Money {
    return roundHalfUp(pesos * 100);
}

function assertNonNegative(value: number, label: string) {
    if (!Number.isFinite(value) || value < 0) {
        throw new ConvexError(`${label} cannot be negative`);
    }
}

/**
 * The Monthly Salary Credit for a monthly compensation.
 *
 * MSC brackets step in ₱500 and the published table rounds to the NEAREST bracket
 * — "below ₱5,250" maps to ₱5,000, "₱5,250–₱5,749.99" to ₱5,500 — so half-up on
 * the step reproduces it rather than inventing a floor rule.
 */
export function monthlySalaryCredit(
    monthlyBasePesos: number,
    table: SssTable,
): number {
    assertNonNegative(monthlyBasePesos, "Monthly compensation");
    if (table.mscStep <= 0) {
        throw new ConvexError("SSS mscStep must be positive");
    }
    const stepped =
        roundHalfUp(monthlyBasePesos / table.mscStep) * table.mscStep;
    return Math.min(Math.max(stepped, table.mscMin), table.mscMax);
}

export type SssContribution = {
    /** Total MSC after capping. */
    mscPesos: number;
    /** Portion credited to Regular SS (capped at the MPF threshold). */
    regularMscPesos: number;
    /** Portion credited to the MPF / MySSS Pension Booster. */
    mpfMscPesos: number;
    employeeCentavos: Money;
    employerCentavos: Money;
    /** Employer-only, flat, on top of the 15%. */
    ecCentavos: Money;
};

export function sssContributions(
    monthlyBaseCentavos: Money,
    table: SssTable,
): SssContribution {
    assertNonNegative(monthlyBaseCentavos, "Monthly compensation");
    const mscPesos = monthlySalaryCredit(monthlyBaseCentavos / 100, table);
    const regularMscPesos = Math.min(mscPesos, table.mpf.mscThreshold);
    const mpfMscPesos = mscPesos - regularMscPesos;

    // The MPF is credited at the same rates, so the totals are simply rate × MSC;
    // the split is kept because the R-3 reports it in separate columns (P6).
    const employee = pesosToCentavos(
        regularMscPesos * table.employeeRate + mpfMscPesos * table.mpf.employeeRate,
    );
    const employer = pesosToCentavos(
        regularMscPesos * table.employerRate + mpfMscPesos * table.mpf.employerRate,
    );
    const ec = pesosToCentavos(
        mscPesos <= table.ec.lowMaxMsc ? table.ec.low : table.ec.high,
    );

    return {
        mscPesos,
        regularMscPesos,
        mpfMscPesos,
        employeeCentavos: employee,
        employerCentavos: employer,
        ecCentavos: ec,
    };
}

export type SplitContribution = {
    /** The base actually used (after floor/ceiling), in pesos. */
    basePesos: number;
    employeeCentavos: Money;
    employerCentavos: Money;
};

export function philhealthContributions(
    monthlyBaseCentavos: Money,
    table: PhilhealthTable,
): SplitContribution {
    assertNonNegative(monthlyBaseCentavos, "Monthly compensation");
    const basePesos = Math.min(
        Math.max(monthlyBaseCentavos / 100, table.floor),
        table.ceiling,
    );
    return {
        basePesos,
        employeeCentavos: pesosToCentavos(basePesos * table.employeeShare),
        employerCentavos: pesosToCentavos(basePesos * table.employerShare),
    };
}

export function pagibigContributions(
    monthlyCompensationCentavos: Money,
    table: PagibigTable,
): SplitContribution {
    assertNonNegative(monthlyCompensationCentavos, "Monthly compensation");
    const monthlyPesos = monthlyCompensationCentavos / 100;
    const basePesos = Math.min(monthlyPesos, table.maxFundSalary);
    // 1% at or below the low-compensation threshold, 2% above it (§2.3).
    const employeeRate =
        monthlyPesos <= table.lowCompensationThreshold
            ? table.employeeRateLow
            : table.employeeRate;
    return {
        basePesos,
        employeeCentavos: pesosToCentavos(basePesos * employeeRate),
        employerCentavos: pesosToCentavos(basePesos * table.employerRate),
    };
}

/**
 * Split a monthly amount across two semi-monthly cutoffs (D3).
 *
 * `cutoffIndex` is 0 for the first cutoff of the month and 1 for the second. The
 * residue goes to the SECOND so that first + second === monthly, always — a
 * round-each-half implementation loses or gains a centavo per month, per employee,
 * and the remittance total is then off by a few pesos nobody can trace.
 */
export function splitMonthlyAcrossCutoffs(
    monthlyCentavos: Money,
    cutoffIndex: 0 | 1,
): Money {
    const first = Math.floor(monthlyCentavos / 2);
    return cutoffIndex === 0 ? first : monthlyCentavos - first;
}
