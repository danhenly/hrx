// BIR withholding-tax table derivation (§6.4, P0.2's tax slice).
//
// The annual brackets in plan §2.4 / statutorySeed.ts are the only hand-entered
// tax numbers. The semi-monthly table is DERIVED from them, because a
// hand-typed second table is the classic source of a 1601-C that does not match
// the register (§1.3).
//
// UNITS: this module works in PESOS, because that is how BIR publishes both
// tables. It is the one place money is not integer centavos — callers convert at
// the boundary (`fromCentavos()`) and every function here rounds to 2 decimals
// before returning, so nothing downstream sees a fraction of a centavo.
import { ConvexError } from "convex/values";
import { roundHalfUp } from "./rates";
import type { Money } from "./types";

/** One row of a bracket table. `to: null` on the top bracket. */
export type Bracket = {
    from: number;
    to: number | null;
    /** Cumulative tax on the amount below `from`. */
    base: number;
    /** Marginal rate applied to the excess over `from`. */
    rate: number;
};

/** 24 semi-monthly cutoffs a year — the divisor behind the derived table. */
export const CUTOFFS_PER_YEAR = 24;

function roundPesos(value: number): number {
    return roundHalfUp(value * 100) / 100;
}

/**
 * Annual bracket → semi-monthly slice (§6.4). Every boundary and cumulative base
 * divides by 24, which is why the published semi-monthly table's bases are
 * ₱937.50, ₱4,270.83, ₱16,770.83 and ₱91,770.83 — the annual bases over 24.
 *
 * If the derivation and a published table ever disagree, THE PUBLISHED TABLE
 * WINS and this function is fixed (as does any stored payload built from it).
 */
export function semiMonthlyBrackets(annual: Bracket[]): Bracket[] {
    assertBrackets(annual);
    return annual.map((bracket) => ({
        from: bracket.from / CUTOFFS_PER_YEAR,
        to: bracket.to === null ? null : bracket.to / CUTOFFS_PER_YEAR,
        base: bracket.base / CUTOFFS_PER_YEAR,
        rate: bracket.rate,
    }));
}

/**
 * Structural validation. A table that skips a range silently under-withholds
 * every employee above the gap, so a bad table is refused at the editor rather
 * than sorted out later by the BIR.
 */
export function assertBrackets(brackets: Bracket[]): void {
    if (brackets.length === 0) {
        throw new ConvexError("A tax table needs at least one bracket");
    }
    if (brackets[0].from !== 0) {
        throw new ConvexError("The first tax bracket must start at 0");
    }
    for (let index = 0; index < brackets.length; index += 1) {
        const bracket = brackets[index];
        if (bracket.rate < 0 || bracket.rate > 1) {
            throw new ConvexError(`Bracket ${index + 1} has an impossible rate`);
        }
        const last = index === brackets.length - 1;
        if (last && bracket.to !== null) {
            throw new ConvexError(
                "The last tax bracket must be open-ended (to: null) or the top of the table is untaxed",
            );
        }
        if (!last) {
            const next = brackets[index + 1];
            if (bracket.to === null) {
                throw new ConvexError(
                    `Bracket ${index + 1} is open-ended but is not the last one`,
                );
            }
            if (next.from !== bracket.to) {
                throw new ConvexError(
                    `Bracket ${index + 1} ends at ${bracket.to} but bracket ${index + 2} starts at ${next.from} — ranges must be contiguous`,
                );
            }
            // The cumulative base must equal tax-on-the-top-of-this-bracket,
            // otherwise the table double-counts or skips at the boundary.
            const computed =
                bracket.base + (bracket.to - bracket.from) * bracket.rate;
            if (Math.abs(computed - next.base) > 0.01) {
                throw new ConvexError(
                    `Bracket ${index + 2} base ${next.base} does not equal ${roundPesos(computed)} — the cumulative base is wrong`,
                );
            }
        }
    }
}

/** Tax withheld on `taxablePesos` for one bracket table (pesos in, pesos out). */
export function taxFor(taxablePesos: number, brackets: Bracket[]): number {
    if (!Number.isFinite(taxablePesos) || taxablePesos < 0) {
        throw new ConvexError("Taxable income cannot be negative");
    }
    const bracket =
        brackets.find(
            (candidate) =>
                taxablePesos >= candidate.from &&
                (candidate.to === null || taxablePesos < candidate.to),
        ) ?? brackets[brackets.length - 1];
    return roundPesos(
        bracket.base + (taxablePesos - bracket.from) * bracket.rate,
    );
}

/** Annual-bracket withholding (the year-end / 2316 figure). */
export function annualTaxPesos(
    taxableAnnualPesos: number,
    annualBrackets: Bracket[],
): number {
    return taxFor(taxableAnnualPesos, annualBrackets);
}

/** Semi-monthly withholding for one cutoff (the per-run figure, D4). */
export function semiMonthlyTaxPesos(
    taxableCutoffPesos: number,
    annualBrackets: Bracket[],
): number {
    return taxFor(taxableCutoffPesos, semiMonthlyBrackets(annualBrackets));
}

/**
 * Withholding for one cutoff, from the annual brackets (D4).
 *
 * The semi-monthly table is the annual table ÷ 24, so this is the per-run figure the
 * 1601-C is built from; the December run then annualises against the real register.
 */
export function withholdingCentavos(
    grossTaxableCutoffCentavos: Money,
    annualBrackets: Bracket[],
): Money {
    return roundHalfUp(
        semiMonthlyTaxPesos(grossTaxableCutoffCentavos / 100, annualBrackets) * 100,
    );
}

export type Annualisation = {
    annualTaxableCentavos: Money;
    /** Tax due on the year's taxable compensation, from the annual brackets. */
    annualTaxCentavos: Money;
    /** What was actually withheld across the year, including this period. */
    withheldCentavos: Money;
    /** Positive = still to collect in the December run; negative = over-withheld. */
    trueUpCentavos: Money;
};

/**
 * Annual true-up (D4). One function feeds both the December adjustment and the 2316,
 * which is the only way those two can never disagree.
 */
export function annualise(args: {
    ytdTaxableCentavos: Money;
    ytdWithheldCentavos: Money;
    periodTaxableCentavos: Money;
    periodWithheldCentavos: Money;
    annualBrackets: Bracket[];
}): Annualisation {
    const annualTaxable = args.ytdTaxableCentavos + args.periodTaxableCentavos;
    const withheld = args.ytdWithheldCentavos + args.periodWithheldCentavos;
    const annualTax = roundHalfUp(
        annualTaxPesos(annualTaxable / 100, args.annualBrackets) * 100,
    );
    return {
        annualTaxableCentavos: annualTaxable,
        annualTaxCentavos: annualTax,
        withheldCentavos: withheld,
        trueUpCentavos: annualTax - withheld,
    };
}

/** Convenience for callers holding centavos: gross taxable Money → tax Money. */
export function semiMonthlyTaxCentavos(
    taxableCutoffCentavos: Money,
    annualBrackets: Bracket[],
): Money {
    return roundHalfUp(
        semiMonthlyTaxPesos(taxableCutoffCentavos / 100, annualBrackets) * 100,
    );
}
