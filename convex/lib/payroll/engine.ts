// The payroll engine (§6.1, §6.2).
//
// P1 computes EARNINGS: basic pay for the period, the day-by-day prices (holiday,
// rest day, OT, night differential), allowances with the de minimis split, and
// adjustments. Statutory contributions, withholding tax, loans and 13th month are
// P2/P5 and are NOT here.
//
// Because the deductions do not exist yet, every result is BLOCKED with
// `STATUTORY_PENDING`: the preview can show earnings, but nothing may persist a
// payslip whose net pay is missing every statutory deduction. That flag is what
// keeps a P1 preview from becoming a P1 payroll run.
//
// Pure: no ctx, no DB, no generated types — exercises under plain node.
import { ConvexError } from "convex/values";
import {
    classifyDay,
    dateKeyOf,
    DAY_MS,
    eachDay,
    isRestDay,
    workDaysInRange,
} from "./calendar";
import { isInMonthlyRate, NORMAL_MINUTES_PER_DAY, priceDay } from "./premiums";
import {
    pagibigContributions,
    philhealthContributions,
    splitMonthlyAcrossCutoffs,
    sssContributions,
    type PagibigTable,
    type PhilhealthTable,
    type SssTable,
} from "./statutory";
import { withholdingCentavos, type Bracket } from "./tax";
import { planLoanPayments, type LoanState } from "./loans";
import { accrualForPeriod, payoutSplit } from "./thirteenth";
import {
    allowanceTotalOf,
    dailyRateCentavos,
    hourlyRateCentavos,
    NORMAL_HOURS_PER_DAY,
    periodBasicPay,
    rateDerivation,
    roundHalfUp,
    toCentavos,
} from "./rates";
import type {
    Adjustment,
    Allowance,
    DeminimisTable,
    DayRecord,
    HolidayRule,
    Money,
    PayProfile,
    PayResult,
    PayslipLine,
} from "./types";

/** Bumped when the engine's behaviour changes; recorded per run in P3. */
export const ENGINE_STAGE = "P5-13th-finalpay-loans";

/** What is still missing before a payslip may be persisted (P5: loans, 13th month). */


/** A semi-monthly period is half a month — the conversion for monthly amounts. */
const PERIODS_PER_YEAR = 24;
/** Semi-monthly periods in one de minimis ceiling period. */
const CEILING_PERIODS: Record<string, number> = {
    monthly: 2,
    semester: 4,
    semestral: 4,
    annual: 24,
    yearly: 24,
};

export type ComputePayslipArgs = {
    employee: { id: string; name: string };
    profile: PayProfile;
    days: DayRecord[];
    /** Manila-midnight dates covered by approved PAID leave (P8.4). */
    leave?: { paidDates: number[] };
    holidayTable: HolidayRule[];
    tables: {
        deminimis?: DeminimisTable;
        sss?: SssTable;
        philhealth?: PhilhealthTable;
        pagibig?: PagibigTable;
        tax?: { annualBrackets: Bracket[] };
    };
    adjustments?: Adjustment[];
    /** Outstanding loans with this period's scheduled amortisation (D9). */
    loans?: LoanState[];
    /**
     * 13th month (D5). The run owns the ledger; the engine only prices the accrual
     * and, when this is the payout run, releases it.
     */
    thirteenthMonth?: {
        accruedCentavos: Money;
        paidCentavos: Money;
        exemptUsedCentavos: Money;
        ceilingCentavos: Money;
        isPayoutRun: boolean;
    };
    /** Final pay on separation (P5.3). */
    separation?: {
        /** Manila midnight of the last day worked. */
        lastDay: number;
        reason: string;
        /** Unused SIL days, entered by HR — HRX has no leave module to derive it. */
        silDaysUnpaid?: number;
        /** Years of service, used for the SIL entitlement floor (Art. 95). */
        yearsOfService?: number;
    };
    ytd?: {
        taxable: Money;
        taxWithheld: Money;
        thirteenthPaid: Money;
        exemptUsed: Money;
    };
    period: {
        startDate: number;
        endDate: number;
        payDate: number;
        isYearEnd: boolean;
        /** 0 = first cutoff of the month, 1 = second (D3 residue rule). */
        cutoffIndex?: 0 | 1;
    };
    /** Employment window, for proration. Defaults to the whole period. */
    employment?: { start?: number; end?: number };
};

