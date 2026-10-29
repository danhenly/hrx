"use client";

import { useMutation, useQuery } from "convex/react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const peso = (value: number) =>
  value.toLocaleString("en-PH", { style: "currency", currency: "PHP" });

/** Save text to the browser's downloads. */
function download(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * Government schedules (P6).
 *
 * Each form is a restatement of what the register booked, stamped with the statutory
 * table version it was produced under — so a later rate change cannot be read back
 * into a period that has already been filed.
 */
export function GovFormsPanel({
  orgId,
  runId,
}: {
  orgId: Id<"organizations">;
  runId: Id<"payrollRuns">;
}) {
  const preview = useQuery(api.payroll.govReports.previewGovForms, { orgId, runId });
  const artefacts = useQuery(api.payroll.payout.listArtefacts, { runId });
  const generate = useMutation(api.payroll.govReports.generateGovForms);
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState<string | null>(null);

  if (preview === undefined) {
    return <p className="text-muted-foreground text-sm">Loading schedules…</p>;
  }

  const schedules = artefacts?.filter((row) => row.kind === "gov_schedule") ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          disabled={isPending}
          onClick={() =>
            startTransition(async () => {
              try {
                const result = await generate({ orgId, runId });
                toast.success(`${result.created.length} schedule(s) generated`);
              } catch (error) {
                toast.error((error as Error).message ?? "Could not generate the schedules");
              }
            })
          }
        >
          Generate schedules
        </Button>
        <p className="text-muted-foreground text-xs">
          Totals restate the register&apos;s own lines; nothing is recomputed from today&apos;s tables.
        </p>
      </div>

      {schedules.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {schedules.map((artefact) => (
            <Button
              key={artefact._id}
              size="sm"
              variant="outline"
              onClick={() => download(artefact.filename, artefact.content)}
            >
              {artefact.filename}
            </Button>
          ))}
        </div>
      )}

      {preview.forms.map((form) => (
        <section key={form.id} className="rounded-md border">
          <header className="flex flex-wrap items-baseline justify-between gap-2 border-b px-3 py-2">
            <div>
              <h3 className="font-medium text-sm">{form.title}</h3>
              <p className="text-muted-foreground text-xs">
                {form.periodLabel} · {form.rows.length} row(s) · table {form.tableVersion}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs">
                EE {peso(form.totals.employeeCentavos / 100)} · ER{" "}
                {peso(form.totals.employerCentavos / 100)}
                {form.totals.extraCentavos > 0 && ` · EC ${peso(form.totals.extraCentavos / 100)}`}
                {form.totals.loanCentavos > 0 && ` · loan ${peso(form.totals.loanCentavos / 100)}`}
              </span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setOpen(open === form.id ? null : form.id)}
              >
                {open === form.id ? "Hide" : "Show"}
              </Button>
            </div>
          </header>
          {open === form.id && (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    {form.columns.map((column) => (
                      <TableHead key={column}>{column}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {form.rows.map((row, index) => (
                    <TableRow key={`${form.id}-${index}`}>
                      {row.map((cell, cellIndex) => (
                        <TableCell key={`${form.id}-${index}-${cellIndex}`}>{cell}</TableCell>
                      ))}
                    </TableRow>
                  ))}
                  <TableRow>
                    {form.totalsRow.map((cell, index) => (
                      <TableCell key={`${form.id}-total-${index}`} className="font-medium">
                        {cell}
                      </TableCell>
                    ))}
                  </TableRow>
                </TableBody>
              </Table>
              <ul className="space-y-1 px-3 py-2 text-muted-foreground text-xs">
                {form.notes.map((note) => (
                  <li key={note}>· {note}</li>
                ))}
              </ul>
            </div>
          )}
        </section>
      ))}
    </div>
  );
}
