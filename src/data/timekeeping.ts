import type { Doc } from "../../convex/_generated/dataModel";

export type TimeEntry = Doc<"timeEntries">;
export type Timesheet = Doc<"timesheets">;

export const TIMESHEET_STATUS_LABELS: Record<Timesheet["status"], string> = {
  open: "Draft",
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
