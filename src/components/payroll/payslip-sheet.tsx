"use client";

/**
 * One A4 payslip (P4.3).
 *
 * The employee copy never shows employer shares: D3 says they are cost, not
 * deduction, and showing them on the employee's slip reads as money withheld. The HR
 * copy is the run pack.
 *
 * `@page` plus break-after is what makes "one page per employee" true in the browser's
 * print dialog rather than a hope.
 */

export const PRINT_CSS = `
@media print {
  .no-print { display: none !important; }
  .payslip-page { break-after: page; page-break-after: always; }
  .payslip-page:last-child { break-after: auto; page-break-after: auto; }
  body { background: #fff; }
}
@page { size: A4; margin: 12mm; }
`;

export type SheetLine = {
  _id: string;
  kind: string;
  code: string;
  description: string;
  amount: number;
};

export type Sheet = {
  employee: { name: string };
  org: { name: string };
  run: { version: number; status: string };
  period: { startDate: number; endDate: number; payDate: number } | null;
  payslip: {
    gross: number;
    totalDeductions: number;
    net: number;
    daysWorked: number;
    minutesWorked: number;
  };
  lines: SheetLine[];
  memos: { _id: string; code: string; description: string }[];
};

const manila = (ms: number) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(
    new Date(ms),
  );

const peso = (value: number) =>
  value.toLocaleString("en-PH", {
    style: "currency",
    currency: "PHP",
    minimumFractionDigits: 2,
  });

export function PayslipSheet({ sheet }: { sheet: Sheet }) {
  const earnings = sheet.lines.filter((line) => line.kind === "earning");
  const deductions = sheet.lines.filter((line) => line.kind === "deduction");

  return (
    <article className="payslip-page mx-auto max-w-[190mm] border bg-white p-6 text-[12px] text-black print:border-0 print:p-0">
      <header className="mb-4 border-b pb-2">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="font-semibold text-base">
              {sheet.org.name || "Employer"}
            </h1>
            <p className="text-[11px]">Employee payslip</p>
          </div>
          <div className="text-right text-[11px]">
            <p className="font-medium">{sheet.employee.name}</p>
            {sheet.period && (
              <p>
                {manila(sheet.period.startDate)} →{" "}
                {manila(sheet.period.endDate)}
              </p>
            )}
            {sheet.period && <p>Pay date {manila(sheet.period.payDate)}</p>}
            <p>Run v{sheet.run.version}</p>
          </div>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-6">
        <section>
          <h2 className="mb-1 font-semibold text-[11px] uppercase">Earnings</h2>
          <table className="w-full">
            <tbody>
              {earnings.map((line) => (
                <tr key={line._id}>
                  <td className="py-[2px] pr-2">{line.description}</td>
                  <td className="py-[2px] text-right tabular-nums">
                    {peso(line.amount)}
                  </td>
                </tr>
              ))}
              <tr className="border-t">
                <td className="pt-1 font-medium">Gross pay</td>
                <td className="pt-1 text-right font-medium tabular-nums">
                  {peso(sheet.payslip.gross)}
                </td>
              </tr>
            </tbody>
          </table>
        </section>

        <section>
          <h2 className="mb-1 font-semibold text-[11px] uppercase">
            Deductions
          </h2>
          <table className="w-full">
            <tbody>
              {deductions.length === 0 && (
                <tr>
                  <td className="py-[2px]">None</td>
                  <td className="py-[2px] text-right">—</td>
                </tr>
              )}
              {deductions.map((line) => (
                <tr key={line._id}>
                  <td className="py-[2px] pr-2">{line.description}</td>
                  <td className="py-[2px] text-right tabular-nums">
                    {peso(line.amount)}
                  </td>
                </tr>
              ))}
              <tr className="border-t">
                <td className="pt-1 font-medium">Total deductions</td>
                <td className="pt-1 text-right font-medium tabular-nums">
                  {peso(sheet.payslip.totalDeductions)}
                </td>
              </tr>
            </tbody>
          </table>
        </section>
      </div>

      <div className="mt-4 flex items-center justify-between border-t pt-2">
        <span className="font-semibold">Net pay</span>
        <span className="font-semibold text-base tabular-nums">
          {peso(sheet.payslip.net)}
        </span>
      </div>

      <footer className="mt-4 space-y-1 border-t pt-2 text-[10px] text-neutral-600">
        <p>
          Days worked {sheet.payslip.daysWorked} · hours{" "}
          {(sheet.payslip.minutesWorked / 60).toFixed(2)}
        </p>
        {sheet.memos.map((memo) => (
          <p key={memo._id}>{memo.description}</p>
        ))}
        <p>
          Employer contributions (SSS, PhilHealth, Pag-IBIG) are paid by the
          employer and are not deducted from this payslip.
        </p>
      </footer>
    </article>
  );
}
