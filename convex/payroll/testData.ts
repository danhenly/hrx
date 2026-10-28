import { ConvexError, v } from "convex/values";
import { internalMutation } from "../_generated/server";
import type { MutationCtx } from "../_generated/server";
import type { Id, TableNames } from "../_generated/dataModel";
import { logAudit } from "../audit";
import { requireAnyAdmin } from "../helpers";
import {
    DAY_MS,
    dateKeyOf,
    eachDay,
    isRestDay,
    msOfDateKey,
} from "../lib/payroll/calendar";
import {
    allowanceTotalOf,
    annualSalaryFor,
    DEFAULT_PAYROLL_SETTINGS,
} from "../lib/payroll/rates";
import { ALLOWANCE_CATALOGUE } from "./statutorySeed";

// ─── Why this file exists ──────────────────────────────────────────────────
//
// The pilot cannot supply small test data: no payroll-register access, no NDA
// (D-PILOT-2). So the app generates its own, in a SEPARATE org flagged
// `payrollSettings.isTestOrg`, deterministically from a recorded `seed`, and can
// remove every trace of it — `teardownPayrollDataset` refuses on any org without
// that flag (§8.1c).
//
// Dev and production share one Convex deployment, so every dataset is recorded in
// the vault note "HRX Phase 2 — Test Data Registry". That note is the only answer
// to "what is that org in the dashboard" six months from now.

/** A small LCG — deterministic, so a bad payslip can be reproduced exactly. */
function makeRandom(seed: number): () => number {
    if (!Number.isInteger(seed) || seed <= 0) {
        throw new ConvexError("seed must be a positive integer (it is recorded for reproduction)");
    }
    let state = seed >>> 0;
    return () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state / 4294967296;
    };
}

// ─── The §8.2 personas, by construction ────────────────────────────────────

type Allowance = {
    code: string;
    description: string;
    amount: number;
    taxable: boolean;
    deMinimisCategory?: string;
};

type PersonaSpec = {
    key: string;
    firstName: string;
    lastName: string;
    payType: "monthly" | "daily" | "hourly";
    basicRate: number;
    dailyRateBasis: "261" | "313" | "22" | "26";
    workWeek: "5_day" | "6_day";
    allowances: Allowance[];
    shift: "day" | "night";
    hireDate: string;
    endDate?: string;
    status: "active" | "terminated" | "on_leave";
    /** Statutory identifiers deliberately left blank, to exercise D16's refusals. */
    omit?: ("sss" | "philhealth" | "pagibig" | "tin" | "bank")[];
    why: string;
};

const RICE: Allowance = { code: "RICE", description: "Rice subsidy", amount: 2500, taxable: false, deMinimisCategory: "RICE" };
const LAUNDRY: Allowance = { code: "LAUNDRY", description: "Laundry allowance", amount: 400, taxable: false, deMinimisCategory: "LAUNDRY" };
const TRANSPO: Allowance = { code: "TRANSPO", description: "Transportation allowance", amount: 1500, taxable: true };

