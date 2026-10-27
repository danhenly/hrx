import type { Doc } from "../../convex/_generated/dataModel";

export type TimeEntry = Doc<"timeEntries">;

/** Legacy week sheet. No new rows are written; the table still exists. */
export type Timesheet = Doc<"timesheets">;

export const ENTRY_STATUS_LABELS: Record<TimeEntry["status"], string> = {
  draft: "Draft",
  submitted: "Submitted",
  approved: "Approved",
  rejected: "Rejected",
  locked: "Locked",
};

export const TIME_ENTRY_STATUSES = [
  { value: "draft", label: "Draft" },
  { value: "submitted", label: "Submitted" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "locked", label: "Locked" },
] as const;
