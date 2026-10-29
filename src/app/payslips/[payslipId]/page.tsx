"use client";

import { useQuery } from "convex/react";
import { useParams } from "next/navigation";
import { PayslipSheet, PRINT_CSS } from "@/components/payroll/payslip-sheet";
import { Button } from "@/components/ui/button";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

/**
 * HR copy of one payslip, laid out for A4 (P4.3). Deliberately outside /dashboard so
 * the page has no app chrome to fight with the print dialog.
 */
export default function PayslipPrintPage() {
  const params = useParams<{ payslipId: string }>();
  const payslipId = params.payslipId as Id<"payslips">;
  const data = useQuery(api.payroll.payout.printable, { payslipId });

  return (
    <main className="min-h-screen bg-neutral-100 p-6 print:bg-white print:p-0">
      <style>{PRINT_CSS}</style>
      <div className="no-print mx-auto mb-4 flex max-w-[190mm] items-center justify-between">
        <a className="text-sm underline" href="/dashboard/payroll">
          ← Payroll
        </a>
        <Button size="sm" onClick={() => window.print()}>
          Print
        </Button>
      </div>
      {data ? (
        <PayslipSheet sheet={data} />
      ) : (
        <p className="mx-auto max-w-[190mm] text-sm">Loading payslip…</p>
      )}
    </main>
  );
}