const PERSONAS: PersonaSpec[] = [
    {
        key: "min-wage-6day",
        firstName: "Maria",
        lastName: "Santos",
        payType: "monthly",
        // ₱645.00 statutory daily minimum × 313 working days ÷ 12.
        basicRate: 16823.75,
        dailyRateBasis: "313",
        workWeek: "6_day",
        allowances: [RICE],
        shift: "day",
        hireDate: "2024-03-04",
        status: "active",
        why: "Minimum-wage monthly-paid on a 6-day week: no withholding tax, contributions at the floor.",
    },
    {
        key: "sss-msc-ceiling",
        firstName: "Ramon",
        lastName: "Villanueva",
        payType: "monthly",
        basicRate: 45000,
        dailyRateBasis: "313",
        workWeek: "6_day",
        allowances: [TRANSPO],
        shift: "day",
        hireDate: "2022-07-18",
        status: "active",
        why: "Above the ₱35,000 SSS MSC ceiling: EE share capped at ₱1,750 and the WISP split applies.",
    },
    {
        key: "philhealth-ceiling",
        firstName: "Alicia",
        lastName: "Reyes",
        payType: "monthly",
        basicRate: 100000,
        dailyRateBasis: "313",
        workWeek: "6_day",
        allowances: [RICE, TRANSPO],
        shift: "day",
        hireDate: "2021-01-11",
        status: "active",
        why: "At the ₱100,000 PhilHealth ceiling: ₱5,000 premium split ₱2,500 / ₱2,500.",
    },
    {
        key: "daily-paid",
        firstName: "Jose",
        lastName: "Dela Cruz",
        payType: "daily",
        basicRate: 700,
        dailyRateBasis: "313",
        workWeek: "6_day",
        allowances: [],
        shift: "day",
        hireDate: "2025-06-02",
        status: "active",
        why: "Daily-paid: an unworked regular holiday is a real 100% earning line (D8), unlike monthly-paid.",
    },
    {
        key: "night-shift",
        firstName: "Editha",
        lastName: "Mendoza",
        payType: "monthly",
        basicRate: 26000,
        dailyRateBasis: "313",
        workWeek: "6_day",
        allowances: [LAUNDRY],
        shift: "night",
        hireDate: "2023-09-25",
        status: "active",
        why: "Night shift 22:00–06:00: ND priced per segment, and the shift crosses a cutoff without double counting.",
    },
    {
        key: "loans",
        firstName: "Benjamin",
        lastName: "Aquino",
        payType: "monthly",
        basicRate: 30000,
        dailyRateBasis: "313",
        workWeek: "6_day",
        allowances: [RICE, LAUNDRY],
        shift: "day",
        hireDate: "2020-02-10",
        status: "active",
        why: "Pay terms for the SSS salary loan + Pag-IBIG MPL persona (the loan ledgers themselves land with P5 — see notes).",
    },
    {
        key: "mid-month-hire",
        firstName: "Kristine",
        lastName: "Bautista",
        payType: "monthly",
        basicRate: 22000,
        dailyRateBasis: "313",
        workWeek: "6_day",
        allowances: [],
        shift: "day",
        hireDate: "2026-11-18",
        status: "active",
        omit: ["tin"],
        why: "Mid-month hire: proration on the work-week calendar, no TIN yet (D16's documented fallback).",
    },
    {
        key: "resignation",
        firstName: "Danilo",
        lastName: "Ocampo",
        payType: "monthly",
        basicRate: 26000,
        dailyRateBasis: "313",
        workWeek: "6_day",
        allowances: [RICE],
        shift: "day",
        hireDate: "2019-05-06",
        endDate: "2026-12-01",
        status: "terminated",
        why: "Mid-period resignation: proration, final pay and a prorated 13th month.",
    },
];

/** The pilot's periods (D1): the one-off first period, then the 10/25 cutoffs. */
const PERIOD_PLAN = [
    { start: "2026-11-10", end: "2026-11-24", pay: "2026-11-30", status: "closed" as const },
    { start: "2026-11-25", end: "2026-12-10", pay: "2026-12-15", status: "open" as const },
    { start: "2026-12-11", end: "2026-12-25", pay: "2026-12-30", status: "open" as const },
];

const FILLER_FIRST = ["Ana", "Luis", "Carla", "Miguel", "Grace", "Paolo", "Ruby", "Nestor", "Divina", "Efren"];
const FILLER_LAST = ["Garcia", "Ramos", "Torres", "Flores", "Navarro", "Castillo", "Domingo", "Salazar", "Pascual", "Yulo"];
// Rates are per pay type: a monthly figure handed to a daily-paid filler would
// make them a ₱42,000/day employee, which is not a payroll anyone can sanity-check.
const FILLER_MONTHLY_RATES = [16823.75, 20000, 24000, 30000, 36000, 42000];
const FILLER_DAILY_RATES = [645, 700, 750, 800, 900];

/** Cap per run: a single Convex mutation is one transaction, so a 1,200-head set
 *  has to be chunked (P3, §8.1b). Refusing beats a half-written dataset. */
