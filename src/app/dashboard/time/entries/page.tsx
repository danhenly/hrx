"use client";

import { useQuery } from "convex/react";
import { ChevronLeft, ChevronRight, Download } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ManualEntryGrid } from "@/components/forms/timekeeping/manual-entry-grid";
import { ModuleBody, ModuleToolbar } from "@/components/layout/module";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { Employee } from "@/data/employees";
import type { TimeEntry } from "@/data/timekeeping";
import { downloadCsv } from "@/lib/csv";
import { formatDateInput } from "@/lib/date-input";
import { timekeepingCsv } from "@/lib/timekeeping-export";
import { WEEK_MS, weekStartOf } from "@/lib/week";
import { formatWeekRange } from "@/lib/week-display";
import { useActiveOrg } from "@/providers/org-provider";
import { api } from "../../../../../convex/_generated/api";

export default function TimeEntriesPage() {
  const { orgId } = useActiveOrg();

  // Canonical Manila week anchor, same arithmetic as the server.
  const [weekStartMs, setWeekStartMs] = useState(() => weekStartOf(Date.now()));

  const weekStart = new Date(weekStartMs);

  const employees = useQuery(api.employees.list, orgId ? { orgId } : "skip") as
    | Employee[]
    | undefined;
  const entries = useQuery(
    api.timeEntries.listByDateRange,
    orgId
      ? { orgId, startDate: weekStartMs, endDate: weekStartMs + WEEK_MS - 1 }
      : "skip",
  ) as TimeEntry[] | undefined;

  // The week grid exports every status: a supervisor downloads the week as it
  // stands, drafts included, to check it before submitting.
  const exportData = useQuery(
    api.timeEntries.exportRows,
    orgId
      ? { orgId, startDate: weekStartMs, endDate: weekStartMs + WEEK_MS - 1 }
      : "skip",
  );

  const isLoading = !orgId || entries === undefined || employees === undefined;

  function handleExport() {
    if (!exportData || exportData.rows.length === 0) {
      toast.error("Nothing to export for this week");
      return;
    }
    downloadCsv(
      `hrx-timekeeping-week-${formatDateInput(weekStartMs)}.csv`,
      timekeepingCsv(exportData.rows),
    );
    if (exportData.truncated) {
      toast.warning(
        `Exported the first ${exportData.rows.length} rows — export a narrower range from Timesheets.`,
      );
      return;
    }
    toast.success(`${exportData.rows.length} rows exported`);
  }

  return (
    <>
      <ModuleToolbar>
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            aria-label="Previous week"
            onClick={() => setWeekStartMs((current) => current - WEEK_MS)}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="min-w-[190px] px-2 font-medium text-sm tabular-nums">
            {formatWeekRange(weekStartMs)}
          </span>
          <Button
            variant="outline"
            size="icon"
            aria-label="Next week"
            onClick={() => setWeekStartMs((current) => current + WEEK_MS)}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setWeekStartMs(weekStartOf(Date.now()))}
          >
            This week
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!exportData || exportData.rows.length === 0}
            onClick={handleExport}
          >
            <Download className="h-4 w-4" />
            Export week
          </Button>
        </div>
        <p className="text-muted-foreground text-xs">
          Draft or resubmit daily entries; approve from Timesheets.
        </p>
      </ModuleToolbar>

      <ModuleBody>
        {isLoading ? (
          <div className="space-y-3 px-(--page-gutter) py-4">
            <Skeleton className="h-6 w-64" />
            <Skeleton className="h-48 w-full" />
          </div>
        ) : (
          <ManualEntryGrid
            orgId={orgId}
            employees={employees}
            entries={entries}
            weekStart={weekStart}
          />
        )}
      </ModuleBody>
    </>
  );
}
