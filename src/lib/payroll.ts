// Client mirror of the pure payroll rules. Imported by the position form so the
// rate derivation it shows ("PHP 30,000.00/month × 12 ÷ 313 = …") is the SAME
// code the payslip footer will use (D7) — a second implementation in the UI is
// how a form and a payslip end up disagreeing about someone's daily rate.
export {
  annualSalaryFor,
  allowanceTotalOf,
  rateDerivation,
} from "../../convex/lib/payroll/rates";

import type { PayTerms } from "../../convex/lib/payroll/types";

export type { PayTerms };

/** The four D7 divisors, with the work week each one pairs with. */
export const DAILY_RATE_BASES = [
  { value: "261", label: "261 days — 5-day week" },
  { value: "313", label: "313 days — 6-day week" },
  { value: "22", label: "22 days — per contract" },
  { value: "26", label: "26 days — per contract" },
] as const;

export const PAY_TYPES = [
  { value: "monthly", label: "Monthly" },
  { value: "daily", label: "Daily" },
  { value: "hourly", label: "Hourly" },
] as const;

export const WORK_WEEKS = [
  { value: "5_day", label: "5-day week" },
  { value: "6_day", label: "6-day week" },
] as const;

/** How the rate field is labelled for each pay type. */
export function rateLabel(payType: string): string {
  if (payType === "daily") return "Daily rate (PHP)";
  if (payType === "hourly") return "Hourly rate (PHP)";
  return "Monthly rate (PHP)";
}