const MAX_EMPLOYEES_PER_RUN = 80;
const MAX_PERIODS = 3;
const MAX_ENTRIES_PER_RUN = 6000;

/** Gross annual figure for a spec — the same rule the mutation applies (rates.ts). */
function annualSalaryOf(spec: PersonaSpec): number {
    return annualSalaryFor({
        payType: spec.payType,
        basicRate: spec.basicRate,
        dailyRateBasis: spec.dailyRateBasis,
        workWeek: spec.workWeek,
        statutoryBasis: "basic",
        allowances: [],
    });
}

function idNumbers(index: number, omit: PersonaSpec["omit"]) {
    const digits = (value: number, width: number) =>
        String(value).padStart(width, "0").slice(-width);
    const base = 1000000 + index * 137;
    return {
        sssNumber: omit?.includes("sss") ? undefined : `34-${digits(base, 7)}-${index % 10}`,
        philhealthNumber: omit?.includes("philhealth") ? undefined : `12${digits(base, 10)}`,
        pagibigNumber: omit?.includes("pagibig") ? undefined : `1210${digits(base, 8)}`,
        tin: omit?.includes("tin") ? undefined : `${digits(100 + index, 3)}-${digits(base, 3)}-${digits(base % 1000, 3)}-000`,
    };
}

/**
 * Builds the synthetic dataset (P0.7).
 *
 * INTERNAL: not client-callable. `actorId` must be an admin somewhere — the same
 * rule the other internal payroll mutations use.
 *
 *   npx convex run payroll/testData:seedPayrollDataset \
 *     '{"orgName":"HRX Payroll Test","employees":30,"periods":2,"seed":20261128,"actorId":"<admin user id>"}'
 */
