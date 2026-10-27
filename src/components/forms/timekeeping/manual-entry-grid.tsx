"use client";

import { useMutation } from "convex/react";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { Employee } from "@/data/employees";
import type { TimeEntry } from "@/data/timekeeping";
import { dateInputToMs, formatDateInput, formatTimeInput } from "@/lib/date-input";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

const EMPTY_INTERVALS: IntervalInput[] = [
  { start: "", end: "" },
  { start: "", end: "" },
  { start: "", end: "" },
];

interface IntervalInput {
  start: string;
  end: string;
}

interface RowState {
  localId: string;
  entryId?: Id<"timeEntries">;
  employeeId: string;
  date: string; // yyyy-MM-dd
  intervals: IntervalInput[];
  notes: string;
  status?: TimeEntry["status"];
  rejectedReason?: string;
}

interface ManualEntryGridProps {
  orgId: Id<"organizations">;
  employees: Employee[];
  entries: TimeEntry[];
  weekStart: Date;
}

export function ManualEntryGrid({
  orgId,
  employees,
  entries,
  weekStart,
}: ManualEntryGridProps) {
  const [rows, setRows] = useState<RowState[]>([]);
  const [isPending, startTransition] = useTransition();

  const upsert = useMutation(api.timeEntries.upsertForDay);
  const deleteDraft = useMutation(api.timeEntries.deleteDraft);

  // Keep UI rows in sync with server entries for the selected week.
  useEffect(() => {
    const mapped = entries.map((entry) => ({
      localId: entry._id,
      entryId: entry._id as Id<"timeEntries">,
      employeeId: entry.employeeId as string,
      date: formatDateInput(entry.date),
      intervals: normalizeIntervals(entry.intervals),
      notes: entry.notes ?? "",
      status: entry.status,
      rejectedReason: entry.rejectedReason,
    }));
    setRows((current) => {
      // A local row is only worth keeping while the server has no row for
      // the same employee+day. Comparing on that key (not on entryId alone)
      // is what stops a just-saved row from appearing twice: the save path
      // has no id until the query comes back.
      const serverKeys = new Set(
        mapped.map((row) => `${row.employeeId}|${row.date}`),
      );
      const unsaved = current.filter(
        (row) =>
          !row.entryId && !serverKeys.has(`${row.employeeId}|${row.date}`),
      );
      return [...mapped, ...unsaved];
    });
  }, [entries]);

  function addRow() {
    const defaultEmployee = employees[0]?._id ?? "";
    const newRow: RowState = {
      localId: crypto.randomUUID(),
      employeeId: defaultEmployee,
      date: formatDateInput(weekStart.getTime()),
      intervals: [...EMPTY_INTERVALS],
      notes: "",
    };
    setRows((prev) => [newRow, ...prev]);
  }

  function updateRow(localId: string, updater: (row: RowState) => RowState) {
    setRows((prev) =>
      prev.map((row) => (row.localId === localId ? updater(row) : row)),
    );
  }

  function removeRow(localId: string) {
    setRows((prev) => prev.filter((row) => row.localId !== localId));
  }

  function handleSave(row: RowState) {
    if (!row.employeeId) {
      toast.error("Select an employee");
      return;
    }
    if (!row.date) {
      toast.error("Select a date");
      return;
    }

    const intervals = buildIntervals(row.date, row.intervals);
    if (intervals.length === 0) {
      toast.error("Add at least one time in/out pair");
      return;
    }

    const dateMs = dateInputToMs(row.date);

    startTransition(async () => {
      try {
        const entryId = await upsert({
          orgId,
          employeeId: row.employeeId as Id<"employees">,
          date: dateMs,
          intervals,
          notes: row.notes || undefined,
        });
        // Adopt the server id immediately so this row stops counting as
        // "unsaved" -- otherwise the refetch adds a second copy of it.
        updateRow(row.localId, (current) => ({
          ...current,
          entryId,
          status: current.status ?? "draft",
        }));
        toast.success("Entry saved");
      } catch (err) {
        toast.error((err as Error).message ?? "Failed to save entry");
      }
    });
  }

  function handleDelete(row: RowState) {
    if (!row.entryId) {
      removeRow(row.localId);
      return;
    }
    const entryId = row.entryId;
    startTransition(async () => {
      try {
        await deleteDraft({ entryId });
        toast.success("Draft deleted");
      } catch (err) {
        toast.error((err as Error).message ?? "Failed to delete entry");
      }
    });
  }

  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex items-center justify-between gap-3 px-(--page-gutter) py-3">
        <p className="text-muted-foreground text-xs">
          Up to three intervals per day. A shift crossing midnight counts on its
          start date.
        </p>
        <Button
          variant="secondary"
          onClick={addRow}
          disabled={isPending || employees.length === 0}
        >
          Add row
        </Button>
      </div>

      <div className="border-t">
        <table className="min-w-full text-sm">
          <thead className="sticky top-0 z-10 border-b bg-background text-left">
            <tr>
              <th className="caption-style h-(--row-head-height) px-3 font-normal text-muted-foreground">
                Employee
              </th>
              <th className="caption-style h-(--row-head-height) px-3 font-normal text-muted-foreground">
                Date
              </th>
              <th className="caption-style h-(--row-head-height) px-3 font-normal text-muted-foreground">
                Time In/Out (up to 3)
              </th>
              <th className="caption-style h-(--row-head-height) px-3 font-normal text-muted-foreground">
                Notes
              </th>
              <th className="caption-style h-(--row-head-height) px-3 font-normal text-muted-foreground">
                Status
              </th>
              <th className="caption-style h-(--row-head-height) px-3 text-right font-normal text-muted-foreground">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.localId} className="border-b align-top">
                <td className="px-3 py-2">
                  <Select
                    value={row.employeeId}
                    onValueChange={(value) =>
                      updateRow(row.localId, (r) => ({
                        ...r,
                        employeeId: value,
                      }))
                    }
                  >
                    <SelectTrigger className="w-48">
                      <SelectValue placeholder="Select" />
                    </SelectTrigger>
                    <SelectContent>
                      {employees.map((emp) => (
                        <SelectItem key={emp._id} value={emp._id}>
                          {emp.firstName} {emp.lastName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </td>
                <td className="px-3 py-2">
                  <Input
                    type="date"
                    value={row.date}
                    onChange={(e) =>
                      updateRow(row.localId, (r) => ({
                        ...r,
                        date: e.target.value,
                      }))
                    }
                    className="w-40"
                  />
                </td>
                <td className="px-3 py-2">
                  <div className="flex flex-col gap-2">
                    {row.intervals.map((interval, idx) => (
                      <div key={idx} className="flex items-center gap-2">
                        <Input
                          type="time"
                          value={interval.start}
                          onChange={(e) =>
                            updateRow(row.localId, (r) => {
                              const next = [...r.intervals];
                              next[idx] = {
                                ...next[idx],
                                start: e.target.value,
                              };
                              return { ...r, intervals: next };
                            })
                          }
                          className="w-28"
                        />
                        <span className="text-muted-foreground">to</span>
                        <Input
                          type="time"
                          value={interval.end}
                          onChange={(e) =>
                            updateRow(row.localId, (r) => {
                              const next = [...r.intervals];
                              next[idx] = { ...next[idx], end: e.target.value };
                              return { ...r, intervals: next };
                            })
                          }
                          className="w-28"
                        />
                      </div>
                    ))}
                  </div>
                </td>
                <td className="px-3 py-2">
                  <Textarea
                    value={row.notes}
                    onChange={(e) =>
                      updateRow(row.localId, (r) => ({
                        ...r,
                        notes: e.target.value,
                      }))
                    }
                    placeholder="Optional"
                    className="min-h-[72px]"
                  />
                </td>
                <td className="px-3 py-2">
                  <div className="flex flex-col gap-1">
                    <Badge variant="outline">{row.status ?? "draft"}</Badge>
                    {row.rejectedReason ? (
                      <span className="text-destructive text-xs">
                        {row.rejectedReason}
                      </span>
                    ) : null}
                  </div>
                </td>
                <td className="px-3 py-2 text-right">
                  <div className="flex justify-end gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleSave(row)}
                      disabled={isPending}
                    >
                      Save
                    </Button>

                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDelete(row)}
                      disabled={isPending || (!row.entryId && !row.employeeId)}
                    >
                      Remove
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td
                  className="px-3 py-6 text-center text-muted-foreground"
                  colSpan={6}
                >
                  No entries for this week. Add a row to start.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function normalizeIntervals(
  intervals: TimeEntry["intervals"],
): IntervalInput[] {
  const mapped = intervals.map((i) => ({
    start: formatTimeInput(i.start),
    end: formatTimeInput(i.end),
  }));
  const padded = [...mapped];
  while (padded.length < 3) {
    padded.push({ start: "", end: "" });
  }
  return padded.slice(0, 3);
}

// Date and time formatting live in @/lib/date-input so the entry grid and the
// Timesheets date filter share one Manila-pinned implementation.

function buildIntervals(dateInput: string, intervals: IntervalInput[]) {
  const dateMs = dateInputToMs(dateInput);
  const dayMs = 24 * 60 * 60 * 1000;

  return intervals
    .filter((i) => i.start && i.end)
    .map((interval, _idx, _arr) => {
      const start = timeStringToMs(dateMs, interval.start);
      let end = timeStringToMs(dateMs, interval.end);
      if (end <= start) end += dayMs; // cross-midnight counts on start date
      return { start, end };
    });
}

function timeStringToMs(baseDateMs: number, time: string) {
  const [hours, minutes] = time.split(":").map((x) => Number.parseInt(x, 10));
  // baseDateMs is already Manila midnight, so offsets are plain arithmetic --
  // no Date#setHours, which would re-interpret the wall clock in the viewer's zone.
  return baseDateMs + hours * 60 * 60 * 1000 + minutes * 60 * 1000;
}
