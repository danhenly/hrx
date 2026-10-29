"use client";

import { useQuery } from "convex/react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

/**
 * "Preview this cutoff" (P1.5).
 *
 * Runs the engine and persists NOTHING — no run, no payslip. This is the review
 * surface for P1: what a reviewer sees here is what the fixtures assert, to the
 * centavo.
 *
 * The preview is deliberately labelled incomplete: statutory contributions,
 * withholding tax, loans and 13th month are P2/P5, so the "net" here is earnings
 * only and is not a payable amount.
 */

const manilaDate = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Manila",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const peso = (centavos: number) =>
  (centavos / 100).toLocaleString("en-PH", {
    style: "currency",
    currency: "PHP",
    minimumFractionDigits: 2,
  });

export function FormPayrollPreview({
  employeeId,
  orgId,
}: {
  employeeId: Id<"employees">;
  orgId: Id<"organizations"> | undefined;
}) {
  const periods = useQuery(
    api.payroll.previewPayslip.listPeriods,
    orgId ? { orgId } : "skip",
  );
  const [periodId, setPeriodId] = useState<string | undefined>(undefined);
  const preview = useQuery(
    api.payroll.previewPayslip.previewPayslip,
    orgId ? { orgId, employeeId, periodId: periodId as Id<"payrollPeriods"> | undefined } : "skip",
  );

  if (!orgId || periods === undefined) {
    return <Skeleton className="m-4 h-24 w-[calc(100%-2rem)]" />;
  }

  if (periods.length === 0) {
    return (
      <div className="space-y-2 px-4 py-4 text-sm">
        <p className="font-medium">No payroll period yet.</p>
        <p className="text-muted-foreground">
          Periods are created with the run (P3). To try the engine today, seed a
          test dataset — it creates the pilot's periods for you.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4 px-4 py-4">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-sm">Preview a cutoff</span>
        <Select
          value={periodId ?? periods[0]._id}
          onValueChange={(value) => setPeriodId(value)}
        >
          <SelectTrigger className="w-[260px]" aria-label="Payroll period">
            <SelectValue placeholder="Pick a period" />
          </SelectTrigger>
          <SelectContent>
            {periods.map((period) => (
              <SelectItem key={period._id} value={period._id}>
                {manilaDate.format(new Date(period.startDate))} →{" "}
                {manilaDate.format(new Date(period.endDate))}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {preview === undefined ? (
        <Skeleton className="h-32 w-full" />
      ) : preview.status === "unresolved" ? (
        <div className="space-y-1 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          <p className="font-medium">Pay terms are incomplete — nothing was computed.</p>
          {preview.issues.map((issue) => (
            <p key={issue} className="text-muted-foreground text-xs">
              {issue}
            </p>
          ))}
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Badge variant="secondary">
              {preview.terms.payType} · {peso(Math.round(preview.terms.basicRate * 100))}
            </Badge>
            <Badge variant="secondary">basis {preview.terms.dailyRateBasis}</Badge>
            <Badge variant="secondary">
              {preview.terms.workWeek === "6_day" ? "6-day week" : "5-day week"}
            </Badge>
            <span className="text-muted-foreground">
              {preview.dayCount} priced day(s)
              {preview.excluded.length > 0
                ? ` · ${preview.excluded.length} excluded (not approved)`
                : ""}
            </span>
          </div>

          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {preview.result.lines.map((line, index) => (
                  <TableRow key={`${line.code}-${index}`}>
                    <TableCell className="font-mono text-xs">{line.code}</TableCell>
                    <TableCell className="text-xs">
                      {line.description}
                      {line.kind === "memo" ? (
                        <span className="text-muted-foreground"> (memo)</span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right text-xs">
                      {line.quantity ?? ""}
                    </TableCell>
                    <TableCell
                      className={
                        line.kind === "memo"
                          ? "text-right text-muted-foreground text-xs"
                          : "text-right text-xs"
                      }
                    >
                      {line.kind === "memo" ? "—" : peso(line.amount)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="flex flex-wrap gap-4 text-sm">
            <span>
              Gross <strong>{peso(preview.result.gross)}</strong>
            </span>
            <span className="text-muted-foreground">
              Deductions {peso(preview.result.totalDeductions)}
            </span>
            <span className="text-muted-foreground">
              Earnings-only total {peso(preview.result.net)}
            </span>
          </div>

          {preview.result.blocked && (
            <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
              <strong>Not a payable amount.</strong>{" "}
              {preview.result.blocked.reason}
            </p>
          )}

          {preview.result.notes && preview.result.notes.length > 0 && (
            <ul className="list-disc space-y-1 pl-5 text-muted-foreground text-xs">
              {preview.result.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
