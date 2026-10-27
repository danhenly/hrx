import { DAY_MS } from "@/lib/week";

// Always format in Asia/Manila. Week anchors are UTC ms representing Manila
// midnight, so a locale-default formatter would shift the date by the viewer's
// offset -- the same class of bug as Date#toISOString().
const MANILA = "Asia/Manila";

const shortDay = new Intl.DateTimeFormat("en-PH", {
  timeZone: MANILA,
  month: "short",
  day: "numeric",
});

const weekdayDay = new Intl.DateTimeFormat("en-PH", {
  timeZone: MANILA,
  weekday: "short",
  month: "short",
  day: "numeric",
});

const yearOnly = new Intl.DateTimeFormat("en-PH", {
  timeZone: MANILA,
  year: "numeric",
});

/** "Jan 5 - Jan 11, 2026" for a Manila Monday-00:00 week anchor. */
export function formatWeekRange(weekStart: number): string {
  const start = shortDay.format(new Date(weekStart));
  const end = shortDay.format(new Date(weekStart + 6 * DAY_MS));
  return `${start} - ${end}, ${yearOnly.format(new Date(weekStart))}`;
}

/** "Mon, Jan 5" for a Manila-midnight day anchor. */
export function formatDay(dateMs: number): string {
  return weekdayDay.format(new Date(dateMs));
}

/** "7h 30m"; undefined renders as "0h 0m" like the previous inline helper. */
export function formatDuration(minutes: number | undefined): string {
  const total = minutes ?? 0;
  return `${Math.floor(total / 60)}h ${total % 60}m`;
}
