"use client";

import { useMutation, useQuery } from "convex/react";
import { Plus } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
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
 * The register (P3.3). Actions mirror the server guards exactly — the buttons avoid
 * offering what the server would refuse, they never replace the check:
 * `hr` may compute and review, only `admin` approves (D12), and an approved run is
 * frozen (D2).
 */

const manilaDate = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Manila",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const peso = (value: number) =>
  value.toLocaleString("en-PH", {
    style: "currency",
    currency: "PHP",
    minimumFractionDigits: 2,
  });

const STATUS_VARIANT: Record<
  string,
  "default" | "secondary" | "outline" | "destructive"
> = {
  draft: "outline",
  computed: "secondary",
  reviewed: "secondary",
  approved: "default",
  paid: "default",
  void: "destructive",
};

export function PayrollRegister({ orgId }: { orgId: Id<"organizations"> }) {
  const periods = useQuery(api.payroll.periods.list, { orgId });
  const me = useQuery(api.users.getMe, { orgId });
  const isAdmin = me?.membership?.role === "admin";

  const createPeriod = useMutation(api.payroll.periods.createPeriod);
  const createRun = useMutation(api.payroll.runs.createRun);
  const computeRun = useMutation(api.payroll.runs.computeRun);
  const reviewRun = useMutation(api.payroll.runs.reviewRun);
  const approveRun = useMutation(api.payroll.runs.approveRun);
  const voidRun = useMutation(api.payroll.runs.voidRun);
  const generateBankFile = useMutation(api.payroll.payout.generateBankFile);
  const generateRunPack = useMutation(api.payroll.payout.generateRunPack);
  const mintLink = useMutation(api.payroll.payslipLinks.mint);

  const [isPending, startTransition] = useTransition();
  const [addOpen, setAddOpen] = useState(false);
  const [start, setStart] = useState("2026-11-10");
  const [end, setEnd] = useState("2026-11-24");
  const [pay, setPay] = useState("2026-11-30");
  const [openRunId, setOpenRunId] = useState<Id<"payrollRuns"> | null>(null);
  const [openPayslipId, setOpenPayslipId] = useState<Id<"payslips"> | null>(
    null,
  );

  const runDetail = useQuery(
    api.payroll.runs.get,
    openRunId ? { runId: openRunId } : "skip",
  );
  const payslipDetail = useQuery(
    api.payroll.runs.getPayslip,
    openPayslipId ? { payslipId: openPayslipId } : "skip",
  );

  /** Save a generated artefact to the browser's downloads. */
  function download(filename: string, content: string) {
    const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function act(label: string, fn: () => Promise<unknown>) {
    startTransition(async () => {
      try {
        await fn();
        toast.success(label);
      } catch (error) {
        toast.error((error as Error).message ?? "That action failed");
      }
    });
  }

  /** Compute in chunks until the run reports done — a run is resumable by design. */
  function compute(runId: Id<"payrollRuns">) {
    startTransition(async () => {
      try {
        for (let attempt = 0; attempt < 60; attempt += 1) {
          const result = await computeRun({ orgId, runId, chunkSize: 25 });
          if (result.done) {
            toast.success(
              `Computed ${result.employeeCount} payslip(s)` +
                (result.blocked > 0 ? `, ${result.blocked} blocked` : ""),
            );
            return;
          }
        }
        toast.error("Still computing — reopen the run to continue");
      } catch (error) {
        toast.error((error as Error).message ?? "Compute failed");
      }
    });
  }

  if (periods === undefined) {
    return <Skeleton className="h-40 w-full" />;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end">
        <Button
          size="sm"
          className="gap-2"
          onClick={() => setAddOpen(true)}
          disabled={!isAdmin}
        >
          <Plus className="h-4 w-4" />
          Add period
        </Button>
      </div>

      {periods.length === 0 ? (
        <div className="rounded-md border border-dashed p-6 text-sm">
          <p className="font-medium">No payroll periods yet.</p>
          <p className="text-muted-foreground">
            Add the first one — the pilot's confirmed boundary is 2026-11-10 →
            2026-11-24, paid 2026-11-30.
          </p>
        </div>
      ) : (
        <div className="divide-y rounded-md border">
          {periods.map((period) => (
            <div key={period._id} className="space-y-2 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="space-y-0.5">
                  <div className="font-medium text-sm">
                    {manilaDate.format(new Date(period.startDate))} →{" "}
                    {manilaDate.format(new Date(period.endDate))}
                  </div>
                  <div className="text-muted-foreground text-xs">
                    paid {manilaDate.format(new Date(period.payDate))} ·{" "}
                    {period.status}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-2"
                  disabled={isPending}
                  onClick={() =>
                    act("Run opened", async () => {
                      const result = await createRun({
                        orgId,
                        periodId: period._id,
                      });
                      setOpenRunId(result.runId);
                    })
                  }
                >
                  New run
                </Button>
              </div>

              {period.runs.length === 0 ? (
                <p className="text-muted-foreground text-xs">No run yet.</p>
              ) : (
                <div className="space-y-2">
                  {period.runs.map((run) => (
                    <div
                      key={run._id}
                      className="flex flex-wrap items-center gap-2 rounded-md bg-muted/40 px-3 py-2 text-xs"
                    >
                      <Badge variant={STATUS_VARIANT[run.status] ?? "outline"}>
                        v{run.version} · {run.status}
                      </Badge>
                      <span>
                        {run.totals.employeeCount} payslip(s) · gross{" "}
                        {peso(run.totals.gross)} · net {peso(run.totals.net)}
                        {runDetail && runDetail.thirteenthMonthAccrued > 0 ? (
                            <>
                                {" "}
                                · 13th month accrued {peso(runDetail.thirteenthMonthAccrued)}
                            </>
                        ) : null}
                        {runDetail && runDetail.loanDeductions > 0 ? (
                            <> · loans {peso(runDetail.loanDeductions)}</>
                        ) : null}
                      </span>
                      {run.blocked.length > 0 && (
                        <Badge variant="destructive">
                          {run.blocked.length} blocked
                        </Badge>
                      )}
                      <div className="ml-auto flex flex-wrap gap-1">
                        {(run.status === "draft" ||
                          run.status === "computed") && (
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={isPending}
                            onClick={() => compute(run._id)}
                          >
                            {run.status === "draft" ? "Compute" : "Continue"}
                          </Button>
                        )}
                        {run.status === "computed" && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={isPending}
                            onClick={() =>
                              act("Run reviewed", () =>
                                reviewRun({ runId: run._id }),
                              )
                            }
                          >
                            Review
                          </Button>
                        )}
                        {(run.status === "computed" ||
                          run.status === "reviewed") &&
                          isAdmin && (
                            <Button
                              size="sm"
                              disabled={isPending}
                              onClick={() =>
                                act("Run approved — register frozen", () =>
                                  approveRun({ runId: run._id }),
                                )
                              }
                            >
                              Approve
                            </Button>
                          )}
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setOpenRunId(run._id)}
                        >
                          Payslips
                        </Button>
                        {isAdmin &&
                          run.status !== "void" &&
                          run.status !== "paid" && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-destructive hover:text-destructive"
                              disabled={isPending}
                              onClick={() =>
                                act("Run voided", () =>
                                  voidRun({
                                    runId: run._id,
                                    reason: "Voided from the register",
                                  }),
                                )
                              }
                            >
                              Void
                            </Button>
                          )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Create a period with explicit dates (the one-off override) */}
      <Sheet open={addOpen} onOpenChange={setAddOpen} modal={false}>
        <SheetContent className="w-[420px] overflow-y-auto sm:max-w-[420px]">
          <SheetHeader className="sticky top-0 border-b bg-background pb-4">
            <SheetTitle>Add payroll period</SheetTitle>
            <SheetDescription>
              Three dates, never "the month" — a cutoff, a pay date and a start.
            </SheetDescription>
          </SheetHeader>
          <div className="space-y-3 px-4 py-4">
            {[
              { label: "Start", value: start, set: setStart },
              { label: "End (inclusive)", value: end, set: setEnd },
              { label: "Pay date", value: pay, set: setPay },
            ].map((field) => (
              <div key={field.label} className="space-y-1.5">
                <Label htmlFor={field.label}>{field.label}</Label>
                <Input
                  id={field.label}
                  type="date"
                  value={field.value}
                  onChange={(event) => field.set(event.target.value)}
                />
              </div>
            ))}
            <Button
              size="sm"
              disabled={isPending}
              onClick={() =>
                act("Period created", async () => {
                  await createPeriod({
                    orgId,
                    startDate: start,
                    endDate: end,
                    payDate: pay,
                  });
                  setAddOpen(false);
                })
              }
            >
              Create period
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      {/* Payslips of one run */}
      <Sheet
        open={openRunId !== null}
        onOpenChange={(open) => {
          if (!open) {
            setOpenRunId(null);
            setOpenPayslipId(null);
          }
        }}
        modal={false}
      >
        <SheetContent className="w-[680px] overflow-y-auto sm:max-w-[680px]">
          <SheetHeader className="sticky top-0 border-b bg-background pb-4">
            <SheetTitle>
              {runDetail?.period
                ? `Register ${manilaDate.format(new Date(runDetail.period.startDate))} → ${manilaDate.format(new Date(runDetail.period.endDate))}`
                : "Register"}
            </SheetTitle>
            <SheetDescription>
              {runDetail?.run
                ? `v${runDetail.run.version} · ${runDetail.run.status} · ${runDetail.payslips.length} payslip(s)`
                : "Loading…"}
            </SheetDescription>
          </SheetHeader>

          {runDetail?.run &&
            (runDetail.run.status === "approved" ||
              runDetail.run.status === "paid") && (
              <div className="no-print mx-4 mt-4 flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  disabled={isPending}
                  onClick={() =>
                    startTransition(async () => {
                      try {
                        const file = await generateBankFile({
                          orgId,
                          runId: runDetail.run._id,
                          layoutId: "bdo",
                        });
                        download(file.filename, file.content);
                        toast.success(
                          `${file.filename} — ${file.rowCount} row(s), ${peso(file.total)}`,
                        );
                        if (!file.verified) {
                          toast.warning(
                            "BDO columns are NOT verified against the bank's sample — confirm before the first live payout",
                          );
                        }
                        if (file.missing.length > 0) {
                          toast.error(
                            `${file.missing.length} employee(s) have no bank account and are NOT in the file`,
                          );
                        }
                      } catch (error) {
                        toast.error(
                          (error as Error).message ??
                            "Could not generate the file",
                        );
                      }
                    })
                  }
                >
                  BDO bank file
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={isPending}
                  onClick={() =>
                    startTransition(async () => {
                      try {
                        const file = await generateBankFile({
                          orgId,
                          runId: runDetail.run._id,
                          layoutId: "generic",
                        });
                        download(file.filename, file.content);
                      } catch (error) {
                        toast.error(
                          (error as Error).message ??
                            "Could not generate the file",
                        );
                      }
                    })
                  }
                >
                  Generic file
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={isPending}
                  onClick={() =>
                    startTransition(async () => {
                      try {
                        const pack = await generateRunPack({
                          orgId,
                          runId: runDetail.run._id,
                        });
                        download(pack.filename, pack.content);
                        toast.success("Run pack downloaded");
                      } catch (error) {
                        toast.error(
                          (error as Error).message ??
                            "Could not build the pack",
                        );
                      }
                    })
                  }
                >
                  Run pack
                </Button>
                <Button size="sm" variant="ghost" asChild>
                  <a
                    href={`/payslips/run/${runDetail.run._id}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Print all payslips
                  </a>
                </Button>
              </div>
            )}

          {runDetail?.run.blocked.length ? (
            <div className="mx-4 mt-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs">
              <p className="font-medium">Blocked employees</p>
              {runDetail.run.blocked.map((row) => (
                <p key={row.employeeId} className="text-muted-foreground">
                  {row.employeeId}: {row.reason}
                </p>
              ))}
            </div>
          ) : null}

          {runDetail === undefined ? (
            <div className="space-y-3 p-4">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : (
            <div className="px-4 py-4">
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Employee</TableHead>
                      <TableHead className="text-right">Gross</TableHead>
                      <TableHead className="text-right">Deductions</TableHead>
                      <TableHead className="text-right">Net</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {runDetail.payslips.map((payslip) => (
                      <TableRow key={payslip._id}>
                        <TableCell className="text-xs">
                          {payslip.employeeName}
                        </TableCell>
                        <TableCell className="text-right text-xs">
                          {peso(payslip.gross)}
                        </TableCell>
                        <TableCell className="text-right text-xs">
                          {peso(payslip.totalDeductions)}
                        </TableCell>
                        <TableCell className="text-right text-xs">
                          {peso(payslip.net)}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="no-print flex justify-end gap-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setOpenPayslipId(payslip._id)}
                            >
                              Lines
                            </Button>
                            <Button size="sm" variant="ghost" asChild>
                              <a
                                href={`/payslips/${payslip._id}`}
                                target="_blank"
                                rel="noreferrer"
                              >
                                Print
                              </a>
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={isPending}
                              onClick={() =>
                                startTransition(async () => {
                                  try {
                                    const link = await mintLink({
                                      orgId,
                                      payslipId: payslip._id,
                                    });
                                    const url = `${window.location.origin}/payslip/${link.token}`;
                                    await navigator.clipboard.writeText(url);
                                    toast.success(
                                      "Portal link copied (valid 30 days)",
                                    );
                                  } catch (error) {
                                    toast.error(
                                      (error as Error).message ??
                                        "Could not create the link",
                                    );
                                  }
                                })
                              }
                            >
                              Portal link
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {payslipDetail && (
                <div className="mt-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-sm">Payslip lines</span>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setOpenPayslipId(null)}
                    >
                      Close
                    </Button>
                  </div>
                  <div className="rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Code</TableHead>
                          <TableHead>Description</TableHead>
                          <TableHead className="text-right">Amount</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {payslipDetail.lines.map((line) => (
                          <TableRow key={line._id}>
                            <TableCell className="font-mono text-xs">
                              {line.code}
                            </TableCell>
                            <TableCell className="text-xs">
                              {line.description}
                              {line.kind === "employer_cost" ? (
                                <span className="text-muted-foreground">
                                  {" "}
                                  (employer cost)
                                </span>
                              ) : null}
                            </TableCell>
                            <TableCell className="text-right text-xs">
                              {line.kind === "memo" ? "—" : peso(line.amount)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
