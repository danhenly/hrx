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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

interface ParsedRow {
  email?: string;
  gross: number;
  taxable: number;
  taxWithheld: number;
  thirteenthMonth: number;
}

/**
 * Opening balances (P11).
 *
 * A mid-year takeover needs the year-to-date the old system already paid, or every 2316
 * omits the tax withheld before the pilot started. The file is parsed in the browser and
 * validated on the server, row by row.
 */
export default function OpeningBalancesPage() {
  const { orgId } = useActiveOrg();
  const [year, setYear] = useState(new Date().getFullYear());
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [fileName, setFileName] = useState("");
  const existing = useQuery(
    api.payroll.openingBalances.listBalances,
    orgId ? { orgId, year } : "skip",
  );
  const importBalances = useMutation(
    api.payroll.openingBalances.importBalances,
  );
  const [isPending, startTransition] = useTransition();

  async function handleFile(file: File) {
    const text = await file.text();
    const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
    const parsed: ParsedRow[] = [];
    for (const [index, line] of lines.entries()) {
      if (index === 0 && /email/i.test(line)) continue;
      const cells = line
        .split(",")
        .map((cell) => cell.trim().replace(/^"|"$/g, ""));
      const [email, gross, taxable, taxWithheld, thirteenthMonth] = cells;
      parsed.push({
        email,
        gross: Number(gross),
        taxable: Number(taxable),
        taxWithheld: Number(taxWithheld),
        thirteenthMonth: Number(thirteenthMonth ?? 0),
      });
    }
    setRows(parsed);
    setFileName(file.name);
  }

  if (!orgId) {
    return (
      <p className="text-muted-foreground text-sm">Select an organisation.</p>
    );
  }

  return (
    <SectionGroup width="wide">
      <Section>
        <SectionHeader>
          <SectionTitle>Opening balances</SectionTitle>
          <SectionDescription>
            What the old system already paid this year: gross, taxable, tax
            withheld and 13th month per employee. Without these, the December
            annualisation and every 2316 are wrong for a mid-year start.
          </SectionDescription>
        </SectionHeader>

        <div className="mb-4 flex flex-wrap items-end gap-2">
          <div>
            <label className="text-muted-foreground text-xs" htmlFor="ob-year">
              Year
            </label>
            <Input
              id="ob-year"
              className="w-28"
              type="number"
              value={year}
              onChange={(event) => setYear(Number(event.target.value))}
            />
          </div>
          <div>
            <label className="text-muted-foreground text-xs" htmlFor="ob-file">
              CSV: email,gross,taxable,tax_withheld,thirteenth_month
            </label>
            <Input
              id="ob-file"
              type="file"
              accept=".csv,text/csv"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void handleFile(file);
              }}
            />
          </div>
          <Button
            size="sm"
            disabled={isPending || rows.length === 0}
            onClick={() =>
              startTransition(async () => {
                try {
                  const result = await importBalances({
                    orgId,
                    year,
                    source:
                      fileName ||
                      `import ${new Date().toISOString().slice(0, 10)}`,
                    rows,
                  });
                  toast.success(
                    `${result.imported} row(s) imported${result.skipped.length ? `, ${result.skipped.length} skipped` : ""}`,
                  );
                  if (result.skipped.length > 0) {
                    toast.warning(
                      result.skipped
                        .slice(0, 3)
                        .map((skip) => `row ${skip.row}: ${skip.reason}`)
                        .join(" · "),
                    );
                  }
                  setRows([]);
                } catch (error) {
                  toast.error((error as Error).message ?? "Could not import");
                }
              })
            }
          >
            Import {rows.length > 0 ? `${rows.length} row(s)` : ""}
          </Button>
        </div>

        {rows.length > 0 && (
          <div className="mb-4 rounded-md border p-3">
            <p className="font-medium text-sm">Preview — {fileName}</p>
            <p className="text-muted-foreground text-xs">
              {rows.length} row(s) parsed. Nothing is stored until you import.
            </p>
          </div>
        )}

        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead className="text-right">Gross</TableHead>
                <TableHead className="text-right">Taxable</TableHead>
                <TableHead className="text-right">Tax withheld</TableHead>
                <TableHead className="text-right">13th month</TableHead>
                <TableHead>Source</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(existing ?? []).map((row) => (
                <TableRow key={row._id}>
                  <TableCell>{row.name}</TableCell>
                  <TableCell className="text-right">
                    {peso(row.grossPesos)}
                  </TableCell>
                  <TableCell className="text-right">
                    {peso(row.taxablePesos)}
                  </TableCell>
                  <TableCell className="text-right">
                    {peso(row.taxWithheldPesos)}
                  </TableCell>
                  <TableCell className="text-right">
                    {peso(row.thirteenthMonthPesos)}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs">
                    {row.source}
                  </TableCell>
                </TableRow>
              ))}
              {(existing ?? []).length === 0 && (
                <TableRow>
                  <TableCell className="text-muted-foreground" colSpan={6}>
                    Nothing imported for {year} yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </Section>
    </SectionGroup>
  );
}
