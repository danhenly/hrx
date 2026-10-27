"use client";

import type { RowSelectionState } from "@tanstack/react-table";
import { useMutation, useQuery } from "convex/react";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { TimesheetsDataTable } from "@/components/data-table/timesheets/data-table";
import { RejectDialog } from "@/components/forms/timekeeping/reject-dialog";
import { TimeEntrySheet } from "@/components/forms/timekeeping/time-entry-sheet";
import {
  ModuleBody,
  ModuleStat,
  ModuleStatFooter,
  ModuleToolbar,
} from "@/components/layout/module";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import type { Employee } from "@/data/employees";
import type { TimeEntry } from "@/data/timekeeping";
import { dateInputToMs, lastSevenDays } from "@/lib/date-input";
import { formatDuration } from "@/lib/week-display";
import { useActiveOrg } from "@/providers/org-provider";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

const STATUS_FILTERS = [
  { value: "all", label: "All statuses" },
  { value: "draft", label: "Draft" },
  { value: "submitted", label: "Submitted" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "locked", label: "Locked" },
] as const;

type BatchAction = "submit" | "approve" | "reject" | "lock";

/**
 * Which rows an action may touch. This mirrors the server guards so the UI does
 * not offer a click that would be skipped -- it never replaces the guard.
 */
const TARGET_STATUSES: Record<BatchAction, TimeEntry["status"][]> = {
  submit: ["draft", "rejected"],
  approve: ["submitted"],
  reject: ["submitted"],
  lock: ["approved"],
};

const VERBS: Record<BatchAction, string> = {
  submit: "submitted",
  approve: "approved",
  reject: "rejected",
  lock: "locked",
};

const DEFAULT_RANGE = lastSevenDays();

