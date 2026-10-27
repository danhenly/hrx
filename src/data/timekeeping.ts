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
