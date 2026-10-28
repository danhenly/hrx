import { ENTRY_STATUS_LABELS, type TimeEntry } from "@/data/timekeeping";
import { toCsv } from "@/lib/csv";
import { formatDateInput } from "@/lib/date-input";

/** One row of `api.timeEntries.exportRows`. */
export type ExportRow = {
  employeeName: string;
  employeeEmail: string;
  /** Manila-midnight anchor, UTC ms. */
  date: number;
  /** "09:00-12:00; 13:00-18:00", already Manila wall-clock. */
  intervals: string;
  totalMinutes: number;
  totalHours: string;
  status: TimeEntry["status"];
  rejectedReason: string;
  notes: string;
};

/**
 * The payroll column set, defined once: both export buttons (Timesheets range
 * and the week grid) write this shape, so they cannot drift apart.
 */
export function timekeepingCsv(rows: ExportRow[]): string {
  const header = [
    "Employee",
    "Email",
    "Date",
    "Intervals",
    "Hours",
    "Minutes",
    "Status",
    "Rejection reason",
    "Notes",
  ];
  const body = rows.map((row) => [
    row.employeeName,
    row.employeeEmail,
    formatDateInput(row.date),
    row.intervals,
    row.totalHours,
    row.totalMinutes,
    ENTRY_STATUS_LABELS[row.status],
    row.rejectedReason,
    row.notes,
  ]);
  return toCsv([header, ...body]);
}