export default function TimePage() {
  const { orgId } = useActiveOrg();

  const [from, setFrom] = useState(DEFAULT_RANGE.from);
  const [to, setTo] = useState(DEFAULT_RANGE.to);
  const [status, setStatus] = useState<string>("all");
  const [selected, setSelected] = useState<TimeEntry | null>(null);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [rejectIds, setRejectIds] = useState<Id<"timeEntries">[] | null>(null);
  const [isPending, startTransition] = useTransition();

  const me = useQuery(api.users.getMe, orgId ? { orgId } : {});
  const isAdmin = me?.membership?.role === "admin";

  const submitDays = useMutation(api.timeEntries.submitDays);
  const approveDays = useMutation(api.timeEntries.approveDays);
  const rejectDays = useMutation(api.timeEntries.rejectDays);
  const lockDays = useMutation(api.timeEntries.lockDays);

  // Range bounds are Manila wall-clock dates; the server normalises them again.
  const fromMs = from ? dateInputToMs(from) : Number.NaN;
  const toMs = to ? dateInputToMs(to) : Number.NaN;
  const rangeValid =
    Number.isFinite(fromMs) && Number.isFinite(toMs) && toMs >= fromMs;

  const entries = useQuery(
    api.timeEntries.listByDateRange,
    orgId && rangeValid ? { orgId, startDate: fromMs, endDate: toMs } : "skip",
  ) as TimeEntry[] | undefined;
  const employees = useQuery(api.employees.list, orgId ? { orgId } : "skip") as
    | Employee[]
    | undefined;

  const employeesById = useMemo(() => {
    if (!employees) return {};
    return employees.reduce<Record<string, string>>((acc, employee) => {
      acc[employee._id] = `${employee.firstName} ${employee.lastName}`;
      return acc;
    }, {});
  }, [employees]);

  const visible = useMemo(() => {
    const rows = entries ?? [];
    const filtered =
      status === "all" ? rows : rows.filter((entry) => entry.status === status);
    return [...filtered].sort(
      (a, b) => b.date - a.date || a.employeeId.localeCompare(b.employeeId),
    );
  }, [entries, status]);

  const selectedEntries = useMemo(
    () => visible.filter((entry) => rowSelection[entry._id]),
    [visible, rowSelection],
  );

  function targetsFor(kind: BatchAction) {
    return selectedEntries.filter((entry) =>
      TARGET_STATUSES[kind].includes(entry.status),
    );
  }

  /**
   * One mutation per action, not one per row: the server applies the eligible
   * rows in a single transaction and reports the rest as skipped.
   */
  function runBatch(
    kind: BatchAction,
    entryIds: Id<"timeEntries">[],
    reason?: string,
  ) {
    if (!orgId || entryIds.length === 0) return;

    startTransition(async () => {
      try {
        const result =
          kind === "submit"
            ? await submitDays({ orgId, entryIds })
            : kind === "approve"
              ? await approveDays({ orgId, entryIds })
              : kind === "reject"
                ? await rejectDays({ orgId, entryIds, reason })
                : await lockDays({ orgId, entryIds });

        if (result.skipped.length === 0) {
          toast.success(`${result.applied} ${VERBS[kind]}`);
        } else {
          toast.error(
            `${result.applied} ${VERBS[kind]}, ${result.skipped.length} skipped — ${result.skipped[0].reason}`,
          );
        }
        setRowSelection({});
      } catch (err) {
        toast.error((err as Error).message ?? "Action failed");
      }
    });
  }

  function renderActions(entry: TimeEntry) {
    const stop = (event: React.MouseEvent) => event.stopPropagation();
    const canSubmit =
      TARGET_STATUSES.submit.includes(entry.status) &&
      (isAdmin || entry.createdBy === me?._id);

    if (canSubmit) {
      return (
        <Button
          size="sm"
          variant="secondary"
          disabled={isPending}
          onClick={(event) => {
            stop(event);
            runBatch("submit", [entry._id]);
          }}
        >
          Submit
        </Button>
      );
    }

    if (isAdmin && entry.status === "submitted") {
      return (
        <>
          <Button
            size="sm"
            disabled={isPending}
            onClick={(event) => {
              stop(event);
              runBatch("approve", [entry._id]);
            }}
          >
            Approve
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={isPending}
            onClick={(event) => {
              stop(event);
              setRejectIds([entry._id]);
            }}
          >
            Reject
          </Button>
        </>
      );
    }

    if (isAdmin && entry.status === "approved") {
      return (
        <Button
          size="sm"
          variant="outline"
          disabled={isPending}
          onClick={(event) => {
            stop(event);
            runBatch("lock", [entry._id]);
          }}
        >
          Lock
        </Button>
      );
    }

    return null;
  }

  const rangeMinutes = useMemo(
    () => entries?.reduce((sum, entry) => sum + entry.totalMinutes, 0),
    [entries],
  );
  const awaiting =
    entries?.filter((entry) => entry.status === "submitted").length ?? 0;
  const approved =
    entries?.filter((entry) => entry.status === "approved").length ?? 0;
  const isLoading =
    rangeValid && (!orgId || entries === undefined || employees === undefined);

  // Actions mutate the row, so the open sheet must read the refetched document,
  // not the snapshot captured when it was opened.
  const activeEntry =
    entries?.find((entry) => entry._id === selected?._id) ?? selected;

  return (
    <>
      <ModuleToolbar>
        <div className="flex flex-wrap items-center gap-2">
          <label
            htmlFor="timesheet-from"
            className="flex items-center gap-1 text-muted-foreground text-xs"
          >
            From
            <Input
              id="timesheet-from"
              type="date"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
              className="w-40"
            />
          </label>
          <label
            htmlFor="timesheet-to"
            className="flex items-center gap-1 text-muted-foreground text-xs"
          >
            To
            <Input
              id="timesheet-to"
              type="date"
              value={to}
              onChange={(event) => setTo(event.target.value)}
              className="w-40"
            />
          </label>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              const range = lastSevenDays();
              setFrom(range.from);
              setTo(range.to);
            }}
          >
            Last 7 days
          </Button>
          {rangeValid ? null : (
            <span className="text-destructive text-xs">
              End date must be on or after the start date
            </span>
          )}
        </div>

        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-[160px]" aria-label="Filter by status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_FILTERS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </ModuleToolbar>

      {selectedEntries.length > 0 ? (
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b bg-muted/40 px-(--page-gutter) py-2">
          <span className="text-muted-foreground text-xs">
            {selectedEntries.length} selected
          </span>
          <div className="flex items-center gap-1">
            {targetsFor("submit").length > 0 ? (
              <Button
                size="sm"
                variant="secondary"
                disabled={isPending}
                onClick={() =>
                  runBatch(
                    "submit",
                    targetsFor("submit").map((entry) => entry._id),
                  )
                }
              >
                Submit {targetsFor("submit").length}
              </Button>
            ) : null}
            {isAdmin && targetsFor("approve").length > 0 ? (
              <Button
                size="sm"
                disabled={isPending}
                onClick={() =>
                  runBatch(
                    "approve",
                    targetsFor("approve").map((entry) => entry._id),
                  )
                }
              >
                Approve {targetsFor("approve").length}
              </Button>
            ) : null}
            {isAdmin && targetsFor("reject").length > 0 ? (
              <Button
                size="sm"
                variant="ghost"
                disabled={isPending}
                onClick={() =>
                  setRejectIds(
                    targetsFor("reject").map((entry) => entry._id),
                  )
                }
              >
                Reject {targetsFor("reject").length}
              </Button>
            ) : null}
            {isAdmin && targetsFor("lock").length > 0 ? (
              <Button
                size="sm"
                variant="outline"
                disabled={isPending}
                onClick={() =>
                  runBatch(
                    "lock",
                    targetsFor("lock").map((entry) => entry._id),
                  )
                }
              >
                Lock {targetsFor("lock").length}
              </Button>
            ) : null}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setRowSelection({})}
            >
              Clear
            </Button>
          </div>
        </div>
      ) : null}

      <ModuleBody>
        {rangeValid ? (
          isLoading ? (
            <div className="space-y-3 px-(--page-gutter) py-4">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-[42px] w-full" />
              <Skeleton className="h-[42px] w-full" />
              <Skeleton className="h-[42px] w-full" />
            </div>
          ) : (
            <TimesheetsDataTable
              entries={visible}
              employeesById={employeesById}
              activeId={selected?._id}
              onOpen={setSelected}
              renderActions={renderActions}
              rowSelection={rowSelection}
              onRowSelectionChange={setRowSelection}
            />
          )
        ) : (
          <p className="px-(--page-gutter) py-8 text-center text-muted-foreground text-sm">
            Fix the date range to load entries.
          </p>
        )}
      </ModuleBody>

      <ModuleStatFooter>
        <ModuleStat value={visible.length} label="entries in view" />
        <ModuleStat
          value={
            rangeMinutes === undefined
              ? "—"
              : formatDuration(rangeMinutes)
          }
          label="logged in range"
        />
        <ModuleStat value={awaiting} label="awaiting approval" />
        <ModuleStat value={approved} label="approved" />
      </ModuleStatFooter>

      {orgId ? (
        <TimeEntrySheet
          entry={activeEntry}
          employeeName={
            activeEntry
              ? (employeesById[activeEntry.employeeId] ?? "Unknown")
              : ""
          }
          open={selected !== null}
          onOpenChange={(open) => {
            if (!open) setSelected(null);
          }}
          footer={activeEntry ? renderActions(activeEntry) : null}
        />
      ) : null}

      <RejectDialog
        open={rejectIds !== null}
        count={rejectIds?.length ?? 0}
        pending={isPending}
        onCancel={() => setRejectIds(null)}
        onConfirm={(reason) => {
          const ids = rejectIds ?? [];
          setRejectIds(null);
          runBatch("reject", ids, reason);
        }}
      />
    </>
  );
}
