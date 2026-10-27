import { DAY_MS, PH_OFFSET_MS, manilaMidnight } from "@/lib/week";

// Manila-pinned date/time helpers shared by the entry grid and the Timesheets
// date filter. Every anchor is a Manila midnight expressed as UTC ms; a UTC+8
// viewer's local midnight happens to look correct, which is why formatting with
// the viewer's zone (or toISOString) shipped a real off-by-one-day bug: a Manila
// Monday 00:00 is Sunday 16:00 UTC.

const DATE_INPUT_FORMAT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Manila",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** "YYYY-MM-DD" for a Manila-midnight UTC ms anchor. */
export function formatDateInput(ms: number): string {
  return DATE_INPUT_FORMAT.format(new Date(ms));
}

/** "YYYY-MM-DD" (a Manila wall-clock date) to Manila midnight in UTC ms. */
export function dateInputToMs(value: string): number {
  const [year, month, day] = value.split("-").map(Number);
  return Date.UTC(year, month - 1, day) - PH_OFFSET_MS;
}

/** "HH:mm" in Manila for a UTC ms instant. */
export function formatTimeInput(ms: number): string {
  const manila = new Date(ms + PH_OFFSET_MS);
  const hours = String(manila.getUTCHours()).padStart(2, "0");
  const minutes = String(manila.getUTCMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

/** The Timesheets filter default: today and the six days before it. */
export function lastSevenDays(todayMs: number = Date.now()) {
  const today = manilaMidnight(todayMs);
  return { from: formatDateInput(today - 6 * DAY_MS), to: formatDateInput(today) };
}
