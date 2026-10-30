// Year-end (P7) — annualisation, 2316 and the alphalist, as pure functions.
//
// D4's contract: ONE function feeds both the December true-up and the 2316, so the
// certificate an employee receives can never disagree with the tax the register
// actually collected. Everything here therefore takes the register's own sums as
// input and never re-derives a period.
import { annualTaxPesos, taxFor, type Bracket } from "./tax";
import type { Money } from "./types";

/** One employee's year, as summed from the register. */
export interface YearTotals {
    employeeId: string;
    name: string;
    tin: string;
    /** Every earning line, including non-taxable ones. */
    grossCentavos: Money;
    /** Earning lines marked non-taxable (13th month within the ceiling, de minimis). */
    nonTaxableCentavos: Money;
    /** TAX lines across the year. */
    withheldCentavos: Money;
    /** 13th month + other benefits released during the year. */
    thirteenthMonthCentavos: Money;
    /**
     * Taxable compensation carried in from before HRX (P11). Set only when an opening
     * balance exists, because it cannot be inferred from gross − non-taxable: the old
     * system's non-taxable items are not all 13th month.
     */
    openingTaxableCentavos?: Money;
}

export interface Tax2316Row extends YearTotals {
    taxableCentavos: Money;
    /** Tax due on the year's taxable compensation, from the annual brackets. */
    taxDueCentavos: Money;
    /** Positive = still to collect, negative = over-withheld. */
    trueUpCentavos: Money;
}

const roundHalfUp = (value: number) => Math.round(value);

/** Taxable compensation is gross less everything the register marked non-taxable. */
export function taxableOf(totals: YearTotals): Money {
    if (totals.openingTaxableCentavos !== undefined) {
        return Math.max(0, totals.openingTaxableCentavos);
    }
    return Math.max(0, totals.grossCentavos - totals.nonTaxableCentavos);
}

/**
 * The 2316 figures. `taxDue` comes from the annual brackets; the true-up is what the
 * December run would book, which is why both are produced here.
 */
export function build2316(rows: YearTotals[], brackets: Bracket[]): Tax2316Row[] {
    return rows.map((row) => {
        const taxableCentavos = taxableOf(row);
        const taxDueCentavos = roundHalfUp(annualTaxPesos(taxableCentavos / 100, brackets) * 100);
        return {
            ...row,
            taxableCentavos,
            taxDueCentavos,
            trueUpCentavos: taxDueCentavos - row.withheldCentavos,
        };
    });
}

export interface AlphalistHeader {
    tin: string;
    branchCode: string;
    registeredName: string;
    year: number;
    /** Statutory tax table version used (D17). */
    tableVersion: string;
}

/**
 * BIR alphalist rows. Column order follows the annual information return: TIN,
 * employee name, gross, non-taxable, taxable, tax due, tax withheld.
 */
export function alphalistRows(rows: Tax2316Row[]): (string | number)[][] {
    return [...rows]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((row, index) => [
            index + 1,
            row.tin || "-",
            row.name,
            (row.grossCentavos / 100).toFixed(2),
            (row.nonTaxableCentavos / 100).toFixed(2),
            (row.taxableCentavos / 100).toFixed(2),
            (row.taxDueCentavos / 100).toFixed(2),
            (row.withheldCentavos / 100).toFixed(2),
        ]);
}

export function alphalistTotals(rows: Tax2316Row[]) {
    const sum = (pick: (row: Tax2316Row) => Money) => rows.reduce((total, row) => total + pick(row), 0);
    return {
        grossCentavos: sum((r) => r.grossCentavos),
        nonTaxableCentavos: sum((r) => r.nonTaxableCentavos),
        taxableCentavos: sum((r) => r.taxableCentavos),
        taxDueCentavos: sum((r) => r.taxDueCentavos),
        withheldCentavos: sum((r) => r.withheldCentavos),
    };
}

export interface Preflight {
    ok: boolean;
    /** Alphalist tax withheld minus the remittances actually recorded. */
    differenceCentavos: Money;
    message: string;
}

/**
 * The §1.3 rejection: an alphalist that does not reconcile to the remittances is
 * refused BEFORE it is exported, because the mismatch is what gets an employer
 * audited — and it is invisible once the file leaves the building.
 */
export function alphalistPreflight(args: {
    withheldCentavos: Money;
    remittedCentavos: Money;
}): Preflight {
    const difference = args.withheldCentavos - args.remittedCentavos;
    if (difference === 0) {
        return { ok: true, differenceCentavos: 0, message: "Alphalist agrees with the recorded remittances." };
    }
    const direction = difference > 0 ? "under-remitted" : "over-remitted";
    return {
        ok: false,
        differenceCentavos: difference,
        message: `Alphalist withholds ${(args.withheldCentavos / 100).toFixed(2)} but ${(args.remittedCentavos / 100).toFixed(2)} was remitted — ${direction} by ${(Math.abs(difference) / 100).toFixed(2)}. Export refused.`,
    };
}

/**
 * Carry-forward. Loans carry in `loanAccounts.balance`; the 13th-month ledger is keyed
 * by year, so a new year starts at zero by construction. What can go unexplained is
 * an accrual that was never released, so that is what this checks.
 */
export function carryForward(args: {
    accruedCentavos: Money;
    paidCentavos: Money;
    carriedCentavos: Money;
}): { unexplainedCentavos: Money; ok: boolean } {
    const unexplained = args.accruedCentavos - args.paidCentavos - args.carriedCentavos;
    return { unexplainedCentavos: unexplained, ok: unexplained === 0 };
}

/** Render the alphalist CSV with the BIR header block. */
export function renderAlphalist(header: AlphalistHeader, rows: Tax2316Row[]): string {
    const cell = (value: string | number) => {
        const text = String(value);
        return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };
    const totals = alphalistTotals(rows);
    const lines: string[] = [
        ["TIN", header.tin].map(cell).join(","),
        ["Branch code", header.branchCode].map(cell).join(","),
        ["Registered name", header.registeredName].map(cell).join(","),
        ["Year", header.year].map(cell).join(","),
        ["Tax table", header.tableVersion].map(cell).join(","),
        "",
        ["No.", "TIN", "Employee", "Gross", "Non-taxable", "Taxable", "Tax due", "Tax withheld"]
            .map(cell)
            .join(","),
        ...alphalistRows(rows).map((row) => row.map(cell).join(",")),
        [
            "",
            "",
            `TOTAL (${rows.length})`,
            (totals.grossCentavos / 100).toFixed(2),
            (totals.nonTaxableCentavos / 100).toFixed(2),
            (totals.taxableCentavos / 100).toFixed(2),
            (totals.taxDueCentavos / 100).toFixed(2),
            (totals.withheldCentavos / 100).toFixed(2),
        ]
            .map(cell)
            .join(","),
    ];
    return `${lines.join("\r\n")}\r\n`;
}

/** Annual tax on one figure — used by the 2316 preview and by tests. */
export function annualTaxOn(taxableCentavos: Money, brackets: Bracket[]): Money {
    return roundHalfUp(annualTaxPesos(taxableCentavos / 100, brackets) * 100);
}

/** Keep `taxFor` exported through this module so callers need one import. */
export { taxFor };
