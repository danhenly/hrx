"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "convex/react";
import { format } from "date-fns";
import { CalendarIcon, Plus, Trash2 } from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import type { EmployeePosition } from "@/data/employees";
import {
  allowanceTotalOf,
  annualSalaryFor,
  DAILY_RATE_BASES,
  PAY_TYPES,
  type PayTerms,
  rateDerivation,
  rateLabel,
  WORK_WEEKS,
} from "@/lib/payroll";
import { cn } from "@/lib/utils";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

const addPositionSchema = z.object({
  positionId: z.string().min(1, "Position is required"),
  payType: z.enum(["monthly", "daily", "hourly"]),
  // Required on a new position: pay terms are the point of this form now, and a
  // row without a rate is a row payroll cannot compute.
  rate: z.coerce.number().positive("Enter the rate this person is paid"),
  dailyRateBasis: z.enum(["261", "313", "22", "26"]),
  workWeek: z.enum(["5_day", "6_day"]),
  effectiveDate: z.date({ required_error: "Effective date is required" }),
  notes: z.string().optional(),
});

type AddPositionValues = z.infer<typeof addPositionSchema>;

/** One allowance line while it is being edited (amounts are pesos). */
type AllowanceDraft = {
  code: string;
  description: string;
  amount: string;
  taxable: boolean;
};

const EMPTY_ALLOWANCE: AllowanceDraft = {
  code: "RICE",
  description: "Rice subsidy",
  amount: "",
  taxable: false,
};

interface FormPositionHistoryProps {
  employeeId: Id<"employees">;
  positions: EmployeePosition[];
  isAdmin: boolean;
  orgId: Id<"organizations"> | undefined;
}

const peso = (value: number) =>
  new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    maximumFractionDigits: 2,
  }).format(value);

