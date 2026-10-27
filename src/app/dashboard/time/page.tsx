"use client";

import { useMutation, useQuery } from "convex/react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { TimesheetsDataTable } from "@/components/data-table/timesheets/data-table";
import { TimesheetSheet } from "@/components/forms/timekeeping/timesheet-sheet";
import {
  ModuleBody,
  ModuleStat,
  ModuleStatFooter,
  ModuleToolbar,
} from "@/components/layout/module";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import type { Employee } from "@/data/employees";
import type { TimeEntry, Timesheet } from "@/data/timekeeping";
import { WEEK_MS, weekStartOf } from "@/lib/week";
import { formatDuration, formatWeekRange } from "@/lib/week-display";
import { useActiveOrg } from "@/providers/org-provider";
import { api } from "../../../../convex/_generated/api";

const STATUS_FILTERS = [
  { value: "all", label: "All statuses" },
  { value: "open", label: "Draft" },
  { value: "submitted", label: "Submitted" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "locked", label: "Locked" },
] as const;

export default function TimePage() {
  const { orgId } = useActiveOrg();

  const [weekStart, setWeekStart] = useState(() => weekStartOf(Date.now()));
  const [status, setStatus] = useState<string>("all");
  const [selected, setSelected] = useState<Timesheet | null>(null);
  const [isPending, startTransition] = useTransition();

  const me = useQuery(api.users.getMe, orgId ? { orgId } : {});
  const isAdmin = me?.membership?.role === "admin";

  const submitWeek = useMutation(api.timesheets.submitForWeek);
  const approveSheet = useMutation(api.timesheets.approve);
  const lockSheet = useMutation(api.timesheets.lock);

  function runAction(action: () => Promise<unknown>, message: string) {
    startTransition(async () => {
      try {
        await action();
        toast.success(message);
      } catch (err) {
        toast.error((err as Error).message ?? "Action failed");
      }
    });
  }

  /**
   * Lifecycle actions live on the row, mirroring the server guards: submit is
   * open to members, approve/lock are admin-only. The buttons never re-implement
   * permission checks -- they only avoid offering what the server would reject.
   */
  function renderActions(sheet: Timesheet) {
    const stop = (event: React.MouseEvent) => event.stopPropagation();

    if (sheet.status === "open" || sheet.status === "rejected") {
      return (
        <Button
          size="sm"
          variant="secondary"
          disabled={isPending}
          onClick={(event) => {
            stop(event);
            if (!orgId) return;
            runAction(
              () =>
                submitWeek({
                  orgId,
                  employeeId: sheet.employeeId,
                  weekStart: sheet.weekStart,
                }),
              "Week submitted",
            );
          }}
        >
          Submit
        </Button>
      );
    }

    if (sheet.status === "submitted" && isAdmin) {
      return (
        <Button
          size="sm"
          disabled={isPending}
          onClick={(event) => {
            stop(event);
            runAction(
              () => approveSheet({ timesheetId: sheet._id }),
              "Week approved",
            );
          }}
        >
          Approve
        </Button>
      );
    }

    if (sheet.status === "approved" && isAdmin) {
      return (
        <Button
          size="sm"
          variant="outline"
          disabled={isPending}
          onClick={(event) => {
            stop(event);
            runAction(
              () => lockSheet({ timesheetId: sheet._id }),
              "Week locked",
            );
          }}
        >
          Lock
        </Button>
      );
    }

    return null;
  }

  const timesheets = useQuery(
    api.timesheets.listForOrg,
    orgId ? { orgId, weekStart } : "skip",
  ) as Timesheet[] | undefined;
  const employees = useQuery(api.employees.list, orgId ? { orgId } : "skip") as
    | Employee[]
    | undefined;
  const weekEntries = useQuery(
    api.timeEntries.listByDateRange,
    orgId
      ? { orgId, startDate: weekStart, endDate: weekStart + WEEK_MS - 1 }
      : "skip",
  ) as TimeEntry[] | undefined;

  const employeesById = useMemo(() => {
    if (!employees) return {};
    return employees.reduce<Record<string, string>>((acc, employee) => {
      acc[employee._id] = `${employee.firstName} ${employee.lastName}`;
      return acc;
    }, {});
  }, [employees]);

  const visible = useMemo(() => {
    if (!timesheets) return [];
    return status === "all"
      ? timesheets
      : timesheets.filter((sheet) => sheet.status === status);
  }, [timesheets, status]);

  const loggedMinutes = useMemo(
    () => weekEntries?.reduce((sum, entry) => sum + entry.totalMinutes, 0),
    [weekEntries],
  );

  const awaiting =
    timesheets?.filter((s) => s.status === "submitted").length ?? 0;
  const approved =
    timesheets?.filter((s) => s.status === "approved").length ?? 0;
  const isLoading =
    !orgId || timesheets === undefined || employees === undefined;

  // Actions mutate the row, so the open sheet must read the refetched document,
  // not the snapshot captured when it was opened.
  const activeSheet =
    timesheets?.find((sheet) => sheet._id === selected?._id) ?? selected;

  return (
    <>
      <ModuleToolbar>
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            aria-label="Previous week"
            onClick={() => setWeekStart((current) => current - WEEK_MS)}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="min-w-[190px] px-2 font-medium text-sm tabular-nums">
            {formatWeekRange(weekStart)}
          </span>
          <Button
            variant="outline"
            size="icon"
            aria-label="Next week"
            onClick={() => setWeekStart((current) => current + WEEK_MS)}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setWeekStart(weekStartOf(Date.now()))}
          >
            This week
          </Button>
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

      <ModuleBody>
        {isLoading ? (
          <div className="space-y-3 px-(--page-gutter) py-4">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-[42px] w-full" />
            <Skeleton className="h-[42px] w-full" />
            <Skeleton className="h-[42px] w-full" />
          </div>
        ) : (
          <TimesheetsDataTable
            timesheets={visible}
            employeesById={employeesById}
            activeId={selected?._id}
            onOpen={setSelected}
            renderActions={renderActions}
          />
        )}
      </ModuleBody>

      <ModuleStatFooter>
        <ModuleStat value={visible.length} label="timesheets in view" />
        <ModuleStat
          value={
            loggedMinutes === undefined ? "—" : formatDuration(loggedMinutes)
          }
          label="logged this week"
        />
        <ModuleStat value={awaiting} label="awaiting approval" />
        <ModuleStat value={approved} label="approved" />
      </ModuleStatFooter>

      {orgId ? (
        <TimesheetSheet
          orgId={orgId}
          timesheet={activeSheet}
          footer={activeSheet ? renderActions(activeSheet) : null}
          open={selected !== null}
          onOpenChange={(open) => {
            if (!open) setSelected(null);
          }}
        />
      ) : null}
    </>
  );
}
