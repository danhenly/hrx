"use client";

import { useQuery } from "convex/react";
import { useParams } from "next/navigation";
import { PayslipSheet, PRINT_CSS } from "@/components/payroll/payslip-sheet";
import { Button } from "@/components/ui/button";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";

/**
 * "Print all payslips for this run" (P4.3) — one A4 page per employee, in name order,
 * with a page break between them so the office printer does not interleave two
 * people's pay on one sheet.
 */
export default function RunPrintPage() {
  const params = useParams<{ runId: string }>();
  const runId = params.runId as Id<"payrollRuns">;
  const sheets = useQuery(api.payroll.payout.printableForRun, { runId });

  return (
    <main className="min-h-screen bg-neutral-100 p-6 print:bg-white print:p-0">
      <style>{PRINT_CSS}</style>
      <div className="no-print mx-auto mb-4 flex max-w-[190mm] items-center justify-between">
        <a className="text-sm underline" href="/dashboard/payroll">
          ← Payroll
        </a>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">
            {sheets ? `${sheets.length} payslip(s)` : "Loading…"}
          </span>
          <Button size="sm" onClick={() => window.print()}>
            Print all
          </Button>
        </div>
      </div>
      {sheets === undefined ? (
        <p className="mx-auto max-w-[190mm] text-sm">Loading payslips…</p>
      ) : sheets.length === 0 ? (
        <p className="mx-auto max-w-[190mm] text-sm">
          This run has no payslips yet.
        </p>
      ) : (
        <div className="space-y-6 print:space-y-0">
          {sheets.map((sheet) => (
            <PayslipSheet key={sheet.payslip._id} sheet={sheet} />
          ))}
        </div>
      )}
    </main>
  );
}