/** Zeroed totals — one object, so "zeros" cannot mean two different things. */
function zeroTotals(): Pick<
    PayResult,
    "gross" | "totalDeductions" | "net" | "employerCost"
> {
    return { gross: 0, totalDeductions: 0, net: 0, employerCost: 0 };
}

/**
 * Compute one payslip (§6.1 signature).
 *
 * §6.2 order: profile resolved → basic pay for the period → price each day →
 * period earnings (allowances, adjustments) → [P2: contributions, tax] → [P5: loans,
 * 13th month] → totals.
 */
export function computePayslip(args: ComputePayslipArgs): PayResult {
    if (!args || typeof args !== "object") {
        throw new ConvexError("computePayslip requires the §6.1 argument object");
    }
    // Validate the shape up front: a missing period used to surface as a raw
    // TypeError, which Convex relays as a generic "Server Error" with no clue
    // which argument was absent.
    const missing: string[] = [];
    if (!args.profile) missing.push("profile");
    if (!Array.isArray(args.days)) missing.push("days");
    if (
        !args.period ||
        typeof args.period.startDate !== "number" ||
        typeof args.period.endDate !== "number"
    ) {
        missing.push("period");
    }
    if (missing.length > 0) {
        throw new ConvexError(
            `computePayslip is missing ${missing.join(", ")} — it takes the §6.1 argument object`,
        );
    }
    const { profile, period } = args;
    if (period.endDate < period.startDate) {
        throw new ConvexError("Period end must not be before the period start");
    }

    const lines: PayslipLine[] = [];
    const notes: string[] = [];

    // ── 1. Basic pay for the period ────────────────────────────────────────
    // Monthly-paid: half the monthly rate, prorated on the work-week calendar.
    // Daily/hourly: no period-level basic — the days below are the basic pay.
    if (profile.payType === "monthly") {
        const basic = periodBasicPay({
            terms: profile,
            periodStart: period.startDate,
            periodEnd: period.endDate,
            employmentStart: args.employment?.start,
            employmentEnd: args.employment?.end,
        });
        lines.push({
            kind: "earning",
            code: "BASIC",
            description: "Basic pay for the period",
            quantity: 1,
            amount: basic,
            taxable: true,
        });
    }

    // ── 2. Price the period's CALENDAR, one day at a time (§6.2 step 3) ────
    // Not just the days that have a record: an unworked regular holiday is payable
    // to a daily-paid employee (D8) and produces no timeEntry at all, so iterating
    // the records alone would silently never pay it.
    const recordByDate = new Map(
        args.days.map((day) => [dateKeyOf(day.date), day]),
    );
    // P8.4: approved PAID leave is a worked day — not an absence. Unpaid leave is not
    // listed at all, so it stays an absence and the D18 deduction applies unchanged.
    const paidLeaveDates = new Set((args.leave?.paidDates ?? []).map((date) => dateKeyOf(date)));
    const workedDates = new Set(
        args.days.filter((day) => day.totalMinutes > 0).map((day) => dateKeyOf(day.date)),
    );
    let workedMinutes = 0;
    let nightMinuteCount = 0;
    let pricedDayCount = 0;
    let absentMinutes = 0;

    for (const date of eachDay(period.startDate, period.endDate)) {
        // Employment window: nothing is priced outside it.
        if (args.employment?.start !== undefined && date < args.employment.start) {
            continue;
        }
        if (args.employment?.end !== undefined && date > args.employment.end) {
            continue;
        }
        const record = recordByDate.get(dateKeyOf(date));
        const onPaidLeave = paidLeaveDates.has(dateKeyOf(date));
        // A paid leave day is priced as the standard 09:00–17:00 shift: full basic pay,
        // no night differential (there are no intervals to differential against).
        const priced = priceDay({
            date,
            totalMinutes: onPaidLeave ? NORMAL_MINUTES_PER_DAY : (record?.totalMinutes ?? 0),
            intervals: onPaidLeave
                ? [{ start: date + 9 * 3_600_000, end: date + 17 * 3_600_000 }]
                : (record?.intervals ?? []),
            classification: {
                dayType: classifyDay(date, args.holidayTable),
                isRestDay: isRestDay(date, profile.workWeek),
            },
            terms: profile,
            // The unworked-holiday rule (§2.5 note): payable only if the employee
            // worked the day before.
            priorDayWorked: workedDates.has(dateKeyOf(date - DAY_MS)),
        });
        if (onPaidLeave) workedDates.add(dateKeyOf(date));
        if (priced.lines.length > 0) pricedDayCount += 1;
        lines.push(...priced.lines);
        workedMinutes += priced.workedMinutes;
        nightMinuteCount += priced.nightMinutes;

        // Absence: the monthly rate pays for the SCHEDULE, so time not worked is
        // deducted automatically — full days and undertime alike. Regular holidays
        // and rest days are paid whether worked or not, so they never deduct; a
        // special non-working day is already "no work, no pay" and is paid only for
        // the hours actually worked, so it never deducts either.
        if (profile.payType === "monthly" && !isRestDay(date, profile.workWeek)) {
            const dayType = classifyDay(date, args.holidayTable);
            if (dayType === "ordinary" || dayType === "special_working") {
                const workedThisDay = onPaidLeave
                    ? NORMAL_MINUTES_PER_DAY
                    : Math.min(record?.totalMinutes ?? 0, NORMAL_MINUTES_PER_DAY);
                const shortfall = NORMAL_MINUTES_PER_DAY - workedThisDay;
                if (shortfall > 0) {
                    absentMinutes += shortfall;
                }
            }
        }
    }

    if (absentMinutes > 0) {
        const dailyCentavos = dailyRateCentavos(profile);
        const perMinute = dailyCentavos / NORMAL_MINUTES_PER_DAY;
        lines.push({
            kind: "deduction",
            code: "ABSENCE",
            description: `Unpaid absence / undertime (${(absentMinutes / NORMAL_MINUTES_PER_DAY).toFixed(2)} day(s))`,
            quantity: absentMinutes / NORMAL_MINUTES_PER_DAY,
            amount: roundHalfUp(perMinute * absentMinutes),
            taxable: false,
        });
    }

    // ── 3. Allowances (D15 / P1.3) ─────────────────────────────────────────
    const workDays = workDaysInRange(period.startDate, period.endDate, profile.workWeek);
    const allowanceLines = priceAllowances({
        allowances: profile.allowances,
        deminimis: args.tables?.deminimis,
        workDays,
        notes,
    });
    lines.push(...allowanceLines.lines);

    // ── 4. Adjustments (P1.4: a correction is a line, never an edit — D2) ──
    for (const adjustment of args.adjustments ?? []) {
        if (adjustment.amountCentavos === 0) continue;
        lines.push({
            kind: adjustment.amountCentavos > 0 ? "earning" : "deduction",
            code: adjustment.code,
            description: adjustment.description,
            amount: Math.abs(adjustment.amountCentavos),
            taxable: adjustment.amountCentavos > 0,
            source: { type: "adjustment", id: adjustment.code },
        });
    }

    // ── 4b. 13th month payout and final pay (D5 / P5.3) ────────────────────
    // These are EARNINGS, so they must land BEFORE gross taxable is computed —
    // otherwise the December withholding ignores the payout it is withholding on.
    let thirteenthPayoutCentavos = 0;
    if (args.thirteenthMonth?.isPayoutRun) {
        const split = payoutSplit({
            accruedCentavos: args.thirteenthMonth.accruedCentavos,
            paidCentavos: args.thirteenthMonth.paidCentavos,
            exemptUsedCentavos: args.thirteenthMonth.exemptUsedCentavos,
            ceilingCentavos: args.thirteenthMonth.ceilingCentavos,
        });
        thirteenthPayoutCentavos = split.totalCentavos;
        if (split.exemptCentavos > 0) {
            lines.push({
                kind: "earning",
                code: "13M",
                description: "13th month pay (within the ₱90,000 benefits ceiling)",
                amount: split.exemptCentavos,
                taxable: false,
            });
        }
        if (split.taxableCentavos > 0) {
            lines.push({
                kind: "earning",
                code: "13M_TAXABLE",
                description: "13th month pay above the benefits ceiling (taxable)",
                amount: split.taxableCentavos,
                taxable: true,
            });
        }
    }

    if (args.separation) {
        const dailyCentavos = dailyRateCentavos(profile);
        const silDays = args.separation.silDaysUnpaid ?? 0;
        // Art. 95: SIL accrues after a year of service. HRX has no leave ledger, so
        // the unused days are an input, not a guess — and days entered without the
        // service floor are refused rather than paid.
        if (silDays > 0) {
            if ((args.separation.yearsOfService ?? 0) < 1) {
                notes.push(
                    "Unused SIL was entered but the employee has under a year of service — SIL conversion was NOT paid (Art. 95).",
                );
            } else {
                lines.push({
                    kind: "earning",
                    code: "SIL_CONVERSION",
                    description: `Unused service incentive leave (${silDays} day(s))`,
                    quantity: silDays,
                    amount: roundHalfUp(dailyCentavos * silDays),
                    taxable: true,
                });
            }
        }
        // Final pay releases the 13th month accrued so far, prorated by the accrual
        // itself — no separate proration rule, so it can never disagree with the ledger.
        if (args.thirteenthMonth) {
            const split = payoutSplit({
                accruedCentavos: args.thirteenthMonth.accruedCentavos,
                paidCentavos: args.thirteenthMonth.paidCentavos,
                exemptUsedCentavos: args.thirteenthMonth.exemptUsedCentavos,
                ceilingCentavos: args.thirteenthMonth.ceilingCentavos,
            });
            thirteenthPayoutCentavos += split.totalCentavos;
            if (split.exemptCentavos > 0) {
                lines.push({
                    kind: "earning",
                    code: "13M",
                    description: "13th month pay on separation (pro-rated)",
                    amount: split.exemptCentavos,
                    taxable: false,
                });
            }
            if (split.taxableCentavos > 0) {
                lines.push({
                    kind: "earning",
                    code: "13M_TAXABLE",
                    description: "13th month above the benefits ceiling (taxable)",
                    amount: split.taxableCentavos,
                    taxable: true,
                });
            }
        }
        lines.push({
            kind: "memo",
            code: "SEPARATION",
            description: `Final pay — last day ${new Date(args.separation.lastDay + 8 * 3_600_000).toISOString().slice(0, 10)}: ${args.separation.reason}`,
            amount: 0,
            taxable: false,
        });
    }

    // ── 5. Statutory contributions (P2.1, D3) ──────────────────────────────
    // The base is a MONTHLY figure: the period's earnings × 2, computed on the
    // basis the org chose (D-PILOT-3), then each contribution is split across the
    // two cutoffs. Employer shares are `employer_cost` lines — never a deduction,
    // because a payslip that shows the employer share as a deduction is the most
    // common employee complaint and it is a presentation bug with legal weight.
    const earningLines = lines.filter((line) => line.kind === "earning");
    const WAGE_CODES = new Set(["BASIC", "RH", "SH", "RD", "RH_UNWORKED"]);
    const wageCentavos = earningLines
        .filter((line) => WAGE_CODES.has(line.code))
        .reduce((sum, line) => sum + line.amount, 0);
    const grossEarnings = earningLines.reduce((sum, line) => sum + line.amount, 0);
    const grossTaxableCentavos = earningLines
        .filter((line) => line.taxable)
        .reduce((sum, line) => sum + line.amount, 0);
    const periodBase =
        profile.statutoryBasis === "basic"
            ? wageCentavos
            : profile.statutoryBasis === "gross_taxable"
              ? grossTaxableCentavos
              : grossEarnings;
    const monthlyBase = periodBase * 2;
    const cutoffIndex = period.cutoffIndex ?? 0;

    if (args.tables.sss) {
        const sss = sssContributions(monthlyBase, args.tables.sss);
        const employee = splitMonthlyAcrossCutoffs(sss.employeeCentavos, cutoffIndex);
        const employer = splitMonthlyAcrossCutoffs(sss.employerCentavos, cutoffIndex);
        if (employee > 0) {
            lines.push({
                kind: "deduction",
                code: "SSS",
                description: `SSS contribution (MSC ${sss.mscPesos.toFixed(2)})`,
                amount: employee,
                taxable: false,
            });
        }
        if (employer > 0) {
            lines.push({
                kind: "employer_cost",
                code: "SSS_ER",
                description: `SSS employer share (MSC ${sss.mscPesos.toFixed(2)})`,
                amount: employer,
                taxable: false,
            });
        }
        // EC is employer-only and flat; it is a cost, never a deduction.
        const ec = splitMonthlyAcrossCutoffs(sss.ecCentavos, cutoffIndex);
        if (ec > 0) {
            lines.push({
                kind: "employer_cost",
                code: "EC",
                description: "Employees' Compensation (employer only)",
                amount: ec,
                taxable: false,
            });
        }
        if (sss.mpfMscPesos > 0) {
            notes.push(
                `SSS: MSC ${sss.mscPesos.toFixed(2)} splits into ${sss.regularMscPesos.toFixed(2)} Regular SS and ${sss.mpfMscPesos.toFixed(2)} MPF/MySSS Pension Booster at the same rates (Circular 2024-006).`,
            );
        }
    }

    if (args.tables.philhealth) {
        const phic = philhealthContributions(monthlyBase, args.tables.philhealth);
        const employee = splitMonthlyAcrossCutoffs(phic.employeeCentavos, cutoffIndex);
        const employer = splitMonthlyAcrossCutoffs(phic.employerCentavos, cutoffIndex);
        if (employee > 0) {
            lines.push({
                kind: "deduction",
                code: "PHIC",
                description: `PhilHealth premium (base ${phic.basePesos.toFixed(2)})`,
                amount: employee,
                taxable: false,
            });
        }
        if (employer > 0) {
            lines.push({
                kind: "employer_cost",
                code: "PHIC_ER",
                description: "PhilHealth employer share",
                amount: employer,
                taxable: false,
            });
        }
    }

    if (args.tables.pagibig) {
        const hdmf = pagibigContributions(monthlyBase, args.tables.pagibig);
        const employee = splitMonthlyAcrossCutoffs(hdmf.employeeCentavos, cutoffIndex);
        const employer = splitMonthlyAcrossCutoffs(hdmf.employerCentavos, cutoffIndex);
        if (employee > 0) {
            lines.push({
                kind: "deduction",
                code: "HDMF",
                description: `Pag-IBIG contribution (base ${hdmf.basePesos.toFixed(2)})`,
                amount: employee,
                taxable: false,
            });
        }
        if (employer > 0) {
            lines.push({
                kind: "employer_cost",
                code: "HDMF_ER",
                description: "Pag-IBIG employer share",
                amount: employer,
                taxable: false,
            });
        }
    }

    // ── 6. Withholding tax for THIS cutoff (D4) ────────────────────────────
    // Contributions are not deductible against compensation income under TRAIN, so
    // the base is gross taxable as computed above — not gross less contributions.
    if (args.tables.tax) {
        const tax = withholdingCentavos(
            grossTaxableCentavos,
            args.tables.tax.annualBrackets,
        );
        if (tax > 0) {
            lines.push({
                kind: "deduction",
                code: "TAX",
                description: "Withholding tax on compensation",
                amount: tax,
                taxable: false,
            });
        }
    } else {
        notes.push(
            "No withholding-tax table was supplied, so no tax was computed for this cutoff.",
        );
    }

    // ── 6b. Loans, in D9's priority order ─────────────────────────────────
    // Deducted AFTER statutory contributions and tax, because those are never
    // optional. A schedule that would take net pay below zero blocks the payslip
    // instead of being quietly trimmed.
    let loanPayments: {
        loanId: string;
        type: string;
        amountCentavos: Money;
        balanceAfter: Money;
    }[] = [];
    let loanBlocked: { code: string; reason: string } | undefined;
    if (args.loans && args.loans.length > 0) {
        const alreadyDeducted = lines
            .filter((line) => line.kind === "deduction")
            .reduce((sum, line) => sum + line.amount, 0);
        const plan = planLoanPayments({
            loans: args.loans,
            availableCentavos: Math.max(0, grossEarnings - alreadyDeducted),
        });
        if (plan.blocked) {
            loanBlocked = plan.blocked;
        } else {
            lines.push(...plan.lines);
            loanPayments = plan.payments;
        }
    }

    // ── 7. Memo lines: the payslip must state how the daily rate was derived
    // (D7) and which statutory basis it will use (D-PILOT-3). ──────────────
    lines.push({
        kind: "memo",
        code: "RATE_DERIVATION",
        description: rateDerivation(profile),
        amount: 0,
        taxable: false,
    });
    const accrual = args.thirteenthMonth
        ? accrualForPeriod({ basicEarnedCentavos: wageCentavos })
        : 0;
    if (args.thirteenthMonth) {
        lines.push({
            kind: "memo",
            code: "13M_ACCRUAL",
            description: `13th month accrued this period (1/12 of ₱${(wageCentavos / 100).toFixed(2)} basic earned)`,
            amount: accrual,
            taxable: false,
        });
    }
    lines.push({
        kind: "memo",
        code: "STATUTORY_BASIS",
        description: `Statutory contributions computed on ${profile.statutoryBasis.replace("_", " ")} pay`,
        amount: 0,
        taxable: false,
    });

    const totals = totalsFromLines(lines);

    return {
        lines,
        ...totals,
        hoursWorked: workedMinutes / 60,
        nightHours: nightMinuteCount / 60,
        notes,
        pricedDays: pricedDayCount,
        absentDays: absentMinutes / NORMAL_MINUTES_PER_DAY,
        thirteenthMonthAccrualCentavos: accrual,
        thirteenthMonthPayoutCentavos: thirteenthPayoutCentavos,
        loanPayments,
        // Nothing is missing from the payslip as of P5 — the only blocker left is a
        // loan schedule that does not fit (D9). December annualisation (P7) changes
        // the TAX line of a year-end run, which is noted rather than blocked.
        blocked: loanBlocked,
    };
}