export const seedPayrollDataset = internalMutation({
    args: {
        orgName: v.string(),
        employees: v.optional(v.number()),
        periods: v.optional(v.number()),
        seed: v.optional(v.number()),
        actorId: v.id("users"),
    },
    handler: async (ctx, args) => {
        await requireAnyAdmin(ctx, args.actorId);

        const totalEmployees = args.employees ?? 30;
        const periodCount = args.periods ?? 2;
        const seed = args.seed ?? 20261128;

        if (totalEmployees < 1 || totalEmployees > MAX_EMPLOYEES_PER_RUN) {
            throw new ConvexError(
                `employees must be 1–${MAX_EMPLOYEES_PER_RUN} per run: a mutation is one transaction, so a larger set is chunked (P3 / §8.1b)`,
            );
        }
        if (periodCount < 1 || periodCount > MAX_PERIODS) {
            throw new ConvexError(`periods must be 1–${MAX_PERIODS}`);
        }
        const random = makeRandom(seed);

        const orgName = args.orgName.trim() || "HRX Payroll Test";
        const orgId = await ctx.db.insert("organizations", {
            name: orgName,
            createdBy: args.actorId,
            payrollSettings: { ...DEFAULT_PAYROLL_SETTINGS, isTestOrg: true },
        });

        // ── The two users that make maker–checker exercisable (D12 / D-PILOT-8) ──
        // Their memberships carry the roles; no password is set here because a
        // mutation cannot hash one (bcrypt lives in an action). Set a password
        // through Settings → Team before signing in as them.
        const stamp = `${seed}`;
        const hrUserId = await ctx.db.insert("users", {
            name: "Test HR Preparer",
            email: `payroll-test-${stamp}-hr@hrx.test`,
        });
        const adminUserId = await ctx.db.insert("users", {
            name: "Test Admin Approver",
            email: `payroll-test-${stamp}-admin@hrx.test`,
        });
        await ctx.db.insert("members", { userId: hrUserId, orgId, role: "hr" });
        await ctx.db.insert("members", { userId: adminUserId, orgId, role: "admin" });

        // ── Allowance catalogue, so position allowances reference real codes ──
        for (const type of ALLOWANCE_CATALOGUE) {
            await ctx.db.insert("allowanceTypes", {
                orgId,
                code: type.code,
                description: type.description,
                unit: type.unit,
                taxable: type.taxable,
                deMinimisKind: type.deMinimisKind,
                active: true,
            });
        }

        // ── Positions masterlist ──
        const now = Date.now();
        const positionNames = ["Office Staff", "Field Technician", "Warehouse Associate", "Team Supervisor"];
        const positionIds: Id<"positions">[] = [];
        for (const [index, name] of positionNames.entries()) {
            positionIds.push(
                await ctx.db.insert("positions", {
                    orgId,
                    name,
                    nameKey: name.toLowerCase(),
                    department: index === 3 ? "Operations" : undefined,
                    isActive: true,
                    createdBy: args.actorId,
                    createdAt: now,
                    updatedBy: args.actorId,
                    updatedAt: now,
                }),
            );
        }

        // ── Periods ──
        const periods = PERIOD_PLAN.slice(0, periodCount).map((plan) => ({
            ...plan,
            startDate: msOfDateKey(plan.start),
            endDate: msOfDateKey(plan.end),
            payDate: msOfDateKey(plan.pay),
        }));
        const periodIds: Id<"payrollPeriods">[] = [];
        for (const period of periods) {
            periodIds.push(
                await ctx.db.insert("payrollPeriods", {
                    orgId,
                    periodType: "semi_monthly",
                    startDate: period.startDate,
                    endDate: period.endDate,
                    payDate: period.payDate,
                    status: period.status,
                }),
            );
        }

        // ── Employees, position history, statutory ids ──
        const headcount = Math.min(totalEmployees, PERSONAS.length + FILLER_FIRST.length * FILLER_LAST.length);
        const roster: { employeeId: Id<"employees">; spec: PersonaSpec; workWeek: "5_day" | "6_day" }[] = [];

        for (let index = 0; index < headcount; index += 1) {
            const persona: PersonaSpec | undefined = PERSONAS[index];
            const spec: PersonaSpec = persona
                ? persona
                : {
                      key: `filler-${index}`,
                      firstName: FILLER_FIRST[index % FILLER_FIRST.length],
                      lastName: FILLER_LAST[Math.floor(index / FILLER_FIRST.length) % FILLER_LAST.length],
                      payType: random() > 0.75 ? "daily" : "monthly",
                      basicRate: 0, // set below, from the list matching payType
                      dailyRateBasis: "313",
                      workWeek: random() > 0.85 ? "5_day" : "6_day",
                      allowances: random() > 0.5 ? [RICE] : [],
                      shift: "day",
                      hireDate: "2023-01-16",
                      status: "active",
                      why: "filler",
                  };
            if (!persona) {
                // Defaults above leave basicRate 0; draw from the list that matches
                // the pay type so the scale is plausible in both directions.
                spec.basicRate =
                    spec.payType === "daily"
                        ? FILLER_DAILY_RATES[Math.floor(random() * FILLER_DAILY_RATES.length)]
                        : FILLER_MONTHLY_RATES[Math.floor(random() * FILLER_MONTHLY_RATES.length)];
            }

            const employeeId = await ctx.db.insert("employees", {
                orgId,
                firstName: spec.firstName,
                lastName: `${spec.lastName} ${index + 1}`.trim(),
                email: undefined,
                hireDate: msOfDateKey(spec.hireDate),
                status: spec.status,
                taxStatus: "S",
                taxStatusUpdatedAt: now,
            });

            await ctx.db.insert("employeePositions", {
                orgId,
                employeeId,
                positionId: positionIds[index % positionIds.length],
                jobTitle: positionNames[index % positionNames.length],
                department: index % 4 === 3 ? "Operations" : undefined,
                // `salary` is the gross ANNUAL figure. For monthly pay that is
                // basicRate × 12 (D15's invariant); for daily/hourly it is the rate
                // times the year's working days/hours, using the SAME divisor the
                // daily rate is derived from — two different conventions in one row
                // is how a backfill and a payslip end up disagreeing.
                salary: annualSalaryOf(spec),
                payType: spec.payType,
                basicRate: spec.basicRate,
                dailyRateBasis: spec.dailyRateBasis,
                workWeek: spec.workWeek,
                statutoryBasis: "basic",
                allowances: spec.allowances,
                allowanceTotal: allowanceTotalOf(spec.allowances) / 100,
                effectiveDate: msOfDateKey(spec.hireDate),
                endDate: spec.endDate ? msOfDateKey(spec.endDate) : undefined,
            });

            const ids = idNumbers(index, spec.omit);
            await ctx.db.insert("employeeStatutoryIds", {
                orgId,
                employeeId,
                ...ids,
                bank: spec.omit?.includes("bank")
                    ? undefined
                    : {
                          bank: "BDO",
                          accountName: `${spec.lastName.toUpperCase()}, ${spec.firstName.toUpperCase()}`,
                          accountNumber: `00${String(3000000000 + index * 7919).slice(-10)}`,
                          accountType: "atm" as const,
                      },
                updatedBy: args.actorId,
                updatedAt: now,
            });

            roster.push({ employeeId, spec, workWeek: spec.workWeek });
        }

        // ── Day entries: worked, night, OT, holiday, absence ──
        // Status follows the period: the closed one is `locked` (what payroll
        // consumes), the open ones are `approved`.
        let entryCount = 0;
        const projected =
            roster.length * periods.length * 26;
        if (projected > MAX_ENTRIES_PER_RUN) {
            throw new ConvexError(
                `That dataset would create ~${projected} day entries; the limit per run is ${MAX_ENTRIES_PER_RUN}`,
            );
        }

        for (const member of roster) {
            const hireMs = msOfDateKey(member.spec.hireDate);
            const endMs = member.spec.endDate ? msOfDateKey(member.spec.endDate) : undefined;

            for (const [periodIndex, period] of periods.entries()) {
                const dayStatus = period.status === "closed" ? "locked" : "approved";
                for (const day of eachDay(period.startDate, period.endDate)) {
                    if (day < hireMs) continue;
                    if (endMs !== undefined && day > endMs) continue;
                    if (isRestDay(day, member.spec.workWeek)) continue;

                    // Deterministic absences, so "no entry" is exercised too.
                    const dayNumber = Math.round((day - period.startDate) / DAY_MS);
                    if (member.spec.shift === "day" && dayNumber % 13 === 7) continue;

                    const intervals =
                        member.spec.shift === "night"
                            ? [
                                  // 22:00 on the entry's own date → 06:00 the next day.
                                  { start: day + 22 * 3600000, end: day + 30 * 3600000 },
                              ]
                            : dayNumber % 5 === 3
                              ? [
                                    { start: day + 8 * 3600000, end: day + 12 * 3600000 },
                                    { start: day + 13 * 3600000, end: day + 17 * 3600000 },
                                    // Overtime on every fifth day.
                                    { start: day + 18 * 3600000, end: day + 20 * 3600000 },
                                ]
                              : [
                                    { start: day + 8 * 3600000, end: day + 12 * 3600000 },
                                    { start: day + 13 * 3600000, end: day + 17 * 3600000 },
                                ];

                    const withDurations = intervals.map((interval) => ({
                        ...interval,
                        durationMinutes: Math.floor((interval.end - interval.start) / 60000),
                    }));
                    const totalMinutes = withDurations.reduce(
                        (sum, interval) => sum + interval.durationMinutes,
                        0,
                    );

                    await ctx.db.insert("timeEntries", {
                        orgId,
                        employeeId: member.employeeId,
                        date: day,
                        intervals: withDurations,
                        totalMinutes,
                        source: "manual",
                        status: dayStatus,
                        approvedAt: day + 20 * 3600000,
                        approvedBy: adminUserId,
                        lockedAt:
                            dayStatus === "locked" ? period.payDate - DAY_MS : undefined,
                        lockedBy: dayStatus === "locked" ? adminUserId : undefined,
                        createdBy: hrUserId,
                        updatedBy: hrUserId,
                    });
                    entryCount += 1;
                }
            }
        }

        await logAudit(ctx, {
            orgId,
            actorId: args.actorId,
            action: "payroll.testData.seed",
            entityType: "organizations",
            entityId: orgId,
        });

        const counts = {
            organizations: 1,
            users: 2,
            members: 2,
            allowanceTypes: ALLOWANCE_CATALOGUE.length,
            positions: positionIds.length,
            payrollPeriods: periodIds.length,
            employees: roster.length,
            employeePositions: roster.length,
            employeeStatutoryIds: roster.length,
            timeEntries: entryCount,
            auditLogs: 1,
        };

        return {
            orgId,
            orgName,
            seed,
            employees: roster.length,
            periods: periods.map((period) => ({
                start: dateKeyOf(period.startDate),
                end: dateKeyOf(period.endDate),
                pay: dateKeyOf(period.payDate),
            })),
            users: {
                hr: { id: hrUserId, email: `payroll-test-${stamp}-hr@hrx.test`, role: "hr" },
                admin: { id: adminUserId, email: `payroll-test-${stamp}-admin@hrx.test`, role: "admin" },
            },
            counts,
            personas: roster.slice(0, PERSONAS.length).map((member) => member.spec.key),
            notes: [
                "Loan ledgers are NOT seeded: loanAccounts / loanAmortizations are P5 tables and do not exist in the schema yet. The 'loans' persona carries the pay terms those loans will amortise against.",
                "The seeded users have no password (a mutation cannot hash one). Set one in Settings → Team to sign in as the hr preparer or admin approver.",
                "Record this org in the vault note 'HRX Phase 2 — Test Data Registry' with its id, seed and row counts.",
            ],
        };
    },
});

