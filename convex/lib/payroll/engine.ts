// The payroll engine (P0.6 skeleton).
//
// SHAPE, NOT CONTENT. P0 lands the signature and the honesty guards so P1/P2
// extend a module that already has a fixture runner and a caller contract; the
// day pricing (P1) and the statutory/tax lines (P2) do not exist yet.
//
// Two rules this file enforces from day one:
//  1. No ctx, no DB access, no generated types. The mutation layer loads
//     inputs and writes lines; the engine is a pure function, which is the only
//     reason it can be exercised under plain node.
//  2. A skeleton result is BLOCKED, not merely empty. Returning zeros that a
//     caller could persist would produce a payroll run of ₱0.00 payslips that
//     look computed; `blocked.code === "ENGINE_SKELETON"` makes any attempt to
//     write one a visible error instead of a silent one.
import { ConvexError } from "convex/values";
import type { PayResult, PayslipLine } from "./types";

/** Bumped when the engine's behaviour changes; recorded per run in P3. */
export const ENGINE_STAGE = "P0-skeleton";

export const SKELETON_BLOCKER = "ENGINE_SKELETON";

/** Zeroed totals — one object, so "zeros" cannot mean two different things. */
function zeroResult(lines: PayslipLine[]): PayResult {
    return {
        lines,
        gross: 0,
        totalDeductions: 0,
        net: 0,
        employerCost: 0,
    };
}

/**
 * Compute one payslip (§6.1 signature).
 *
 * P0 returns no lines and zero totals, flagged blocked. `args` is deliberately
 * typed but unused: the parameter exists so P1 and P2 extend THIS signature
 * rather than inventing a second one that the fixtures would then have to
 * straddle.
 */
export function computePayslip(args: unknown): PayResult {
    if (args === null || typeof args !== "object") {
        // The one thing the skeleton can still get wrong is being called with
        // nothing — fail on that instead of returning a plausible zero payslip.
        throw new ConvexError("computePayslip requires the §6.1 argument object");
    }
    return {
        ...zeroResult([]),
        blocked: {
            code: SKELETON_BLOCKER,
            reason:
                `Engine stage ${ENGINE_STAGE}: day pricing (P1) and statutory ` +
                "computation (P2) are not implemented, so this payslip must not be persisted.",
        },
    };
}

/**
 * Totals from lines, in centavos — the P1/P2 contract, landed now so the
 * rounding rule has exactly one implementation (§6.1: sum lines, never derive a
 * line from a rounded total).
 */
export function totalsFromLines(lines: PayslipLine[]): Pick<
    PayResult,
    "gross" | "totalDeductions" | "net" | "employerCost"
> {
    let gross = 0;
    let totalDeductions = 0;
    let employerCost = 0;
    for (const line of lines) {
        if (line.kind === "earning") gross += line.amount;
        else if (line.kind === "deduction") totalDeductions += line.amount;
        else if (line.kind === "employer_cost") employerCost += line.amount;
        // `memo` lines (13th-month accrual, rate derivation) never move money.
    }
    return {
        gross,
        totalDeductions,
        net: gross - totalDeductions,
        employerCost,
    };
}
