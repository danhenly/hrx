"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useMutation } from "convex/react";
import { toast } from "sonner";
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
import { Badge } from "@/components/ui/badge";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import type { Employee } from "@/data/employees";
import type { TimeEntry } from "@/data/timekeeping";

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
    weekEnd: Date;
    onWeekChange: (date: Date) => void;
}

export function ManualEntryGrid({
    orgId,
    employees,
    entries,
    weekStart,
    weekEnd,
    onWeekChange,
}: ManualEntryGridProps) {
    const [rows, setRows] = useState<RowState[]>([]);
    const [isPending, startTransition] = useTransition();

    const upsert = useMutation(api.timeEntries.upsertForDay);
    const submitEntry = useMutation(api.timeEntries.submit);
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
            const unsaved = current.filter((row) => !row.entryId);
            return [...mapped, ...unsaved];
        });
    }, [entries]);

    const weekLabel = useMemo(() => {
        const start = weekStart.toLocaleDateString();
        const end = weekEnd.toLocaleDateString();
        return `${start} – ${end}`;
    }, [weekStart, weekEnd]);

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
        setRows((prev) => prev.map((row) => (row.localId === localId ? updater(row) : row)));
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
                await upsert({
                    orgId,
                    employeeId: row.employeeId as Id<"employees">,
                    date: dateMs,
                    intervals,
                    notes: row.notes || undefined,
                });
                toast.success("Entry saved");
            } catch (err) {
                toast.error((err as Error).message ?? "Failed to save entry");
            }
        });
    }

    function handleSubmit(row: RowState) {
        if (!row.entryId) {
            toast.error("Save the entry before submitting");
            return;
        }
        startTransition(async () => {
            try {
                await submitEntry({ entryId: row.entryId });
                toast.success("Entry submitted");
            } catch (err) {
                toast.error((err as Error).message ?? "Failed to submit entry");
            }
        });
    }

    function handleDelete(row: RowState) {
        if (!row.entryId) {
            removeRow(row.localId);
            return;
        }
        startTransition(async () => {
            try {
                await deleteDraft({ entryId: row.entryId as Id<"timeEntries"> });
                toast.success("Draft deleted");
            } catch (err) {
                toast.error((err as Error).message ?? "Failed to delete entry");
            }
        });
    }

    return (
        <div className="space-y-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-2">
                    <label className="text-sm font-medium text-muted-foreground" htmlFor="weekStart">
                        Week start
                    </label>
                    <Input
                        id="weekStart"
                        type="date"
                        className="w-48"
                        value={formatDateInput(weekStart.getTime())}
                        onChange={(e) => onWeekChange(new Date(e.target.value))}
                    />
                    <span className="text-sm text-muted-foreground">{weekLabel}</span>
                </div>
                <Button variant="secondary" onClick={addRow} disabled={isPending || employees.length === 0}>
                    Add row
                </Button>
            </div>

            <div className="overflow-auto rounded-md border">
                <table className="min-w-full text-sm">
                    <thead className="border-b bg-muted/50 text-left">
                        <tr>
                            <th className="px-3 py-2">Employee</th>
                            <th className="px-3 py-2">Date</th>
                            <th className="px-3 py-2">Time In/Out (up to 3)</th>
                            <th className="px-3 py-2">Notes</th>
                            <th className="px-3 py-2">Status</th>
                            <th className="px-3 py-2 text-right">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((row) => (
                            <tr key={row.localId} className="border-b align-top">
                                <td className="px-3 py-2">
                                    <Select
                                        value={row.employeeId}
                                        onValueChange={(value) =>
                                            updateRow(row.localId, (r) => ({ ...r, employeeId: value }))
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
                                            updateRow(row.localId, (r) => ({ ...r, date: e.target.value }))
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
                                                            next[idx] = { ...next[idx], start: e.target.value };
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
                                            updateRow(row.localId, (r) => ({ ...r, notes: e.target.value }))
                                        }
                                        placeholder="Optional"
                                        className="min-h-[72px]"
                                    />
                                </td>
                                <td className="px-3 py-2">
                                    <div className="flex flex-col gap-1">
                                        <Badge variant="outline">{row.status ?? "draft"}</Badge>
                                        {row.rejectedReason ? (
                                            <span className="text-xs text-destructive">{row.rejectedReason}</span>
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
                                            variant="secondary"
                                            size="sm"
                                            onClick={() => handleSubmit(row)}
                                            disabled={isPending || row.status === "submitted" || row.status === "approved"}
                                        >
                                            Submit
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
                                <td className="px-3 py-6 text-center text-muted-foreground" colSpan={6}>
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

function normalizeIntervals(intervals: TimeEntry["intervals"]): IntervalInput[] {
    const mapped = intervals.map((i) => ({ start: formatTimeInput(i.start), end: formatTimeInput(i.end) }));
    const padded = [...mapped];
    while (padded.length < 3) {
        padded.push({ start: "", end: "" });
    }
    return padded.slice(0, 3);
}

function formatDateInput(ms: number | string) {
    const date = new Date(ms);
    return date.toISOString().slice(0, 10);
}

function formatTimeInput(ms: number) {
    const d = new Date(ms);
    const h = String(d.getHours()).padStart(2, "0");
    const m = String(d.getMinutes()).padStart(2, "0");
    return `${h}:${m}`;
}

function dateInputToMs(value: string) {
    const d = new Date(value + "T00:00:00");
    return d.getTime();
}

function buildIntervals(dateInput: string, intervals: IntervalInput[]) {
    const dateMs = dateInputToMs(dateInput);
    const dayMs = 24 * 60 * 60 * 1000;

    return intervals
        .filter((i) => i.start && i.end)
        .map((interval, idx, arr) => {
            const start = timeStringToMs(dateMs, interval.start);
            let end = timeStringToMs(dateMs, interval.end);
            if (end <= start) end += dayMs; // cross-midnight counts on start date
            return { start, end };
        });
}

function timeStringToMs(baseDateMs: number, time: string) {
    const [hours, minutes] = time.split(":").map((x) => Number.parseInt(x, 10));
    const date = new Date(baseDateMs);
    date.setHours(hours, minutes, 0, 0);
    return date.getTime();
}
