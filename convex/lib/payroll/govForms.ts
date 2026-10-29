// Government schedules (P6) — pure builders, no ctx.
//
// Design rule (D19/A9): a filed period must never be re-derived from TODAY's statutory
// tables. Every form therefore carries the version string of the table it was produced
// from, and anything the register does not record is left out with a note rather than
// reconstructed later from a table that may since have changed.
import type { Money } from "./types";

export type GovFormId = "sss_r3" | "philhealth_rf1" | "pagibig_mcrf" | "bir_1601c";

/** One employee's contribution row, already resolved to money. */
export interface GovRow {
    employeeId: string;
    name: string;
    /** SSS number / PhilHealth number / Pag-IBIG MID / TIN, or "" when unknown. */
    reference: string;
    employeeCentavos: Money;
    employerCentavos: Money;
    /** Employer-only flat amount (SSS EC). */
    extraCentavos?: Money;
    /** Loan repayment collected this period (SSS salary loan). */
    loanCentavos?: Money;
    /** Gross taxable compensation (1601-C). */
    taxableCentavos?: Money;
    /** Gross compensation including non-taxable items (1601-C). */
    grossCentavos?: Money;
}

export interface GovTotals {
    employeeCentavos: Money;
    employerCentavos: Money;
    extraCentavos: Money;
    loanCentavos: Money;
    grossCentavos: Money;
    taxableCentavos: Money;
}

export interface GovForm {
    id: GovFormId;
    title: string;
    /** Statutory table version this form was produced from (D17). */
    tableVersion: string;
    periodLabel: string;
    columns: string[];
    rows: (string | number)[][];
    totalsRow: (string | number)[];
    totals: GovTotals;
    notes: string[];
}

const EMPTY_TOTALS: GovTotals = {
    employeeCentavos: 0,
    employerCentavos: 0,
    extraCentavos: 0,
    loanCentavos: 0,
    grossCentavos: 0,
    taxableCentavos: 0,
};

export function sumGovRows(rows: GovRow[]): GovTotals {
    const t = { ...EMPTY_TOTALS };
    for (const row of rows) {
        t.employeeCentavos += row.employeeCentavos;
        t.employerCentavos += row.employerCentavos;
        t.extraCentavos += row.extraCentavos ?? 0;
        t.loanCentavos += row.loanCentavos ?? 0;
        t.grossCentavos += row.grossCentavos ?? 0;
        t.taxableCentavos += row.taxableCentavos ?? 0;
    }
    return t;
}

/** Payload shape of one `payslipLines` row, as the register stores it (amounts in pesos). */
export interface LineLike {
    payslipId: string;
    kind: "earning" | "deduction" | "employer_cost" | "memo";
    code: string;
    amount: number;
    taxable: boolean;
}

export interface Bucket {
    sss: Money;
    sssEr: Money;
    ec: Money;
    sssLoan: Money;
    phic: Money;
    phicEr: Money;
    hdmf: Money;
    hdmfEr: Money;
    tax: Money;
    gross: Money;
    taxable: Money;
}

export function emptyBucket(): Bucket {
    return {
        sss: 0, sssEr: 0, ec: 0, sssLoan: 0,
        phic: 0, phicEr: 0, hdmf: 0, hdmfEr: 0,
        tax: 0, gross: 0, taxable: 0,
    };
}

/**
 * Turn a run's payslip lines into one contribution bucket per payslip.
 *
 * This is the ONLY place a government figure is derived, so it is pure and fixture-
 * tested: employer shares come from `employer_cost` lines, `memo` lines (13th-month
 * accrual, rate derivation) never touch gross, and only an SSS loan reaches the R-3
 * loan column.
 */
export function bucketLines(payslipIds: string[], lines: LineLike[]): Record<string, Bucket> {
    const buckets: Record<string, Bucket> = {};
    for (const id of payslipIds) buckets[id] = emptyBucket();
    for (const line of lines) {
        const bucket = buckets[line.payslipId];
        if (!bucket) continue;
        const amount = Math.round(line.amount * 100);
        switch (line.code) {
            case "SSS": bucket.sss += amount; break;
            case "SSS_ER": bucket.sssEr += amount; break;
            case "EC": bucket.ec += amount; break;
            case "SSS_LOAN": bucket.sssLoan += amount; break;
            case "PHIC": bucket.phic += amount; break;
            case "PHIC_ER": bucket.phicEr += amount; break;
            case "HDMF": bucket.hdmf += amount; break;
            case "HDMF_ER": bucket.hdmfEr += amount; break;
            case "TAX": bucket.tax += amount; break;
            default:
                if (line.kind === "earning") {
                    bucket.gross += amount;
                    if (line.taxable) bucket.taxable += amount;
                }
        }
    }
    return buckets;
}

/** Gross compensation the register booked for a bucket (earnings only, memos excluded). */
export function taxableOf(bucket: Bucket): Money {
    return bucket.taxable;
}