// ─── Teardown ──────────────────────────────────────────────────────────────

async function deleteAll<T extends TableNames>(
    ctx: MutationCtx,
    ids: Id<T>[],
) {
    for (let index = 0; index < ids.length; index += 100) {
        await Promise.all(
            ids.slice(index, index + 100).map((id) => ctx.db.delete(id)),
        );
    }
}

/**
 * Removes a generated dataset completely (P0.7).
 *
 * REFUSES when `payrollSettings.isTestOrg` is not exactly `true` — that flag is
 * the only thing standing between this mutation and a real client's payroll.
 * Deletion runs in dependency order and returns a per-table count, so the caller
 * can see that nothing was left orphaned.
 */
export const teardownPayrollDataset = internalMutation({
    args: { orgId: v.id("organizations"), actorId: v.id("users") },
    handler: async (ctx, { orgId, actorId }) => {
        await requireAnyAdmin(ctx, actorId);

        const org = await ctx.db.get(orgId);
        if (!org) throw new ConvexError("Organisation not found");
        if (org.payrollSettings?.isTestOrg !== true) {
            throw new ConvexError(
                "Refusing to tear down: payrollSettings.isTestOrg is not true. This is the guard that keeps a generated dataset from deleting a real org.",
            );
        }

        const counts: Record<string, number> = {};

        const timeEntries = await ctx.db
            .query("timeEntries")
            .withIndex("by_org", (q) => q.eq("orgId", orgId))
            .collect();
        counts.timeEntries = timeEntries.length;
        await deleteAll(ctx, timeEntries.map((row) => row._id));

        const statutoryIds = await ctx.db
            .query("employeeStatutoryIds")
            .withIndex("by_org_employee", (q) => q.eq("orgId", orgId))
            .collect();
        counts.employeeStatutoryIds = statutoryIds.length;
        await deleteAll(ctx, statutoryIds.map((row) => row._id));

        const history = await ctx.db
            .query("employeePositions")
            .withIndex("by_org", (q) => q.eq("orgId", orgId))
            .collect();
        counts.employeePositions = history.length;
        await deleteAll(ctx, history.map((row) => row._id));

        const employees = await ctx.db
            .query("employees")
            .withIndex("by_org", (q) => q.eq("orgId", orgId))
            .collect();
        counts.employees = employees.length;
        await deleteAll(ctx, employees.map((row) => row._id));

        const positions = await ctx.db
            .query("positions")
            .withIndex("by_org", (q) => q.eq("orgId", orgId))
            .collect();
        counts.positions = positions.length;
        await deleteAll(ctx, positions.map((row) => row._id));

        const allowanceTypes = await ctx.db
            .query("allowanceTypes")
            .withIndex("by_org", (q) => q.eq("orgId", orgId))
            .collect();
        counts.allowanceTypes = allowanceTypes.length;
        await deleteAll(ctx, allowanceTypes.map((row) => row._id));

        const periods = await ctx.db
            .query("payrollPeriods")
            .withIndex("by_org_start", (q) => q.eq("orgId", orgId))
            .collect();
        counts.payrollPeriods = periods.length;
        await deleteAll(ctx, periods.map((row) => row._id));

        const audit = await ctx.db
            .query("auditLogs")
            .withIndex("by_org_at", (q) => q.eq("orgId", orgId))
            .collect();
        counts.auditLogs = audit.length;
        await deleteAll(ctx, audit.map((row) => row._id));

        const members = await ctx.db
            .query("members")
            .withIndex("by_org", (q) => q.eq("orgId", orgId))
            .collect();
        counts.members = members.length;

        // Only delete users whose ONLY membership was this org — a user invited
        // into a real org must survive its dataset being cleaned up.
        let users = 0;
        for (const member of members) {
            const otherMemberships = await ctx.db
                .query("members")
                .withIndex("by_user", (q) => q.eq("userId", member.userId))
                .collect();
            if (otherMemberships.length === 1) {
                await ctx.db.delete(member.userId);
                users += 1;
            }
            await ctx.db.delete(member._id);
        }
        counts.users = users;

        await ctx.db.delete(orgId);
        counts.organizations = 1;

        return { orgId, orgName: org.name, deleted: counts };
    },
});

