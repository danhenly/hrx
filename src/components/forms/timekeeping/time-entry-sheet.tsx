"use client";

import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ENTRY_STATUS_LABELS, type TimeEntry } from "@/data/timekeeping";
import { formatTimeInput } from "@/lib/date-input";
import { formatDay, formatDuration } from "@/lib/week-display";

interface TimeEntrySheetProps {
  entry: TimeEntry | null;
  employeeName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Lifecycle actions for this day, supplied by the page. */
  footer?: React.ReactNode;
}

/**
 * Read-only detail for one employee-day. The entry already carries its
 * intervals, notes and rejection reason, so this needs no query of its own.
 */
export function TimeEntrySheet({
  entry,
  employeeName,
  open,
  onOpenChange,
  footer,
}: TimeEntrySheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="sm:w-[520px] sm:max-w-[520px]">
        <SheetHeader>
          <SheetTitle>{entry ? formatDay(entry.date) : "Time entry"}</SheetTitle>
          <SheetDescription>
            {entry
              ? `${employeeName} — ${ENTRY_STATUS_LABELS[entry.status]}`
              : "Employee day detail"}
          </SheetDescription>
        </SheetHeader>

        {entry ? (
          <div className="min-h-0 flex-1 space-y-4 overflow-auto px-4">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground text-xs">
                Time in / out
              </span>
              <Badge variant="outline">
                {ENTRY_STATUS_LABELS[entry.status]}
              </Badge>
            </div>

            <ul className="divide-y">
              {entry.intervals.map((interval) => (
                <li
                  key={interval.start}
                  className="flex items-center justify-between gap-3 py-2 text-sm"
                >
                  <span className="tabular-nums">
                    {formatTimeInput(interval.start)} –{" "}
                    {formatTimeInput(interval.end)}
                  </span>
                  <span className="text-muted-foreground tabular-nums">
                    {formatDuration(interval.durationMinutes)}
                  </span>
                </li>
              ))}
            </ul>

            {entry.notes ? (
              <div className="space-y-1">
                <span className="text-muted-foreground text-xs">Notes</span>
                <p className="whitespace-pre-wrap text-sm">{entry.notes}</p>
              </div>
            ) : null}

            {entry.rejectedReason ? (
              <div className="space-y-1">
                <span className="text-destructive text-xs">
                  Rejection reason
                </span>
                <p className="whitespace-pre-wrap text-sm">
                  {entry.rejectedReason}
                </p>
              </div>
            ) : null}
          </div>
        ) : null}

        <SheetFooter className="border-t">
          <div className="flex w-full items-center justify-between gap-3 text-sm">
            <span className="text-muted-foreground">
              Day total{" "}
              <span className="ml-1 font-medium text-foreground tabular-nums">
                {formatDuration(entry?.totalMinutes)}
              </span>
            </span>
            <div className="flex items-center gap-1">{footer}</div>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
