// Payroll readiness (P9) — what stops the first live run, as pure logic.
//
// The pilot's own §10.2 list, expressed as data: every item says what is missing, how
// many employees it affects and whether it BLOCKS payday or merely warns. A blocked
// item means money would be wrong or a filing impossible; a warning means someone should
// look before approving.
import type { Money } from "./types";

export type ReadinessSeverity = "blocker" | "warning";

export interface ReadinessItem {
    id: string;
    severity: ReadinessSeverity;
    title: string;
    /** How many employees/records the problem touches. */
    count: number;
    detail: string;
    /** What to do about it. */
    fix: string;
}

export interface ReadinessReport {
    ready: boolean;
    blockers: ReadinessItem[];
    warnings: ReadinessItem[];
    /** Blocked items only, for the UI's badge. */
    blockerCount: number;
}

export function readinessReport(items: ReadinessItem[]): ReadinessReport {
    const blockers = items.filter((item) => item.severity === "blocker" && item.count > 0);
    const warnings = items.filter((item) => item.severity === "warning" && item.count > 0);
    return {
        ready: blockers.length === 0,
        blockers,
        warnings,
        blockerCount: blockers.length,
    };
}

/**
 * A loan amortisation that would exceed the employee's net pay blocks the payslip (D9),
 * so it is a readiness blocker rather than a payday surprise.
 */
export function loanFitsNet(args: {
    netCentavos: Money;
    scheduledCentavos: Money;
}): boolean {
    return args.scheduledCentavos <= args.netCentavos;
}

/** Statutory numbers that a filing needs, by kind. */
export const REQUIRED_ID_FIELDS = ["sssNumber", "philhealthNumber", "pagibigNumber", "tin"] as const;
