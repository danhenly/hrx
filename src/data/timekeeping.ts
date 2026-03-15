import type { Doc } from "../../convex/_generated/dataModel";

export type TimeEntry = Doc<"timeEntries">;
export type Timesheet = Doc<"timesheets">;

export const TIME_ENTRY_STATUSES = [
    { value: "draft", label: "Draft" },
    { value: "submitted", label: "Submitted" },
    { value: "approved", label: "Approved" },
    { value: "rejected", label: "Rejected" },
] as const;