export function FormPositionHistory({
  employeeId,
  positions,
  isAdmin,
  orgId,
}: FormPositionHistoryProps) {
  const addPosition = useMutation(api.employees.addPosition);
  const masterlist = useQuery(
    api.positions.list,
    orgId ? { orgId, includeInactive: true } : "skip",
  );
  const allowanceTypes = useQuery(
    api.payroll.allowanceTypes.list,
    orgId ? { orgId } : "skip",
  );
  const activePositions = (masterlist ?? []).filter((p) => p.isActive);
  const positionById = new Map(
    (masterlist ?? []).map((p) => [p._id as string, p]),
  );
  const removePosition = useMutation(api.employees.removePosition);
  const [isAddPending, startAddTransition] = useTransition();
  const [isDeletePending, startDeleteTransition] = useTransition();
  const [allowances, setAllowances] = useState<AllowanceDraft[]>([]);

  const form = useForm<AddPositionValues>({
    resolver: zodResolver(addPositionSchema),
    defaultValues: {
      positionId: "",
      payType: "monthly",
      // A blank string keeps the field empty rather than showing "0".
      rate: "" as unknown as number,
      dailyRateBasis: "313",
      workWeek: "6_day",
      effectiveDate: new Date(),
      notes: "",
    },
  });

  const payType = form.watch("payType");
  const allowanceTotalPesos = allowances.reduce(
    (sum, allowance) => sum + (Number(allowance.amount) || 0),
    0,
  );

  /**
   * The live derivation (D7): shown before saving, in the same words the payslip
   * footer will use. `rate` is text in the input, so a half-typed value simply
   * shows nothing instead of NaN.
   */
  const preview = useMemo(() => {
    const rate = Number(form.watch("rate"));
    if (!Number.isFinite(rate) || rate <= 0) return null;
    const terms: PayTerms = {
      payType: form.watch("payType"),
      basicRate: rate,
      dailyRateBasis: form.watch("dailyRateBasis"),
      workWeek: form.watch("workWeek"),
      statutoryBasis: "basic",
      allowances: [],
    };
    return {
      derivation: rateDerivation(terms),
      annual: annualSalaryFor(terms),
    };
  }, [form]);

  function handleAdd(values: AddPositionValues) {
    if (isAddPending) return;
    const rows = allowances
      .map((allowance) => ({
        code: allowance.code,
        description: allowance.description.trim(),
        amount: Number(allowance.amount),
        taxable: allowance.taxable,
      }))
      .filter(
        (allowance) =>
          Number.isFinite(allowance.amount) && allowance.amount > 0,
      );
    for (const row of rows) {
      if (row.description.length < 2) {
        toast.error(`Give the ${row.code} allowance a description`);
        return;
      }
    }

    startAddTransition(async () => {
      try {
        await addPosition({
          employeeId,
          positionId: values.positionId as Id<"positions">,
          effectiveDate: values.effectiveDate.getTime(),
          notes: values.notes || undefined,
          payType: values.payType,
          basicRate: Number(values.rate),
          dailyRateBasis: values.dailyRateBasis,
          workWeek: values.workWeek,
          allowances: rows,
          // Stored for display only; the engine recomputes it (D15).
          allowanceTotal: allowanceTotalOf(rows) / 100,
        });
        toast.success("Position added");
        setAllowances([]);
        form.reset({
          positionId: "",
          payType: "monthly",
          rate: "" as unknown as number,
          dailyRateBasis: "313",
          workWeek: "6_day",
          effectiveDate: new Date(),
          notes: "",
        });
      } catch (err) {
        toast.error((err as Error).message ?? "Failed to add position");
      }
    });
  }

  function handleDelete(positionId: Id<"employeePositions">) {
    startDeleteTransition(async () => {
      try {
        await removePosition({ positionId });
        toast.success("Position removed");
      } catch (err) {
        toast.error((err as Error).message ?? "Failed to remove position");
      }
    });
  }

  // Sort descending by effectiveDate so most recent is first
  const sorted = [...positions].sort(
    (a, b) => b.effectiveDate - a.effectiveDate,
  );

  return (
    <div className="space-y-4 px-4 py-4">
      {/* History list */}
      {sorted.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No position history yet.
        </p>
      ) : (
        <div className="space-y-2">
          {sorted.map((pos, idx) => (
            <div
              key={pos._id}
              className="space-y-1 rounded-md border p-3 text-sm"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2 font-medium">
                    <Input
                      readOnly
                      value={pos.jobTitle}
                      aria-label="Job title (recorded)"
                      className="h-8 w-auto cursor-default border-transparent bg-muted/40 px-2 text-muted-foreground"
                    />
                    {idx === 0 && !pos.endDate && (
                      <Badge variant="default" className="h-5 text-xs">
                        Current
                      </Badge>
                    )}
                    {pos.positionId &&
                      positionById.get(pos.positionId)?.isActive === false && (
                        <Badge variant="secondary" className="h-5 text-xs">
                          Inactive
                        </Badge>
                      )}
                  </div>
                  {pos.department && (
                    <div className="text-muted-foreground">
                      {pos.department}
                    </div>
                  )}
                  <div className="text-muted-foreground text-xs">
                    {format(new Date(pos.effectiveDate), "MMM d, yyyy")}
                    {pos.endDate
                      ? ` → ${format(new Date(pos.endDate), "MMM d, yyyy")}`
                      : " → Present"}
                  </div>
                  {/* Pay terms (D15). A row from before P0 has none, which is why
                      every line here is conditional. */}
                  {pos.payType && pos.basicRate !== undefined && (
                    <div className="text-muted-foreground text-xs">
                      {pos.payType === "monthly"
                        ? `${peso(pos.basicRate)}/month`
                        : pos.payType === "daily"
                          ? `${peso(pos.basicRate)}/day`
                          : `${peso(pos.basicRate)}/hour`}
                      {pos.dailyRateBasis
                        ? ` · basis ${pos.dailyRateBasis}`
                        : ""}
                      {pos.workWeek === "6_day"
                        ? " · 6-day week"
                        : pos.workWeek === "5_day"
                          ? " · 5-day week"
                          : ""}
                    </div>
                  )}
                  {pos.allowances && pos.allowances.length > 0 && (
                    <div className="text-muted-foreground text-xs">
                      Allowances ({pos.allowances.length}):{" "}
                      {peso(
                        pos.allowanceTotal ??
                          allowanceTotalOf(pos.allowances) / 100,
                      )}
                      {pos.allowances
                        .map((allowance) => allowance.code)
                        .join(", ")
                        .replace(/^/, " · ")}
                    </div>
                  )}
                  {pos.salary !== undefined && (
                    <div className="text-muted-foreground text-xs">
                      Contractual annual: {peso(pos.salary)}
                    </div>
                  )}
                  {pos.notes && (
                    <div className="text-muted-foreground text-xs italic">
                      {pos.notes}
                    </div>
                  )}
                </div>
                {isAdmin && (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 shrink-0 text-destructive hover:text-destructive"
                    onClick={() =>
                      handleDelete(pos._id as Id<"employeePositions">)
                    }
                    disabled={isDeletePending}
                    aria-label="Remove position"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <Separator />

      {/* Add new position */}
      <Collapsible>
        <CollapsibleTrigger asChild>
          <Button variant="outline" size="sm" className="gap-2">
            <Plus className="h-4 w-4" />
            Add position
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-3">
          <Form {...form}>
            <form
              onSubmit={form.handleSubmit(handleAdd)}
              className="space-y-3 rounded-md border p-3"
            >
              {activePositions.length === 0 ? (
                <div className="rounded-md border border-dashed p-3 text-muted-foreground text-sm">
                  No active positions yet — add them under{" "}
                  <a className="underline" href="/dashboard/settings/positions">
                    Settings → Positions
                  </a>{" "}
                  first.
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  <FormField
                    control={form.control}
                    name="positionId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Position</FormLabel>
                        <FormControl>
                          <select
                            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none"
                            value={field.value}
                            onChange={field.onChange}
                            aria-label="Position"
                          >
                            <option value="">Select a position…</option>
                            {activePositions.map((pos) => (
                              <option key={pos._id} value={pos._id}>
                                {pos.name}
                                {pos.department ? ` · ${pos.department}` : ""}
                              </option>
                            ))}
                          </select>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormItem>
                    <FormLabel>Department</FormLabel>
                    <FormControl>
                      <Input
                        readOnly
                        value={
                          positionById.get(form.watch("positionId"))
                            ?.department ?? ""
                        }
                        aria-label="Department (from position)"
                        className="cursor-default bg-muted/40 text-muted-foreground"
                      />
                    </FormControl>
                  </FormItem>
                </div>
              )}

              {/* ── Pay terms (D15) ─────────────────────────────────────── */}
              <div className="grid grid-cols-2 gap-3">
                <FormField
                  control={form.control}
                  name="payType"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Pay type</FormLabel>
                      <FormControl>
                        <select
                          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none"
                          value={field.value}
                          onChange={field.onChange}
                          aria-label="Pay type"
                        >
                          {PAY_TYPES.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="rate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{rateLabel(payType)}</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          placeholder="30000"
                          {...field}
                          value={field.value ?? ""}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <FormField
                  control={form.control}
                  name="dailyRateBasis"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Daily-rate basis</FormLabel>
                      <FormControl>
                        <select
                          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none"
                          value={field.value}
                          onChange={field.onChange}
                          aria-label="Daily-rate basis"
                        >
                          {DAILY_RATE_BASES.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="workWeek"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Work week</FormLabel>
                      <FormControl>
                        <select
                          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none"
                          value={field.value}
                          onChange={field.onChange}
                          aria-label="Work week"
                        >
                          {WORK_WEEKS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {preview && (
                <p className="rounded-md bg-muted/50 px-3 py-2 text-muted-foreground text-xs">
                  {preview.derivation} · contractual annual{" "}
                  {peso(preview.annual)}
                </p>
              )}

              {/* ── Allowances (D15) ────────────────────────────────────── */}
              <div className="space-y-2 rounded-md border p-3">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-sm">Allowances</span>
                  <span className="text-sm">
                    Total {peso(allowanceTotalPesos)}
                  </span>
                </div>
                {allowances.length === 0 ? (
                  <p className="text-muted-foreground text-xs">
                    None. Rice, laundry, uniform, medical and transport are
                    catalogue codes — pick one and set the amount.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {allowances.map((allowance, index) => (
                      <div
                        key={`${allowance.code}-${index}`}
                        className="grid grid-cols-[1fr_90px_auto_auto] items-center gap-2"
                      >
                        <div className="space-y-1">
                          <select
                            className="flex h-8 w-full rounded-md border border-input bg-transparent px-2 text-xs"
                            value={allowance.code}
                            aria-label="Allowance code"
                            onChange={(event) => {
                              const selected = (allowanceTypes ?? []).find(
                                (type) => type.code === event.target.value,
                              );
                              setAllowances((rows) =>
                                rows.map((row, rowIndex) =>
                                  rowIndex === index
                                    ? {
                                        ...row,
                                        code: event.target.value,
                                        description:
                                          selected?.description ??
                                          row.description,
                                        taxable: row.taxable,
                                      }
                                    : row,
                                ),
                              );
                            }}
                          >
                            {(allowanceTypes ?? []).map((type) => (
                              <option key={type.code} value={type.code}>
                                {type.code} — {type.description}
                              </option>
                            ))}
                          </select>
                          <Input
                            className="h-8 text-xs"
                            placeholder="Description"
                            value={allowance.description}
                            onChange={(event) =>
                              setAllowances((rows) =>
                                rows.map((row, rowIndex) =>
                                  rowIndex === index
                                    ? {
                                        ...row,
                                        description: event.target.value,
                                      }
                                    : row,
                                ),
                              )
                            }
                          />
                        </div>
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          className="h-8 text-xs"
                          placeholder="0.00"
                          aria-label="Allowance amount"
                          value={allowance.amount}
                          onChange={(event) =>
                            setAllowances((rows) =>
                              rows.map((row, rowIndex) =>
                                rowIndex === index
                                  ? { ...row, amount: event.target.value }
                                  : row,
                              ),
                            )
                          }
                        />
                        <span className="flex items-center gap-1 text-xs">
                          <Checkbox
                            checked={allowance.taxable}
                            onCheckedChange={(checked) =>
                              setAllowances((rows) =>
                                rows.map((row, rowIndex) =>
                                  rowIndex === index
                                    ? { ...row, taxable: checked === true }
                                    : row,
                                ),
                              )
                            }
                            aria-label="Taxable"
                          />
                          Taxable
                        </span>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-destructive hover:text-destructive"
                          aria-label="Remove allowance"
                          onClick={() =>
                            setAllowances((rows) =>
                              rows.filter((_, rowIndex) => rowIndex !== index),
                            )
                          }
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  onClick={() =>
                    setAllowances((rows) => [
                      ...rows,
                      {
                        ...EMPTY_ALLOWANCE,
                        code: allowanceTypes?.[0]?.code ?? EMPTY_ALLOWANCE.code,
                        description:
                          allowanceTypes?.[0]?.description ??
                          EMPTY_ALLOWANCE.description,
                      },
                    ])
                  }
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add allowance
                </Button>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <FormField
                  control={form.control}
                  name="effectiveDate"
                  render={({ field }) => (
                    <FormItem className="flex flex-col">
                      <FormLabel>Effective date</FormLabel>
                      <Popover>
                        <PopoverTrigger asChild>
                          <FormControl>
                            <Button
                              variant="outline"
                              className={cn(
                                "w-full pl-3 text-left font-normal",
                                !field.value && "text-muted-foreground",
                              )}
                            >
                              {field.value
                                ? format(field.value, "PPP")
                                : "Pick a date"}
                              <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                            </Button>
                          </FormControl>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                          <Calendar
                            mode="single"
                            selected={field.value}
                            onSelect={field.onChange}
                            captionLayout="dropdown"
                            fromYear={1950}
                            toYear={new Date().getFullYear() + 1}
                            initialFocus
                          />
                        </PopoverContent>
                      </Popover>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="notes"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Notes</FormLabel>
                      <FormControl>
                        <Textarea
                          placeholder="Promotion, transfer reason, etc."
                          className="resize-none"
                          rows={2}
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormDescription>
                Saving closes the previous position and records these pay terms
                from the effective date (D15).
              </FormDescription>

              <Button
                type="submit"
                size="sm"
                disabled={isAddPending || activePositions.length === 0}
              >
                {isAddPending ? "Saving…" : "Save position"}
              </Button>
            </form>
          </Form>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
