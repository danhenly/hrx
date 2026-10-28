// Minimal CSV writer. Everything HRX exports is small (a pay period of daily
// entries), so this stays dependency-free rather than pulling in a CSV library.

/** Cells starting with these are treated as formulas by Excel/Sheets. */
const FORMULA_LEAD = /^[=+\-@\t\r]/;

function escapeCell(value: string | number): string {
  let text = String(value);
  // Neutralise formula injection before quoting: notes are free text from
  // employees.
  if (FORMULA_LEAD.test(text)) text = `'${text}`;
  if (/[",\r\n]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function toCsv(rows: (string | number)[][]): string {
  return rows.map((row) => row.map(escapeCell).join(",")).join("\r\n");
}

/** Browser-only: call from a "use client" component, never at module scope. */
export function downloadCsv(filename: string, csv: string) {
  // BOM keeps Excel from mangling the peso sign and accented names.
  const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
