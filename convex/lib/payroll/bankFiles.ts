// Bank disbursement files (P4.1, D11). Pure — no ctx, no DB — so the layout can be
// asserted by a fixture instead of inspected in a browser.
//
// Full credit is never sent: v1 emits a file the employer's bank moves the money
// with (D11 rejected payout rails). Every layout carries `verified`, because a bank
// will reject a file whose columns are one field off, and "we assumed" is not an
// answer to the client on payday.
import { sha256Hex } from "./sha256";

/** Every column must exist on DisbursementRow — no aspirational fields. */
export type BankColumn = "accountNumber" | "accountName" | "amount" | "reference";

export type BankLayout = {
    id: "generic" | "bdo";
    label: string;
    /**
     * FALSE means the column set has NOT been matched against the bank's own sample
     * file. The UI shows a warning and the run pack records it, so nobody discovers
     * the mismatch after the transfer.
     */
    verified: boolean;
    note: string;
    columns: BankColumn[];
    includeHeader: boolean;
    /** BDO's upload templates are comma-separated with CRLF line endings. */
    delimiter: string;
    lineEnding: string;
};

export const BANK_LAYOUTS: BankLayout[] = [
    {
        id: "generic",
        label: "Generic (account, name, amount, reference)",
        verified: true,
        note: "The portable shape: any bank's internet portal can be fed this by hand.",
        columns: ["accountNumber", "accountName", "amount", "reference"],
        includeHeader: true,
        delimiter: ",",
        lineEnding: "\r\n",
    },
    {
        id: "bdo",
        label: "BDO payroll upload",
        verified: false,
        note: "BDO is the pilot's bank (D-PILOT-7). The column set here must be matched against BDO's own sample/template before the first live payout — obtain it from the client's account officer, then adjust this layout (it is data, not code).",
        columns: ["accountNumber", "accountName", "amount", "reference"],
        includeHeader: false,
        delimiter: ",",
        lineEnding: "\r\n",
    },
];

export type DisbursementRow = {
    accountNumber: string;
    accountName: string;
    /** Pesos, already rounded to 2dp by the caller. */
    amount: number;
    reference: string;
};

const HEADERS: Record<BankColumn, string> = {
    accountNumber: "Account Number",
    accountName: "Account Name",
    amount: "Amount",
    reference: "Reference",
};

/** CSV-safe field: quote when it contains a delimiter, quote or newline. */
function field(value: string): string {
    if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
    return value;
}

/** Pesos as the plain 2-decimal figure a bank file expects — no separators, no symbol. */
export function bankAmount(pesos: number): string {
    return pesos.toFixed(2);
}

export type BankFile = {
    filename: string;
    content: string;
    sha256: string;
    layout: BankLayout;
    rowCount: number;
    total: number;
};

/**
 * Render one layout for a set of rows.
 *
 * `filename` carries the run id and version, so two versions of the same period can
 * never be confused once they are sitting in the same downloads folder.
 */
export function renderBankFile(args: {
    layout: BankLayout;
    rows: DisbursementRow[];
    runId: string;
    version: number;
}): BankFile {
    const { layout, rows, runId, version } = args;
    if (rows.length === 0) {
        throw new Error("A bank file with no rows would pay nobody — refusing");
    }
    for (const row of rows) {
        if (!row.accountNumber.trim()) {
            throw new Error(
                `Missing account number for ${row.accountName || "(unnamed)"} — a row without an account cannot be paid`,
            );
        }
        if (!(row.amount > 0)) {
            throw new Error(
                `Amount for ${row.accountName || row.accountNumber} is not positive — net pay was not computed`,
            );
        }
    }

    const lines: string[] = [];
    if (layout.includeHeader) {
        lines.push(layout.columns.map((column) => field(HEADERS[column])).join(layout.delimiter));
    }
    for (const row of rows) {
        lines.push(
            layout.columns
                .map((column) =>
                    column === "amount"
                        ? bankAmount(row.amount)
                        : field(String(row[column] ?? "")),
                )
                .join(layout.delimiter),
        );
    }
    const content = `${lines.join(layout.lineEnding)}${layout.lineEnding}`;
    const total = Math.round(rows.reduce((sum, row) => sum + row.amount, 0) * 100) / 100;

    return {
        filename: `hrx-${runId}-v${version}-${layout.id}.csv`,
        content,
        sha256: sha256Hex(content),
        layout,
        rowCount: rows.length,
        total,
    };
}

/** The register as CSV — part of the run pack (P4.2). */
export function renderRegisterCsv(rows: {
    employeeName: string;
    gross: number;
    totalDeductions: number;
    net: number;
    employerCost: number;
}[]): string {
    const header = ["Employee", "Gross", "Deductions", "Net", "Employer Cost"];
    const body = rows.map((row) =>
        [field(row.employeeName), bankAmount(row.gross), bankAmount(row.totalDeductions), bankAmount(row.net), bankAmount(row.employerCost)].join(","),
    );
    return `${[header.join(","), ...body].join("\r\n")}\r\n`;
}
