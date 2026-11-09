"use client";

import { useMutation, useQuery } from "convex/react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { DAILY_RATE_BASES, WORK_WEEKS } from "@/lib/payroll";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

/**
 * Org-level payroll conventions (P0.5b).
 *
 * These are defaults, not overrides: a position row that states its own work week
 * or divisor wins (that is what `resolvePayTerms` does), so changing a value here
 * cannot silently re-price an employee whose contract says otherwise.
 */
const STATUTORY_BASES = [
  { value: "basic", label: "Basic pay" },
  { value: "gross", label: "Gross pay" },
  { value: "gross_taxable", label: "Gross taxable" },
] as const;

export function FormPayrollSettings({
  orgId,
  isAdmin,
}: {
  orgId: Id<"organizations">;
  isAdmin: boolean;
}) {
  const data = useQuery(api.payroll.settings.get, { orgId });

  if (data === undefined) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
      </div>
    );
  }

  return (
    <PayrollSettingsForm
      key={orgId}
      orgId={orgId}
      isAdmin={isAdmin}
      settings={data.settings}
      isDefault={data.isDefault}
    />
  );
}

type PayrollSettingsValues = {
  workWeek: "5_day" | "6_day";
  dailyRateBasis: "261" | "313" | "22" | "26";
  statutoryBasis: "basic" | "gross" | "gross_taxable";
  cutoffDays: number[];
  payDays: number[];
};

function PayrollSettingsForm({
  orgId,
  isAdmin,
  settings,
  isDefault,
}: {
  orgId: Id<"organizations">;
  isAdmin: boolean;
  settings: PayrollSettingsValues;
  isDefault: boolean;
}) {
  const save = useMutation(api.payroll.settings.update);
  const [isPending, startTransition] = useTransition();

  // Seeded once on mount from the loaded settings: no effect, no double render,
  // and a background refetch cannot overwrite what the admin is editing.
  const [workWeek, setWorkWeek] = useState<PayrollSettingsValues["workWeek"]>(
    settings.workWeek,
  );
  const [dailyRateBasis, setDailyRateBasis] = useState<
    PayrollSettingsValues["dailyRateBasis"]
  >(settings.dailyRateBasis);
  const [statutoryBasis, setStatutoryBasis] = useState<
    PayrollSettingsValues["statutoryBasis"]
  >(settings.statutoryBasis);
  const [cutoffDays, setCutoffDays] = useState<[string, string]>([
    String(settings.cutoffDays[0] ?? 10),
    String(settings.cutoffDays[1] ?? 25),
  ]);
  const [payDays, setPayDays] = useState<[string, string]>([
    String(settings.payDays[0] ?? 15),
    String(settings.payDays[1] ?? 30),
  ]);

  function handleSave() {
    startTransition(async () => {
      try {
        await save({
          orgId,
          workWeek,
          dailyRateBasis,
          statutoryBasis,
          cutoffDays: [Number(cutoffDays[0]), Number(cutoffDays[1])],
          payDays: [Number(payDays[0]), Number(payDays[1])],
        });
        toast.success("Payroll defaults saved");
      } catch (err) {
        toast.error((err as Error).message ?? "Failed to save");
      }
    });
  }

  return (
    <div className="space-y-4">
      {isDefault && (
        <p className="rounded-md border border-dashed p-3 text-muted-foreground text-sm">
          This org has never saved payroll conventions — the pilot defaults
          (6-day week, basis 313, cutoffs 10/25 paid 15/30) are shown.
        </p>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="workWeek">Work week</Label>
          <select
            id="workWeek"
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none"
            value={workWeek}
            onChange={(event) =>
              setWorkWeek(event.target.value as "5_day" | "6_day")
            }
            disabled={!isAdmin}
          >
            {WORK_WEEKS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="dailyRateBasis">Default daily-rate basis</Label>
          <select
            id="dailyRateBasis"
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none"
            value={dailyRateBasis}
            onChange={(event) =>
              setDailyRateBasis(event.target.value as typeof dailyRateBasis)
            }
            disabled={!isAdmin}
          >
            {DAILY_RATE_BASES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="statutoryBasis">Statutory contribution basis</Label>
          <select
            id="statutoryBasis"
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none"
            value={statutoryBasis}
            onChange={(event) =>
              setStatutoryBasis(event.target.value as typeof statutoryBasis)
            }
            disabled={!isAdmin}
          >
            {STATUTORY_BASES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <p className="text-muted-foreground text-xs">
            The pilot uses basic pay. Printed on every payslip so the employee
            can reconcile it.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label>Cutoff days / pay days</Label>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              min="1"
              max="31"
              aria-label="First cutoff day"
              value={cutoffDays[0]}
              disabled={!isAdmin}
              onChange={(event) =>
                setCutoffDays([event.target.value, cutoffDays[1]])
              }
            />
            <Input
              type="number"
              min="1"
              max="31"
              aria-label="Second cutoff day"
              value={cutoffDays[1]}
              disabled={!isAdmin}
              onChange={(event) =>
                setCutoffDays([cutoffDays[0], event.target.value])
              }
            />
            <span className="text-muted-foreground text-sm">paid</span>
            <Input
              type="number"
              min="1"
              max="31"
              aria-label="First pay day"
              value={payDays[0]}
              disabled={!isAdmin}
              onChange={(event) => setPayDays([event.target.value, payDays[1]])}
            />
            <Input
              type="number"
              min="1"
              max="31"
              aria-label="Second pay day"
              value={payDays[1]}
              disabled={!isAdmin}
              onChange={(event) => setPayDays([payDays[0], event.target.value])}
            />
          </div>
        </div>
      </div>

      <Button size="sm" onClick={handleSave} disabled={!isAdmin || isPending}>
        {isPending ? "Saving…" : "Save defaults"}
      </Button>
    </div>
  );
}
