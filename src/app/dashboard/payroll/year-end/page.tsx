"use client";

import { useMutation, useQuery } from "convex/react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  Section,
  SectionDescription,
  SectionGroup,
  SectionHeader,
  SectionTitle,
} from "@/components/content/section";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useActiveOrg } from "@/providers/org-provider";
import { api } from "../../../../../convex/_generated/api";

const peso = (value: number) =>
  value.toLocaleString("en-PH", { style: "currency", currency: "PHP" });

/**
 * Year-end (P7).
 *
 * The 2316 figures, the alphalist and the close all come from one annualisation, so
 * the certificate an employee gets cannot disagree with the tax actually withheld.
 */
export default function YearEndPage() {
  const { orgId } = useActiveOrg();
  const years = useQuery(
    api.payroll.yearEnd.listYears,
    orgId ? { orgId } : "skip",
  );
  const [selected, setSelected] = useState<number | null>(null);
  const year = selected ?? years?.[0]?.year ?? null;

  const preview = useQuery(
    api.payroll.yearEnd.previewYearEnd,
    orgId && year ? { orgId, year } : "skip",
  );
  const generate = useMutation(api.payroll.yearEnd.generateAlphalist);
  const close = useMutation(api.payroll.yearEnd.closeYear);
  const [isPending, startTransition] = useTransition();

  if (!orgId) {
    return (
      <p className="text-muted-foreground text-sm">Select an organisation.</p>
    );
  }

  return (
    <SectionGroup width="wide">
      <Section>
        <SectionHeader>
          <SectionTitle>Year end</SectionTitle>
          <SectionDescription>
            Annualisation, the 2316 figures for every employee, and the
            alphalist. A year can only be closed when the alphalist reconciles
            to the remittances and the 13th month has been either paid or
            carried.
          </SectionDescription>
        </SectionHeader>

        <div className="mb-4 flex flex-wrap items-center gap-2">
          {(years ?? []).map((entry) => (
            <Button
              key={entry.year}
              size="sm"
              variant={entry.year === year ? "default" : "outline"}
              onClick={() => setSelected(entry.year)}
            >
              {entry.year}
              {entry.closed && (
                <Badge variant="secondary" className="ml-2">
                  closed
                </Badge>
              )}
            </Button>
          ))}
          {years?.length === 0 && (
            <p className="text-muted-foreground text-sm">
              No payroll periods yet.
            </p>
          )}
        </div>

        {preview && year && (
          <>
            <div className="mb-4 flex flex-wrap items-center gap-3 text-sm">
              <span>
                {preview.certificates.length} employee(s) · {preview.runCount}{" "}
                run(s)
              </span>
              <span className="text-muted-foreground">
                table {preview.tableVersion}
              </span>
              {preview.preflight.ok ? (
                <Badge variant="secondary">alphalist reconciles</Badge>
              ) : (
                <Badge variant="destructive">{preview.preflight.message}</Badge>
              )}
              {!preview.carryForward.ok && (
                <Badge variant="destructive">
                  13th month unexplained:{" "}
                  {peso(preview.carryForward.unexplainedCentavos / 100)}
                </Badge>
              )}
            </div>

            <div className="mb-4 flex flex-wrap gap-2">
              <Button
                size="sm"
                disabled={isPending || !preview.preflight.ok}
                onClick={() =>
                  startTransition(async () => {
                    try {
                      const file = await generate({ orgId, year });
                      toast.success(
                        `${file.filename} — ${file.rowCount} row(s)`,
                      );
                    } catch (error) {
                      toast.error(
                        (error as Error).message ??
                          "Could not generate the alphalist",
                      );
                    }
                  })
                }
              >
                Generate alphalist
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={isPending}
                onClick={() =>
                  startTransition(async () => {
                    try {
                      await close({ orgId, year });
                      toast.success(`${year} closed`);
                    } catch (error) {
                      toast.error(
                        (error as Error).message ?? "Could not close the year",
                      );
                    }
                  })
                }
              >
                Close {year}
              </Button>
            </div>

            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Employee</TableHead>
                    <TableHead>TIN</TableHead>
                    <TableHead className="text-right">Gross</TableHead>
                    <TableHead className="text-right">Non-taxable</TableHead>
                    <TableHead className="text-right">Taxable</TableHead>
                    <TableHead className="text-right">Tax due</TableHead>
                    <TableHead className="text-right">Withheld</TableHead>
                    <TableHead className="text-right">True-up</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.certificates.map((row) => (
                    <TableRow key={row.employeeId}>
                      <TableCell>{row.name}</TableCell>
                      <TableCell>{row.tin || "-"}</TableCell>
                      <TableCell className="text-right">
                        {peso(row.grossCentavos / 100)}
                      </TableCell>
                      <TableCell className="text-right">
                        {peso(row.nonTaxableCentavos / 100)}
                      </TableCell>
                      <TableCell className="text-right">
                        {peso(row.taxableCentavos / 100)}
                      </TableCell>
                      <TableCell className="text-right">
                        {peso(row.taxDueCentavos / 100)}
                      </TableCell>
                      <TableCell className="text-right">
                        {peso(row.withheldCentavos / 100)}
                      </TableCell>
                      <TableCell className="text-right">
                        {peso(row.trueUpCentavos / 100)}
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow>
                    <TableCell className="font-medium" colSpan={2}>
                      TOTAL ({preview.certificates.length})
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {peso(preview.totals.grossCentavos / 100)}
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {peso(preview.totals.nonTaxableCentavos / 100)}
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {peso(preview.totals.taxableCentavos / 100)}
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {peso(preview.totals.taxDueCentavos / 100)}
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {peso(preview.totals.withheldCentavos / 100)}
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {peso(
                        preview.certificates.reduce(
                          (sum, row) => sum + row.trueUpCentavos,
                          0,
                        ) / 100,
                      )}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </Section>
    </SectionGroup>
  );
}
