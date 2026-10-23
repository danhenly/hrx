// Client mirror. Imported by components so the browser uses the *same* arithmetic
// as the server instead of startOfWeek() in whatever timezone the laptop is in.
export {
    DAY_MS,
    PH_OFFSET_MS,
    WEEK_MS,
    isInWeek,
    manilaMidnight,
    weekDays,
    weekStartOf,
} from "../../convex/lib/week";
