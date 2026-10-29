"use client";

import { useQuery } from "convex/react";
import { useParams } from "next/navigation";
import { PayslipSheet, PRINT_CSS } from "@/components/payroll/payslip-sheet";
import { Button } from "@/components/ui/button";
import { api } from "../../../../convex/_generated/api";

/**
 * The employee portal (P4.3, D13) — no account, no password: the URL token is the
 * credential and it resolves to exactly one payslip.
 *
 * Invalid, revoked and expired tokens are reported without saying which, so the page
 * cannot be used to probe for valid links.
 */
export default function PortalPayslipPage() {
  const params = useParams<{ token: string }>();
  const token = String(params.token ?? "");
  const data = useQuery(api.payroll.payslipLinks.getByToken, { token });

  if (data === undefined) {
    return <main className="p-8 text-sm">Loading payslip…</main>;
  }

  if (data.status !== "ok") {
    return (
      <main className="mx-auto max-w-md p-8 text-sm">
        <h1 className="mb-2 font-semibold text-base">
          This payslip link is not valid
        </h1>
        <p className="text-muted-foreground">
          It may have expired or been withdrawn. Ask your HR team for a new
          link.
        </p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-neutral-100 p-6 print:bg-white print:p-0">
      <style>{PRINT_CSS}</style>
      <div className="no-print mx-auto mb-4 flex max-w-[190mm] justify-end">
        <Button size="sm" onClick={() => window.print()}>
          Print
        </Button>
      </div>
      <PayslipSheet sheet={data} />
    </main>
  );
}
