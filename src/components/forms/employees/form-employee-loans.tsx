"use client";

import { useMutation, useQuery } from "convex/react";
import { useTransition } from "react";
import { toast } from "sonner";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
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
 * Loans and final pay (P5.3).
 *
 * The pilot's SSS salary loan uses the **standard 10-month schedule**, so the term
 * defaults to 10 and the amortisation is derived (principal ÷ 10, then split across
 * two cutoffs) instead of typed. A loan with interest enters its own fixed
 * amortisation — this schedule is principal-only.
 */

const peso = (value: number) =>
  value.toLocaleString("en-PH", { style: "currency", currency: "PHP", minimumFractionDigits: 2 });

const LOAN_TYPES = [
  { value: "sss", label: "SSS salary loan" },
  { value: "pagibig", label: "Pag-IBIG MPL" },
  { value: "company", label: "Company loan" },
  { value: "advance", label: "Cash advance" },
] as const;

export function FormEmployeeLoans({
  employeeId,
  orgId,
}: {
  employeeId: Id<"employees">;
  orgId: Id<"organizations">;
}) {
  const loans = useQuery(api.payroll.loans.list, { orgId, employeeId });
  const finalPay = useQuery(api.payroll.finalPay.preview, { orgId, employeeId });
  const createLoan = useMutation(api.payroll.loans.create);
  const recordFinalPay = useMutation(api.payroll.finalPay.record);
  const [isPending, startTransition] = useTransition();

  const [type, setType] = useState<"sss" | "pagibig" | "company" | "advance">("sss");
  const [principal, setPrincipal] = useState("");
  const [term, setTerm] = useState("10");
  const [reference, setReference] = useState("");

  if (loans === undefined) return <Skeleton className="m-4 h-24" />;

  return (
    <div className="space-y-6 px-4 py-4">
      <div className="space-y-2">
        {loans.length === 0 ? (
          <p className="text-muted-foreground text-sm">No loans on record.</p>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead className="text-right">Principal</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                  <TableHead className="text-right">Per cutoff</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loans.map((loan) => (
                  <TableRow key={loan._id}>
                    <TableCell className="text-xs uppercase">{loan.type}</TableCell>
                    <TableCell className="text-xs">{loan.reference ?? "—"}</TableCell>
                    <TableCell className="text-right text-xs">{peso(loan.principal)}</TableCell>
                    <TableCell className="text-right text-xs">{peso(loan.balance)}</TableCell>
                    <TableCell className="text-right text-xs">{peso(loan.amortisation)}</TableCell>
                    <TableCell>
                      <Badge variant={loan.status === "active" ? "default" : "secondary"} className="text-xs">
                        {loan.status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 rounded-md border p-3">
          <div className="space-y-1.5">
            <Label>Type</Label>
            <Select value={type} onValueChange={(value) => setType(value as typeof type)}>
              <SelectTrigger aria-label="Loan type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LOAN_TYPES.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="principal">Principal (PHP)</Label>
            <Input
              id="principal"
              type="number"
              placeholder="30000"
              value={principal}
              onChange={(event) => setPrincipal(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="term">Term (months)</Label>
            <Input
              id="term"
              type="number"
              value={term}
              onChange={(event) => setTerm(event.target.value)}
            />
            <p className="text-muted-foreground text-xs">
              Standard 10 for an SSS salary loan.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="reference">Reference</Label>
            <Input
              id="reference"
              placeholder="SSSL-2026-0001"
              value={reference}
              onChange={(event) => setReference(event.target.value)}
            />
          </div>
          <div className="col-span-2 flex items-center justify-between">
            <span className="text-muted-foreground text-xs">
              {Number(principal) > 0 && Number(term) > 0
                ? `Amortisation ${peso(Number(principal) / Number(term) / 2)} per cutoff`
                : "Enter a principal and term"}
            </span>
            <Button
              size="sm"
              disabled={isPending}
              onClick={() =>
                startTransition(async () => {
                  try {
                    await createLoan({
                      orgId,
                      employeeId,
                      type,
                      principal: Number(principal),
                      termMonths: Number(term),
                      reference: reference || undefined,
                    });
                    toast.success("Loan created");
                    setPrincipal("");
                    setReference("");
                  } catch (error) {
                    toast.error((error as Error).message ?? "Could not create the loan");
                  }
                })
              }
            >
              Add loan
            </Button>
          </div>
        </div>
      </div>

      <Separator />

      <div className="space-y-2">
        <span className="font-medium text-sm">Final pay</span>
        {finalPay === undefined ? (
          <Skeleton className="h-16" />
        ) : finalPay.status === "computed" ? (
          <>
            <p className="text-muted-foreground text-xs">
              Separation {finalPay.separationDate} · {finalPay.yearsOfService} year(s) of service ·
              SIL {finalPay.silDays} day(s)
            </p>
            <div className="rounded-md border">
              <Table>
                <TableBody>
                  {finalPay.lines
                    .filter((line) => line.kind !== "memo")
                    .map((line) => (
                      <TableRow key={`${line.code}-${line.amount}`}>
                        <TableCell className="font-mono text-xs">{line.code}</TableCell>
                        <TableCell className="text-xs">{line.description}</TableCell>
                        <TableCell className="text-right text-xs">
                          {line.kind === "deduction" ? "−" : ""}
                          {peso(line.amount / 100)}
                        </TableCell>
                      </TableRow>
                    ))}
                  <TableRow>
                    <TableCell colSpan={2} className="font-medium text-xs">
                      Net final pay
                    </TableCell>
                    <TableCell className="text-right font-medium text-xs">
                      {peso(finalPay.totals.net)}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
            <Button
              size="sm"
              disabled={isPending || finalPay.alreadyRecorded}
              onClick={() =>
                startTransition(async () => {
                  try {
                    await recordFinalPay({ orgId, employeeId, reason: "separation" });
                    toast.success("Final-pay statement recorded");
                  } catch (error) {
                    toast.error((error as Error).message ?? "Could not record it");
                  }
                })
              }
            >
              {finalPay.alreadyRecorded ? "Already recorded" : "Record statement"}
            </Button>
          </>
        ) : (
          <p className="text-muted-foreground text-xs">
            {"message" in finalPay ? finalPay.message : "Not available."}
          </p>
        )}
      </div>
    </div>
  );
}