/** Centavos to the two-decimal string a filing form wants. */
export function peso(centavos: Money): string {
    const negative = centavos < 0;
    const abs = Math.abs(Math.round(centavos));
    const whole = Math.floor(abs / 100);
    const cents = String(abs % 100).padStart(2, "0");
    return `${negative ? "-" : ""}${whole}.${cents}`;
}

/** Sort by employee name so two runs of the same period produce identical files. */
function byName(rows: GovRow[]): GovRow[] {
    return [...rows].sort((a, b) =>
        a.name === b.name ? a.employeeId.localeCompare(b.employeeId) : a.name.localeCompare(b.name),
    );
}

/**
 * A builder must total ONLY the columns it displays — otherwise a caller that passes
 * one row set to every form leaks SSS EC into the PhilHealth total.
 */
function scalar(row: GovRow, fields: Partial<GovRow>): GovRow {
    return { ...row, ...fields };
}

/** SSS R-3 shaped: one row per member, employer and employee columns side by side. */
export function buildR3(input: {
    rows: GovRow[];
    tableVersion: string;
    periodLabel: string;
    mscByEmployee?: Record<string, number>;
}): GovForm {
    const rows = byName(input.rows.filter((r) => r.employeeCentavos || r.employerCentavos || r.extraCentavos));
    const hasMsc = input.mscByEmployee !== undefined;
    const columns = [
        "No.",
        "SSS Number",
        "Member Name",
        ...(hasMsc ? ["MSC"] : []),
        "EE SS",
        "ER SS",
        "EC",
        "SSS Loan",
        "Total",
    ];
    const body = rows.map((row, index) => {
        const total =
            row.employeeCentavos + row.employerCentavos + (row.extraCentavos ?? 0) + (row.loanCentavos ?? 0);
        return [
            index + 1,
            row.reference || "-",
            row.name,
            ...(hasMsc ? [String(input.mscByEmployee?.[row.employeeId] ?? 0)] : []),
            peso(row.employeeCentavos),
            peso(row.employerCentavos),
            peso(row.extraCentavos ?? 0),
            peso(row.loanCentavos ?? 0),
            peso(total),
        ];
    });
    const totals = sumGovRows(rows);
    const totalsRow = [
        "",
        "",
        `TOTAL (${rows.length})`,
        ...(hasMsc ? [""] : []),
        peso(totals.employeeCentavos),
        peso(totals.employerCentavos),
        peso(totals.extraCentavos),
        peso(totals.loanCentavos),
        peso(
            totals.employeeCentavos + totals.employerCentavos + totals.extraCentavos + totals.loanCentavos,
        ),
    ];
    const notes = [
        "R-3 shaped schedule of SSS contributions. Column order follows the collection list.",
        hasMsc
            ? "MSC is the monthly salary credit stored on each payslip."
            : "MSC and the MPF/WISP split are omitted: this register does not record the salary credit, and re-deriving it from today's table would misstate a filed period.",
        "Contribution amounts are the amounts actually withheld and booked by the register, not a re-computation.",
    ];
    return {
        id: "sss_r3",
        title: "SSS R-3 contribution schedule",
        tableVersion: input.tableVersion,
        periodLabel: input.periodLabel,
        columns,
        rows: body,
        totalsRow,
        totals,
        notes,
    };
}

/** PhilHealth RF-1 shaped: premium, employee and employer share. */
export function buildRf1(input: {
    rows: GovRow[];
    tableVersion: string;
    periodLabel: string;
}): GovForm {
    const rows = byName(input.rows.filter((r) => r.employeeCentavos || r.employerCentavos));
    const columns = ["No.", "PhilHealth Number", "Member Name", "EE Share", "ER Share", "Total Premium"];
    const body = rows.map((row, index) => [
        index + 1,
        row.reference || "-",
        row.name,
        peso(row.employeeCentavos),
        peso(row.employerCentavos),
        peso(row.employeeCentavos + row.employerCentavos),
    ]);
    const totals = sumGovRows(rows.map((row) => scalar(row, { extraCentavos: 0, loanCentavos: 0, grossCentavos: 0, taxableCentavos: 0 })));
    const totalsRow = [
        "",
        "",
        `TOTAL (${rows.length})`,
        peso(totals.employeeCentavos),
        peso(totals.employerCentavos),
        peso(totals.employeeCentavos + totals.employerCentavos),
    ];
    return {
        id: "philhealth_rf1",
        title: "PhilHealth RF-1 remittance report",
        tableVersion: input.tableVersion,
        periodLabel: input.periodLabel,
        columns,
        rows: body,
        totalsRow,
        totals,
        notes: [
            "RF-1 shaped schedule. Amounts are the premiums booked by the register for this period.",
            "A calendar month's remittance is the sum of its cutoffs; this schedule covers one payroll period.",
        ],
    };
}

