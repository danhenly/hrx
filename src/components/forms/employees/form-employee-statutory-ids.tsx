"use client";

import { useMutation, useQuery } from "convex/react";
import { Plus, Trash2 } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

/**
 * "Government & Bank" (D16).
 *
 * These are IDENTITY, not pay terms: they do not change when pay changes, they
 * must not be duplicated per position row, and they are gated separately from
 * salary data (D13). Payroll refuses to compute a payslip with a missing
 * SSS/PhilHealth/Pag-IBIG number, so the section says what is still missing
 * rather than letting the run discover it later.
 *
 * Writes go through `payroll.employeeStatutoryIds.update`, which is audited
 * PII-light (`employee.statutoryIds.update` — never the numbers themselves).
 */

type BankDraft = {
  bank: string;
  accountName: string;
  accountNumber: string;
  accountType: "atm" | "savings" | "current";
};

const EMPTY_BANK: BankDraft = {
  bank: "BDO",
  accountName: "",
  accountNumber: "",
  accountType: "atm",
};

export function FormEmployeeStatutoryIds({
  employeeId,
}: {
  employeeId: Id<"employees">;
}) {
  const data = useQuery(api.payroll.employeeStatutoryIds.get, { employeeId });
  const updateIds = useMutation(api.payroll.employeeStatutoryIds.update);
  const [isPending, startTransition] = useTransition();

  const [sssNumber, setSssNumber] = useState("");
  const [philhealthNumber, setPhilhealthNumber] = useState("");
  const [pagibigNumber, setPagibigNumber] = useState("");
  const [tin, setTin] = useState("");
  const [bank, setBank] = useState<BankDraft>(EMPTY_BANK);
  const [otherIds, setOtherIds] = useState<{ label: string; value: string }[]>(
    [],
  );

  // Hydrate once the query lands, and again if the row changes underneath us.
  useEffect(() => {
    if (!data) return;
    const row = data.row;
    setSssNumber(row?.sssNumber ?? "");
    setPhilhealthNumber(row?.philhealthNumber ?? "");
    setPagibigNumber(row?.pagibigNumber ?? "");
    setTin(row?.tin ?? "");
    setBank(row?.bank ? { ...row.bank } : EMPTY_BANK);
    setOtherIds(row?.otherIds ? row.otherIds.map((entry) => ({ ...entry })) : []);
  }, [data]);

  if (data === undefined) {
    return (
      <div className="space-y-3 px-4 py-4">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  const missing = data.missingForPayroll;
  const hasBank = bank.accountNumber.trim() !== "" || bank.accountName.trim() !== "";

  function handleSave() {
    startTransition(async () => {
      try {
        await updateIds({
          employeeId,
          sssNumber: sssNumber || undefined,
          philhealthNumber: philhealthNumber || undefined,
          pagibigNumber: pagibigNumber || undefined,
          tin: tin || undefined,
          bank: hasBank
            ? {
                bank: bank.bank,
                accountName: bank.accountName,
                accountNumber: bank.accountNumber,
                accountType: bank.accountType,
              }
            : undefined,
          otherIds: otherIds.filter(
            (entry) => entry.label.trim() !== "" && entry.value.trim() !== "",
          ),
        });
        toast.success("Government & bank details saved");
      } catch (err) {
        toast.error((err as Error).message ?? "Failed to save");
      }
    });
  }

  return (
    <div className="space-y-4 px-4 py-4">
      {missing.length > 0 && (
        <div className="space-y-1 rounded-md border border-amber-500/40 bg-amber-500/10 p-3">
          <div className="font-medium text-sm">
            Missing before payroll can compute this payslip
          </div>
          <div className="flex flex-wrap gap-1">
            {missing.map((entry) => (
              <Badge
                key={entry.field}
                variant={entry.required ? "default" : "secondary"}
                className="text-xs"
              >
                {entry.field}
                {entry.required ? "" : " (fallback)"}
              </Badge>
            ))}
          </div>
          {missing
            .filter((entry) => entry.note)
            .map((entry) => (
              <p key={`${entry.field}-note`} className="text-muted-foreground text-xs">
                {entry.note}
              </p>
            ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="sssNumber">SSS number</Label>
          <Input
            id="sssNumber"
            placeholder="34-1234567-8"
            value={sssNumber}
            onChange={(event) => setSssNumber(event.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="philhealthNumber">PhilHealth number</Label>
          <Input
            id="philhealthNumber"
            placeholder="12-345678901-2"
            value={philhealthNumber}
            onChange={(event) => setPhilhealthNumber(event.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pagibigNumber">Pag-IBIG number</Label>
          <Input
            id="pagibigNumber"
            placeholder="1210-1234-5678"
            value={pagibigNumber}
            onChange={(event) => setPagibigNumber(event.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="tin">TIN</Label>
          <Input
            id="tin"
            placeholder="123-456-789-000"
            value={tin}
            onChange={(event) => setTin(event.target.value)}
          />
        </div>
      </div>

      <Separator />

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="font-medium text-sm">ATM / bank account</span>
          <span className="text-muted-foreground text-xs">
            BDO is the pilot's disbursement bank (D-PILOT-7)
          </span>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="bank">Bank</Label>
            <Input
              id="bank"
              placeholder="BDO"
              value={bank.bank}
              onChange={(event) =>
                setBank((current) => ({ ...current, bank: event.target.value }))
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="accountType">Account type</Label>
            <select
              id="accountType"
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none"
              value={bank.accountType}
              onChange={(event) =>
                setBank((current) => ({
                  ...current,
                  accountType: event.target.value as BankDraft["accountType"],
                }))
              }
            >
              <option value="atm">ATM</option>
              <option value="savings">Savings</option>
              <option value="current">Current</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="accountName">Account name</Label>
            <Input
              id="accountName"
              placeholder="DELA CRUZ, JUAN"
              value={bank.accountName}
              onChange={(event) =>
                setBank((current) => ({
                  ...current,
                  accountName: event.target.value,
                }))
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="accountNumber">Account number</Label>
            <Input
              id="accountNumber"
              placeholder="001234567890"
              value={bank.accountNumber}
              onChange={(event) =>
                setBank((current) => ({
                  ...current,
                  accountNumber: event.target.value,
                }))
              }
            />
          </div>
        </div>
      </div>

      <Separator />

      <div className="space-y-2">
        <span className="font-medium text-sm">Other IDs</span>
        <p className="text-muted-foreground text-xs">
          UMID, driver's licence, passport — anything the employer files with an
          agency.
        </p>
        {otherIds.map((entry, index) => (
          <div
            key={`other-${index}`}
            className="grid grid-cols-[1fr_1fr_auto] items-center gap-2"
          >
            <Input
              className="h-8 text-xs"
              placeholder="Label (UMID)"
              value={entry.label}
              aria-label="Other ID label"
              onChange={(event) =>
                setOtherIds((rows) =>
                  rows.map((row, rowIndex) =>
                    rowIndex === index
                      ? { ...row, label: event.target.value }
                      : row,
                  ),
                )
              }
            />
            <Input
              className="h-8 text-xs"
              placeholder="Value"
              value={entry.value}
              aria-label="Other ID value"
              onChange={(event) =>
                setOtherIds((rows) =>
                  rows.map((row, rowIndex) =>
                    rowIndex === index
                      ? { ...row, value: event.target.value }
                      : row,
                  ),
                )
              }
            />
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-7 w-7 text-destructive hover:text-destructive"
              aria-label="Remove other ID"
              onClick={() =>
                setOtherIds((rows) =>
                  rows.filter((_, rowIndex) => rowIndex !== index),
                )
              }
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-2"
          onClick={() => setOtherIds((rows) => [...rows, { label: "", value: "" }])}
        >
          <Plus className="h-3.5 w-3.5" />
          Add ID
        </Button>
      </div>

      <Button type="button" size="sm" onClick={handleSave} disabled={isPending}>
        {isPending ? "Saving…" : "Save details"}
      </Button>
    </div>
  );
}