/** Counts what is left for an org. Teardown is not "done" until every row is 0. */
export const verifyEmpty = internalMutation({
    args: { orgId: v.id("organizations"), actorId: v.id("users") },
    handler: async (ctx, { orgId, actorId }) => {
        await requireAnyAdmin(ctx, actorId);

        // Explicit per-table counts: one cast-free query each, so a renamed index
        // or a missing table is a type error here rather than a silent zero.
        const timeEntries = await ctx.db
            .query("timeEntries")
            .withIndex("by_org", (q) => q.eq("orgId", orgId))
            .collect();
        const employeeStatutoryIds = await ctx.db
            .query("employeeStatutoryIds")
            .withIndex("by_org_employee", (q) => q.eq("orgId", orgId))
            .collect();
        const employeePositions = await ctx.db
            .query("employeePositions")
            .withIndex("by_org", (q) => q.eq("orgId", orgId))
            .collect();
        const employees = await ctx.db
            .query("employees")
            .withIndex("by_org", (q) => q.eq("orgId", orgId))
            .collect();
        const positions = await ctx.db
            .query("positions")
            .withIndex("by_org", (q) => q.eq("orgId", orgId))
            .collect();
        const allowanceTypes = await ctx.db
            .query("allowanceTypes")
            .withIndex("by_org", (q) => q.eq("orgId", orgId))
            .collect();
        const payrollPeriods = await ctx.db
            .query("payrollPeriods")
            .withIndex("by_org_start", (q) => q.eq("orgId", orgId))
            .collect();
        const auditLogs = await ctx.db
            .query("auditLogs")
            .withIndex("by_org_at", (q) => q.eq("orgId", orgId))
            .collect();
        const members = await ctx.db
            .query("members")
            .withIndex("by_org", (q) => q.eq("orgId", orgId))
            .collect();
        const organizations = (await ctx.db.get(orgId)) === null ? 0 : 1;

        const counts = {
            timeEntries: timeEntries.length,
            employeeStatutoryIds: employeeStatutoryIds.length,
            employeePositions: employeePositions.length,
            employees: employees.length,
            positions: positions.length,
            allowanceTypes: allowanceTypes.length,
            payrollPeriods: payrollPeriods.length,
            auditLogs: auditLogs.length,
            members: members.length,
            organizations,
        };

        const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
        return { orgId, counts, total, clean: total === 0 };
    },
});