/**
 * Allowances (P1.3, D15).
 *
 * Each item is prorated from its own unit to the period (a monthly allowance pays
 * half in a semi-monthly run), then a de minimis item is split at its ceiling:
 * the exempt part stays `ALW_<CODE>` and the excess becomes a TAXABLE line. Silently
 * keeping the whole allowance exempt under-withholds; rejecting it annoys the
 * employer. The split is the only correct answer.
 */
export function priceAllowances(args: {
    allowances: Allowance[];
    deminimis?: DeminimisTable;
    workDays: number;
    notes: string[];
}): { lines: PayslipLine[]; exempt: Money; taxable: Money } {
    const lines: PayslipLine[] = [];
    let exempt = 0;
    let taxable = 0;

    for (const allowance of args.allowances) {
        if (allowance.amount <= 0) continue;
        const unit = allowance.unit ?? "monthly";
        const factor =
            unit === "semi_monthly" || unit === "per_period"
                ? 1
                : unit === "monthly"
                  ? 1 / 2
                  : unit === "annual"
                    ? 1 / PERIODS_PER_YEAR
                    : args.workDays; // per_day
        const amountCentavos = roundHalfUp(toCentavos(allowance.amount) * factor);

        const ceiling = allowance.deMinimisCategory
            ? args.deminimis?.ceilings.find(
                  (row) => row.key === allowance.deMinimisCategory,
              )
            : undefined;

        // No ceiling, a percentage-based ceiling (meal-OT is a share of the
        // minimum wage, and P0 has no wage table), or a taxable code: the whole
        // amount is taxable. Never silently exempt.
        const ceilingPerPeriod =
            ceiling && ceiling.ceiling !== null
                ? roundHalfUp(
                      toCentavos(ceiling.ceiling) /
                          (CEILING_PERIODS[ceiling.period] ?? 1),
                  )
                : null;

        if (ceiling && ceiling.ceiling === null) {
            args.notes.push(
                `${allowance.code}: de minimis ceiling is expressed as a percentage of the minimum wage and is not evaluated yet — the full amount is treated as exempt, which is the position P2 must revisit.`,
            );
        }

        // Four cases, stated one per branch rather than as a nested ternary:
        //   1. taxable by catalogue            -> all taxable
        //   2. non-taxable, numeric ceiling    -> exempt up to the ceiling
        //   3. non-taxable, percentage ceiling -> all exempt, flagged in notes
        //   4. non-taxable, no ceiling at all  -> all TAXABLE (no de minimis basis)
        // Case 4 is the conservative direction: over-withholding is recoverable at
        // year-end, under-withholding is a 1601-C that does not match the alphalist.
        let exemptCentavos = 0;
        if (!allowance.taxable) {
            if (ceilingPerPeriod !== null) {
                exemptCentavos = Math.min(amountCentavos, ceilingPerPeriod);
            } else if (ceiling) {
                exemptCentavos = amountCentavos;
            } else {
                exemptCentavos = 0;
                args.notes.push(
                    `${allowance.code} is marked non-taxable but has no de minimis ceiling in the table — booked as TAXABLE. Map it to a ceiling in the allowance catalogue.`,
                );
            }
        }
        const taxableCentavos = amountCentavos - exemptCentavos;

        if (exemptCentavos > 0) {
            lines.push({
                kind: "earning",
                code: `ALW_${allowance.code}`,
                description: allowance.description,
                quantity: 1,
                amount: exemptCentavos,
                taxable: false,
            });
            exempt += exemptCentavos;
        }
        if (taxableCentavos > 0) {
            lines.push({
                kind: "earning",
                code: `ALW_${allowance.code}_TAXABLE`,
                description: `${allowance.description} (above de minimis ceiling / taxable)`,
                quantity: 1,
                amount: taxableCentavos,
                taxable: true,
            });
            taxable += taxableCentavos;
        }
        if (allowance.taxable) {
            args.notes.push(
                `${allowance.code} is a taxable allowance by catalogue — booked in full as taxable income.`,
            );
        }
    }

    return { lines, exempt, taxable };
}

/**
 * Totals from lines, in centavos (§6.1: sum lines, never derive a line from a
 * rounded total).
 */
export function totalsFromLines(lines: PayslipLine[]): Pick<
    PayResult,
    "gross" | "totalDeductions" | "net" | "employerCost"
> {
    let gross = 0;
    let totalDeductions = 0;
    let employerCost = 0;
    for (const line of lines) {
        if (line.kind === "earning") gross += line.amount;
        else if (line.kind === "deduction") totalDeductions += line.amount;
        else if (line.kind === "employer_cost") employerCost += line.amount;
        // `memo` lines never move money.
    }
    return { gross, totalDeductions, net: gross - totalDeductions, employerCost };
}

/** Re-exported so a caller needs one import for the hourly rate it displays. */
export { NORMAL_HOURS_PER_DAY, zeroTotals };
export { hourlyRateCentavos } from "./rates";