/** Pag-IBIG MCRF shaped: member, EE and ER shares against the fund salary. */
export function buildMcrf(input: {
    rows: GovRow[];
    tableVersion: string;
    periodLabel: string;
    fundSalaryByEmployee?: Record<string, number>;
}): GovForm {
    const rows = byName(input.rows.filter((r) => r.employeeCentavos || r.employerCentavos));
    const hasFund = input.fundSalaryByEmployee !== undefined;
    const columns = [
        "No.",
        "Pag-IBIG MID",
        "Member Name",
        ...(hasFund ? ["Fund Salary"] : []),
        "EE Share",
        "ER Share",
        "Total",
    ];
    const body = rows.map((row, index) => [
        index + 1,
        row.reference || "-",
        row.name,
        ...(hasFund ? [peso(Math.round((input.fundSalaryByEmployee?.[row.employeeId] ?? 0) * 100))] : []),
        peso(row.employeeCentavos),
        peso(row.employerCentavos),
        peso(row.employeeCentavos + row.employerCentavos),
    ]);
    const totals = sumGovRows(rows.map((row) => scalar(row, { extraCentavos: 0, loanCentavos: 0, grossCentavos: 0, taxableCentavos: 0 })));
    const totalsRow = [
        "",
        "",
        `TOTAL (${rows.length})`,
        ...(hasFund ? [""] : []),
        peso(totals.employeeCentavos),
        peso(totals.employerCentavos),
        peso(totals.employeeCentavos + totals.employerCentavos),
    ];
    return {
        id: "pagibig_mcrf",
        title: "Pag-IBIG MCRF contribution schedule",
        tableVersion: input.tableVersion,
        periodLabel: input.periodLabel,
        columns,
        rows: body,
        totalsRow,
        totals,
        notes: [
            "MCRF shaped schedule for the period's contributions.",
            "The fund salary is the capped monthly compensation the contributions were computed on.",
        ],
    };
}

/**
 * BIR 1601-C figures (D10): what the employer remits, and why.
 * Tax is the amount withheld by the register — never recomputed here.
 */
export function build1601C(input: {
    rows: GovRow[];
    tableVersion: string;
    periodLabel: string;
}): GovForm {
    const rows = byName(input.rows.filter((r) => (r.taxableCentavos ?? 0) !== 0 || r.employeeCentavos !== 0));
    const columns = [
        "No.",
        "TIN",
        "Employee Name",
        "Gross Compensation",
        "Non-taxable",
        "Taxable",
        "Tax Withheld",
    ];
    const body = rows.map((row, index) => {
        const gross = row.grossCentavos ?? 0;
        const taxable = row.taxableCentavos ?? 0;
        return [
            index + 1,
            row.reference || "-",
            row.name,
            peso(gross),
            peso(gross - taxable),
            peso(taxable),
            peso(row.employeeCentavos),
        ];
    });
    const totals = sumGovRows(rows.map((row) => scalar(row, { employerCentavos: 0, extraCentavos: 0, loanCentavos: 0 })));
    const totalsRow = [
        "",
        "",
        `TOTAL (${rows.length})`,
        peso(totals.grossCentavos),
        peso(totals.grossCentavos - totals.taxableCentavos),
        peso(totals.taxableCentavos),
        peso(totals.employeeCentavos),
    ];
    return {
        id: "bir_1601c",
        title: "BIR 1601-C withholding figures",
        tableVersion: input.tableVersion,
        periodLabel: input.periodLabel,
        columns,
        rows: body,
        totalsRow,
        totals,
        notes: [
            "Tax withheld is the TAX line of the register, summed per employee.",
            "1601-C is filed monthly: a month's figure is the sum of the cutoffs paid in it.",
        ],
    };
}

/** Quote a CSV cell only when it needs it (RFC 4180). */
export function csvCell(value: string | number): string {
    const text = String(value);
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Render one form as CSV with a header block carrying the table version. */
export function renderFormCsv(form: GovForm): string {
    const lines: string[] = [
        csvCell(form.title),
        csvCell(`Period: ${form.periodLabel}`),
        csvCell(`Statutory table: ${form.tableVersion}`),
        "",
        form.columns.map(csvCell).join(","),
        ...form.rows.map((row) => row.map(csvCell).join(",")),
        form.totalsRow.map(csvCell).join(","),
    ];
    for (const note of form.notes) lines.push(csvCell(`# ${note}`));
    return `${lines.join("\r\n")}\r\n`;
}

/** Filename that cannot collide between periods, versions or regenerations. */
export function formFilename(form: GovForm, runKey: string): string {
    const slug = form.periodLabel.replace(/[^0-9A-Za-z]+/g, "-").replace(/^-|-$/g, "");
    return `${form.id}-${slug}-${runKey}.csv`;
}
