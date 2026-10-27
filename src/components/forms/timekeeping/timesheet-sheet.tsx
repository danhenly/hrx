"use client";

import { useQuery } from "convex/react";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  TIME_ENTRY_STATUSES,
  TIMESHEET_STATUS_LABELS,
  type TimeEntry,
  type Timesheet,
} from "@/data/timekeeping";
import { WEEK_MS, weekDays } from "@/lib/week";
import { formatDay, formatDuration, formatWeekRange } from "@/lib/week-display";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

interface TimesheetSheetProps {
  orgId: Id<"organizations">;
  timesheet: Timesheet | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const ENTRY_LABEL = new Map(
  TIME_ENTRY_STATUSES.map((status) => [status.value, status.label]),
);

/**
 * Read-only detail for one employee-week. The footer is intentionally empty:
 * submit/approve/reject arrive with the lifecycle work (S2), which replaces the
 * mutations behind them, so no control here would survive.
 */
export function TimesheetSheet({
  orgId,
  timesheet,
  open,
  onOpenChange,
}: TimesheetSheetProps) {
  const entries = useQuery(
    api.timeEntries.listByDateRange,
    timesheet
      ? {
          orgId,
          startDate: timesheet.weekStart,
          endDate: timesheet.weekStart + WEEK_MS - 1,
          employeeId: timesheet.employeeId,
        }
      : "skip",
  ) as TimeEntry[] | undefined;

  const byDay = new Map<number, TimeEntry>();
  for (const entry of entries ?? []) byDay.set(entry.date, entry);

  const days = timesheet ? weekDays(timesheet.weekStart) : [];
  const totalMinutes = (entries ?? []).reduce(
    (sum, entry) => sum + entry.totalMinutes,
    0,
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="sm:w-[560px] sm:max-w-[560px]">
        <SheetHeader>
          <SheetTitle>
            {timesheet ? formatWeekRange(timesheet.weekStart) : "Timesheet"}
          </SheetTitle>
          <SheetDescription>
            {timesheet
              ? TIMESHEET_STATUS_LABELS[timesheet.status]
              : "Employee week detail"}
          </SheetDescription>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-auto px-4">
          {entries === undefined ? (
            <p className="py-6 text-muted-foreground text-sm">
              Loading entries…
            </p>
          ) : (
            <ul className="divide-y">
              {days.map((day) => {
                const entry = byDay.get(day);
                return (
                  <li
                    key={day}
                    className="flex items-center justify-between gap-3 py-3"
                  >
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <span className="font-medium text-sm">
                        {formatDay(day)}
                      </span>
                      <span className="text-muted-foreground text-xs">
                        {entry
                          ? `${entry.intervals.length} interval${entry.intervals.length === 1 ? "" : "s"}`
                          : "No entry"}
                      </span>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {entry ? (
                        <Badge variant="outline">
                          {ENTRY_LABEL.get(entry.status) ?? entry.status}
                        </Badge>
                      ) : null}
                      <span className="text-sm tabular-nums">
                        {formatDuration(entry?.totalMinutes)}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <SheetFooter className="border-t">
          <div className="flex w-full items-center justify-between text-sm">
            <span className="text-muted-foreground">Week total</span>
            <span className="font-medium tabular-nums">
              {entries === undefined ? "—" : formatDuration(totalMinutes)}
            </span>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
