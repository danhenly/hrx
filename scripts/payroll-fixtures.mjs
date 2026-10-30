#!/usr/bin/env node
/**
 * Payroll fixture runner (P0.6).
 *
 *   node --experimental-strip-types scripts/payroll-fixtures.mjs
 *
 * The repo has no test framework (Phase 1 finding), so this is the same trick
 * that proved convex/lib/intervals.ts: the payroll rules live in pure modules
 * with no ctx and no generated types, and node can import them directly with its
 * type stripping. CI does not run this yet; the PR states the command and the
 * result.
 *
 * Exit code 0 = every check passed, 1 = at least one failed. Numbers compare
 * with a 1e-6 tolerance so a fixture can state 4270.833333 for 102500/24 without
 * pinning float noise; money assertions are integers and compare exactly.
 */
import { register } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Extensionless relative imports must resolve to .ts (see ts-resolve-hook.mjs).
register("./ts-resolve-hook.mjs", import.meta.url);

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const libDir = join(root, "convex", "lib", "payroll");
const fixturesDir = join(libDir, "__fixtures__");

const load = (file) => import(pathToFileURL(join(libDir, file)).href);
const loadSrc = (file) => import(pathToFileURL(join(root, "src", "lib", file)).href);
const [bankFilesDoc, sha256Doc] = await Promise.all([
    load("bankFiles.ts"),
    load("sha256.ts"),
]);
const bankFiles = bankFilesDoc;
const sha256 = sha256Doc;

const [rates, calendar, tax, engine, premiums, statutory, thirteenth, govForms, loansLib, yearEndLib, leaveLib, readinessLib] = await Promise.all([
    load("rates.ts"),
    load("calendar.ts"),
    load("tax.ts"),
    load("engine.ts"),
    load("premiums.ts"),
    load("statutory.ts"),
    load("thirteenth.ts"),
    load("govForms.ts"),
    load("loans.ts"),
    load("yearEnd.ts"),
    load("leave.ts"),
    load("readiness.ts"),
]);

/** The holiday set the engine fixtures price against (a slice of DOLE LA 12-25). */
const FIXTURE_HOLIDAYS = [
    { date: "2026-01-01", name: "New Year's Day", type: "regular" },
    { date: "2026-02-25", name: "EDSA People Power Revolution Anniversary", type: "special_working" },
    { date: "2026-08-31", name: "National Heroes Day", type: "regular" },
    { date: "2026-11-01", name: "All Saints' Day", type: "special_non_working" },
    { date: "2026-11-02", name: "All Souls' Day", type: "special_non_working" },
    { date: "2026-11-30", name: "Bonifacio Day", type: "regular" },
    { date: "2026-12-25", name: "Christmas Day", type: "regular" },
];

const HOUR_MS = 3_600_000;
const intervalsOn = (anchor, spans) =>
    (spans ?? []).map(([from, to]) => ({
        start: anchor + from * HOUR_MS,
        end: anchor + to * HOUR_MS,
    }));
const minutesOf = (intervals) =>
    intervals.reduce((sum, interval) => sum + (interval.end - interval.start) / 60_000, 0);

const EPSILON = 1e-6;

function sameValue(actual, expected) {
    if (typeof expected === "number" && typeof actual === "number") {
        return Math.abs(actual - expected) <= EPSILON;
    }
    if (Array.isArray(expected)) {
        if (!Array.isArray(actual) || actual.length !== expected.length) return false;
        return expected.every((item, index) => sameValue(actual[index], item));
    }
    if (expected !== null && typeof expected === "object") {
        if (actual === null || typeof actual !== "object") return false;
        const keys = Object.keys(expected);
        return keys.every((key) => sameValue(actual[key], expected[key]));
    }
    return actual === expected;
}

const ms = (dateKey) => calendar.msOfDateKey(dateKey);

/** Each handler returns the object that the fixture's `expect` is matched against. */
const handlers = {

    readiness(input) {
        const report = readinessLib.readinessReport(input.items);
        return {
            ready: report.ready,
            blockers: report.blockers.length,
            warnings: report.warnings.length,
            blockerCount: report.blockerCount,
            firstBlocker: report.blockers[0]?.id ?? null,
            loanFits: readinessLib.loanFitsNet({
                netCentavos: input.netCentavos ?? 0,
                scheduledCentavos: input.scheduledCentavos ?? 0,
            }),
        };
    },

    leave(input) {
        const STANDARD = leaveLib.STANDARD_LEAVE_TYPES;
        // Only the ops that are about a TYPE need one resolved.
        const type =
            input.op === "balance" ? null : leaveLib.findLeaveType(STANDARD, input.type);
        if (input.op !== "balance" && !type) throw new Error(`unknown leave type ${input.type}`);
        if (input.op === "accrual") {
            return { days: leaveLib.periodAccrual(type, input.serviceMonths ?? 0) };
        }
        if (input.op === "yearTotal") {
            const per = leaveLib.periodAccrual(type, input.serviceMonths ?? 0);
            const residue = leaveLib.annualResidue(type, input.periods, input.serviceMonths ?? 0);
            return { days: leaveLib.roundDays(per * input.periods + residue) };
        }
        if (input.op === "balance") {
            return {
                days: leaveLib.leaveBalance({
                    accruedDays: input.accrued,
                    usedDays: input.used,
                    adjustedDays: input.adjusted,
                }),
            };
        }
        if (input.op === "convert") {
            const days = leaveLib.convertibleDays(type, input.balance);
            return { centavos: leaveLib.conversionCentavos(days, input.dailyCentavos) };
        }
        throw new Error(`unknown leave op ${input.op}`);
    },

    yearEnd(input) {
        const brackets = input.brackets;
        const rows = input.rows.map((row) => ({ tin: "", thirteenthMonthCentavos: 0, ...row }));
        const certs = yearEndLib.build2316(rows, brackets);
        const totals = yearEndLib.alphalistTotals(certs);
        const csv = yearEndLib.renderAlphalist(
            {
                tin: input.orgTin ?? "000-000-000-000",
                branchCode: "",
                registeredName: input.registeredName ?? "Test Corp",
                year: input.year,
                tableVersion: input.tableVersion ?? "tax@2026-01-01",
            },
            certs,
        );
        const preflight = yearEndLib.alphalistPreflight({
            withheldCentavos: totals.withheldCentavos,
            remittedCentavos: input.remittedCentavos ?? totals.withheldCentavos,
        });
        const carry = yearEndLib.carryForward(input.carry ?? { accruedCentavos: 0, paidCentavos: 0, carriedCentavos: 0 });
        const first = certs[0];
        return {
            taxDue: first.taxDueCentavos,
            taxable: first.taxableCentavos,
            trueUp: first.trueUpCentavos,
            withheld: totals.withheldCentavos,
            taxDueTotal: totals.taxDueCentavos,
            grossTotal: totals.grossCentavos,
            nonTaxableTotal: totals.nonTaxableCentavos,
            preflightOk: preflight.ok,
            preflightDifference: preflight.differenceCentavos,
            preflightMessage: preflight.message,
            carryOk: carry.ok,
            carryUnexplained: carry.unexplainedCentavos,
            csvHasVersion: csv.includes(input.tableVersion ?? "tax@2026-01-01"),
            csvHeaderTin: csv.startsWith(`${input.orgTin ?? "000-000-000-000"}`),
            csvHasTotals: csv.includes(`TOTAL (${certs.length})`),
        };
    },

    govBucket(input) {
        const ids = input.payslipIds;
        const buckets = govForms.bucketLines(ids, input.lines);
        const first = buckets[ids[0]];
        // The four schedules built from the same buckets, so a fixture can prove the
        // forms reconcile to the register's own lines rather than to each other.
        const row = (id, ref, extra) => ({
            employeeId: id,
            name: `Employee ${id}`,
            reference: ref,
            employeeCentavos: buckets[id].sss,
            employerCentavos: buckets[id].sssEr,
            extraCentavos: buckets[id].ec,
            loanCentavos: buckets[id].sssLoan,
            ...extra,
        });
        const sssRows = ids.map((id) => row(id, "x", {}));
        const r3 = govForms.buildR3({ rows: sssRows, tableVersion: "sss@2026-01-01", periodLabel: "p" });
        const rf1 = govForms.buildRf1({
            rows: ids.map((id) => ({ employeeId: id, name: `Employee ${id}`, reference: "",
                employeeCentavos: buckets[id].phic, employerCentavos: buckets[id].phicEr })),
            tableVersion: "ph@2026-01-01", periodLabel: "p",
        });
        const mcrf = govForms.buildMcrf({
            rows: ids.map((id) => ({ employeeId: id, name: `Employee ${id}`, reference: "",
                employeeCentavos: buckets[id].hdmf, employerCentavos: buckets[id].hdmfEr })),
            tableVersion: "hdmf@2026-01-01", periodLabel: "p",
        });
        const c1601 = govForms.build1601C({
            rows: ids.map((id) => ({ employeeId: id, name: `Employee ${id}`, reference: "",
                employeeCentavos: buckets[id].tax, employerCentavos: 0,
                grossCentavos: buckets[id].gross, taxableCentavos: buckets[id].taxable })),
            tableVersion: "tax@2026-01-01", periodLabel: "p",
        });
        const sum = (pick) => ids.reduce((total, id) => total + pick(buckets[id]), 0);
        return {
            gross: first.gross,
            taxable: first.taxable,
            memoIgnored: first.gross,
            sssLoan: first.sssLoan,
            sssEr: first.sssEr,
            ec: first.ec,
            r3Employee: r3.totals.employeeCentavos,
            r3Employer: r3.totals.employerCentavos,
            r3Extra: r3.totals.extraCentavos,
            r3Loan: r3.totals.loanCentavos,
            rf1Premium: rf1.totals.employeeCentavos + rf1.totals.employerCentavos,
            mcrfTotal: mcrf.totals.employeeCentavos + mcrf.totals.employerCentavos,
            tax1601: c1601.totals.employeeCentavos,
            registerGross: sum((b) => b.gross),
            registerTaxable: sum((b) => b.taxable),
            registerSss: sum((b) => b.sss),
            registerSssEr: sum((b) => b.sssEr),
            registerEc: sum((b) => b.ec),
            registerSssLoan: sum((b) => b.sssLoan),
            registerPhic: sum((b) => b.phic),
            registerPhicEr: sum((b) => b.phicEr),
            registerHdmf: sum((b) => b.hdmf),
            registerHdmfEr: sum((b) => b.hdmfEr),
            registerTax: sum((b) => b.tax),
        };
    },

    govForm(input) {
        const build = {
            r3: govForms.buildR3,
            rf1: govForms.buildRf1,
            mcrf: govForms.buildMcrf,
            "1601c": govForms.build1601C,
        }[input.form];
        if (!build) throw new Error(`unknown form ${input.form}`);
        const args = {
            rows: input.rows,
            tableVersion: input.tableVersion ?? "sss@2026-01-01",
            periodLabel: input.periodLabel ?? "2026-11-16 to 2026-11-30",
        };
        if (input.mscByEmployee) args.mscByEmployee = input.mscByEmployee;
        if (input.fundSalaryByEmployee) args.fundSalaryByEmployee = input.fundSalaryByEmployee;
        const form = build(args);
        const csv = govForms.renderFormCsv(form);
        return {
            rows: form.rows.length,
            employee: form.totals.employeeCentavos,
            employer: form.totals.employerCentavos,
            extra: form.totals.extraCentavos,
            loan: form.totals.loanCentavos,
            gross: form.totals.grossCentavos,
            taxable: form.totals.taxableCentavos,
            columns: form.columns.join(" | "),
            versionStamped: csv.includes(form.tableVersion),
            notes: form.notes.length,
            filename: govForms.formFilename(form, "run1-v1"),
            firstRow: form.rows[0]?.join(" | ") ?? "",
            csvQuotedComma: csv.includes('"Reyes, Ana"'),
        };
    },
    dailyRate({ terms }) {
        const result = {
            dailyCentavos: rates.dailyRateCentavos(terms),
            hourlyCentavos: rates.hourlyRateCentavos(terms),
        };
        // `derivation` is the payslip-footer string D7 requires; only assert it
        // when the fixture states it (it is prose, so exact match is the point).
        result.derivation = rates.rateDerivation(terms);
        return result;
    },

    periodBasicPay(input) {
        const args = {
            terms: input.terms,
            periodStart: ms(input.periodStart),
            periodEnd: ms(input.periodEnd),
        };
        if (input.employmentStart) args.employmentStart = ms(input.employmentStart);
        if (input.employmentEnd) args.employmentEnd = ms(input.employmentEnd);
        return { centavos: rates.periodBasicPay(args) };
    },

    prorate({ amountCentavos, portion, whole }) {
        return { centavos: rates.prorate(amountCentavos, portion, whole) };
    },

    allowanceTotal({ allowances, storedTotalPesos }) {
        const outcome = rates.allowanceTotalMismatch(allowances, storedTotalPesos);
        return { recomputed: outcome.recomputed, matches: outcome.matches };
    },

    resolve({ position, settings }) {
        const outcome = rates.resolvePayTerms({ position, settings });
        return {
            payType: outcome.terms.payType,
            basicRate: outcome.terms.basicRate,
            dailyRateBasis: outcome.terms.dailyRateBasis,
            workWeek: outcome.terms.workWeek,
            statutoryBasis: outcome.terms.statutoryBasis,
            issueCount: outcome.issues.length,
        };
    },

    classify({ date, workWeek }, holidays) {
        const anchor = ms(date);
        const holiday = calendar.holidayOn(anchor, holidays);
        return {
            dayType: calendar.classifyDay(anchor, holidays),
            isRestDay: calendar.isRestDay(anchor, workWeek),
            holidayName: holiday ? holiday.name : null,
        };
    },

    workDays({ start, end, workWeek }) {
        return { days: calendar.workDaysInRange(ms(start), ms(end), workWeek) };
    },

    dateKeyRoundTrip({ date }) {
        return { key: calendar.dateKeyOf(ms(date)) };
    },

    dateKeyOfInstant({ instant }) {
        return { key: calendar.dateKeyOf(Date.parse(instant)) };
    },

    taxSemiMonthly({ taxableCutoffPesos, annualBrackets }) {
        return { pesos: tax.semiMonthlyTaxPesos(taxableCutoffPesos, annualBrackets) };
    },

    taxInvariance({ taxableCutoffPesos, annualBrackets }) {
        const semi = tax.semiMonthlyTaxPesos(taxableCutoffPesos, annualBrackets);
        const annualised =
            tax.annualTaxPesos(taxableCutoffPesos * tax.CUTOFFS_PER_YEAR, annualBrackets) /
            tax.CUTOFFS_PER_YEAR;
        // Both sides round to 2dp, so equality is to the centavo, not to the float.
        return { equal: Math.abs(semi - annualised) < 0.005 };
    },

    taxBracketSlices({ annualBrackets }) {
        const slices = tax.semiMonthlyBrackets(annualBrackets);
        return {
            count: slices.length,
            bases: slices.map((slice) => Number(slice.base.toFixed(6))),
            lastTo: slices[slices.length - 1].to,
        };
    },

    priceDay({ terms, date, intervals, dayType, isRestDay, priorDayWorked }) {
        const anchor = calendar.msOfDateKey(date);
        const spans = intervalsOn(anchor, intervals);
        const priced = premiums.priceDay({
            date: anchor,
            totalMinutes: minutesOf(spans),
            intervals: spans,
            classification: { dayType, isRestDay },
            terms,
            priorDayWorked: priorDayWorked === true,
        });
        const pairs = priced.lines
            .map((line) => [line.code, line.amount])
            .sort((a, b) => (a[0] < b[0] ? -1 : 1));
        return {
            codes: pairs.map((pair) => pair[0]),
            amounts: pairs.map((pair) => pair[1]),
            workedMinutes: priced.workedMinutes,
            otMinutes: priced.otMinutes,
            nightMinutes: priced.nightMinutes,
        };
    },

    nightMinutes({ date, intervals }) {
        const anchor = calendar.msOfDateKey(date);
        return { minutes: premiums.nightMinutes(intervalsOn(anchor, intervals)) };
    },

    computePayslip({
        terms,
        period,
        entries,
        deminimis,
        tables,
        cutoffIndex,
        employmentStart,
        employmentEnd,
        loans,
        thirteenthMonth,
        separation,
        leave,
    }) {
        const startDate = calendar.msOfDateKey(period.start);
        const endDate = calendar.msOfDateKey(period.end);
        const days = (entries ?? []).map((entry) => {
            const anchor = calendar.msOfDateKey(entry.date);
            const spans = intervalsOn(anchor, entry.intervals);
            return {
                entryId: `fixture-${entry.date}`,
                date: anchor,
                totalMinutes: minutesOf(spans),
                intervals: spans,
                status: "approved",
            };
        });
        const result = engine.computePayslip({
            employee: { id: "fixture", name: "Fixture" },
            profile: terms,
            days,
            holidayTable: FIXTURE_HOLIDAYS,
            tables: { deminimis, ...(tables ?? {}) },
            adjustments: [],
            loans,
            thirteenthMonth: thirteenthMonth
                ? { ...thirteenthMonth, isPayoutRun: thirteenthMonth.isPayoutRun === true }
                : undefined,
            separation: separation
                ? {
                      lastDay: calendar.msOfDateKey(separation.lastDay),
                      reason: separation.reason,
                      silDaysUnpaid: separation.silDaysUnpaid,
                      yearsOfService: separation.yearsOfService,
                  }
                : undefined,
            leave: leave
                ? { paidDates: leave.paidDates.map((date) => calendar.msOfDateKey(date)) }
                : undefined,
            period: {
                startDate,
                endDate,
                payDate: endDate,
                isYearEnd: false,
                cutoffIndex: cutoffIndex === 1 ? 1 : 0,
            },
            employment: {
                start: employmentStart ? calendar.msOfDateKey(employmentStart) : undefined,
                end: employmentEnd ? calendar.msOfDateKey(employmentEnd) : undefined,
            },
        });
        // Only EARNING codes: memo lines (rate derivation, statutory basis) are
        // documentation, not money, and asserting on them hides a missing earning.
        const codes = [
            ...new Set(
                result.lines.filter((line) => line.kind === "earning").map((line) => line.code),
            ),
        ].sort();
        const deductionCodes = [
            ...new Set(
                result.lines
                    .filter((line) => line.kind === "deduction")
                    .map((line) => line.code),
            ),
        ].sort();
        const memoCodes = [
            ...new Set(
                result.lines.filter((line) => line.kind === "memo").map((line) => line.code),
            ),
        ].sort();
        return {
            codes,
            memoCodes,
            deductionCodes,
            thirteenthAccrual: result.thirteenthMonthAccrualCentavos ?? 0,
            thirteenthPayout: result.thirteenthMonthPayoutCentavos ?? 0,
            loanPayments: (result.loanPayments ?? []).length,
            silPaid: result.lines.some((line) => line.code === "SIL_CONVERSION"),
            mscPesos: result.mscPesos ?? 0,
            gross: result.gross,
            totalDeductions: result.totalDeductions,
            net: result.net,
            absentDays: Number((result.absentDays ?? 0).toFixed(4)),
            blocked: result.blocked?.code ?? null,
            lines: result.lines.length,
        };
    },

    msc({ basePesos, table }) {
        return { msc: statutory.monthlySalaryCredit(basePesos, table) };
    },

    sss({ baseCentavos, table }) {
        const result = statutory.sssContributions(baseCentavos, table);
        return {
            msc: result.mscPesos,
            mpfMsc: result.mpfMscPesos,
            employee: result.employeeCentavos,
            employer: result.employerCentavos,
            ec: result.ecCentavos,
        };
    },

    philhealth({ baseCentavos, table }) {
        const result = statutory.philhealthContributions(baseCentavos, table);
        return {
            base: result.basePesos,
            employee: result.employeeCentavos,
            employer: result.employerCentavos,
        };
    },

    pagibig({ baseCentavos, table }) {
        const result = statutory.pagibigContributions(baseCentavos, table);
        return {
            base: result.basePesos,
            employee: result.employeeCentavos,
            employer: result.employerCentavos,
        };
    },

    splitCutoff({ monthlyCentavos, cutoffIndex }) {
        return {
            centavos: statutory.splitMonthlyAcrossCutoffs(
                monthlyCentavos,
                cutoffIndex === 1 ? 1 : 0,
            ),
        };
    },

    withholding({ taxableCentavos, table }) {
        return {
            centavos: tax.withholdingCentavos(taxableCentavos, table.annualBrackets),
        };
    },

    annualise({ ytdTaxableCentavos, ytdWithheldCentavos, periodTaxableCentavos, periodWithheldCentavos, table }) {
        const result = tax.annualise({
            ytdTaxableCentavos,
            ytdWithheldCentavos,
            periodTaxableCentavos,
            periodWithheldCentavos,
            annualBrackets: table.annualBrackets,
        });
        return {
            annualTax: result.annualTaxCentavos,
            withheld: result.withheldCentavos,
            trueUp: result.trueUpCentavos,
        };
    },

    sha256({ text }) {
        return { hex: sha256.sha256Hex(text) };
    },

    bankFile({ layoutId, runId, version, rows }) {
        const layout = bankFiles.BANK_LAYOUTS.find((entry) => entry.id === layoutId);
        if (!layout) return { filename: null, content: null, rowCount: null, total: null };
        const result = bankFiles.renderBankFile({ layout, rows, runId, version });
        return {
            filename: result.filename,
            content: result.content,
            rowCount: result.rowCount,
            total: result.total,
            verified: result.layout.verified,
            // The hash must be the hash of the bytes actually produced.
            shaMatches: result.sha256 === sha256.sha256Hex(result.content),
        };
    },

    registerCsv({ rows }) {
        return { content: bankFiles.renderRegisterCsv(rows) };
    },

    accrual({ basicEarnedCentavos }) {
        return { centavos: thirteenth.accrualForPeriod({ basicEarnedCentavos }) };
    },

    accrualYear({ perCutoffCentavos, cutoffs }) {
        let total = 0;
        for (let index = 0; index < cutoffs; index += 1) {
            total += thirteenth.accrualForPeriod({ basicEarnedCentavos: perCutoffCentavos });
        }
        return { totalCentavos: total };
    },

    accrualYearBound({ perCutoffCentavos, cutoffs }) {
        let total = 0;
        for (let index = 0; index < cutoffs; index += 1) {
            total += thirteenth.accrualForPeriod({ basicEarnedCentavos: perCutoffCentavos });
        }
        const exact = (perCutoffCentavos * cutoffs) / 12;
        // The stated rule allows up to half a centavo of error per period.
        return { within12Cents: Math.abs(total - exact) <= cutoffs / 2 };
    },

    payoutSplit(input) {
        return thirteenth.payoutSplit(input);
    },

    instalments({ principalCentavos, termMonths }) {
        const list = thirteenth.equalInstalments({ principalCentavos, termMonths });
        return {
            first: list[0],
            count: list.length,
            last: list[list.length - 1],
            sum: list.reduce((total, value) => total + value, 0),
        };
    },

    planLoans({ availableCentavos, loans }) {
        const plan = loansLib.planLoanPayments({ loans, availableCentavos });
        const paid = plan.payments.reduce((total, payment) => total + payment.amountCentavos, 0);
        return {
            order: plan.payments.map((payment) => payment.loanId),
            paid,
            remaining: availableCentavos - paid,
            blocked: plan.blocked?.code ?? null,
        };
    },

    engineSkeleton() {
        const result = engine.computePayslip({});
        return {
            blocked: result.blocked?.code ?? null,
            gross: result.gross,
            net: result.net,
            lines: result.lines.length,
        };
    },
};

let passed = 0;
const failures = [];

function runCase(file, fixture, testCase) {
    const holidays = (fixture.holidays ?? []).map((holiday) => ({ ...holiday }));
    const handler = handlers[testCase.kind];
    if (!handler) {
        failures.push(`${file} / ${testCase.name}: unknown fixture kind "${testCase.kind}"`);
        return;
    }

    let outcome;
    let thrown;
    try {
        outcome = handler(testCase.input ?? {}, holidays);
    } catch (error) {
        thrown = error;
    }

    if (testCase.expectError) {
        if (!thrown) {
            failures.push(`${file} / ${testCase.name}: expected an error, but it returned ${JSON.stringify(outcome)}`);
            return;
        }
        if (!String(thrown.message).includes(testCase.expectError)) {
            failures.push(`${file} / ${testCase.name}: error "${thrown.message}" does not mention "${testCase.expectError}"`);
            return;
        }
        passed += 1;
        console.log(`  ok   ${testCase.name}`);
        return;
    }

    if (thrown) {
        failures.push(`${file} / ${testCase.name}: threw ${thrown.message}`);
        return;
    }

    const mismatches = Object.entries(testCase.expect).filter(
        ([key, expected]) => !sameValue(outcome[key], expected),
    );
    if (mismatches.length > 0) {
        const detail = mismatches
            .map(([key, expected]) => `${key}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(outcome[key])}`)
            .join("; ");
        failures.push(`${file} / ${testCase.name}: ${detail}`);
        return;
    }

    passed += 1;
    console.log(`  ok   ${testCase.name}`);
}

for (const file of ["rates.json", "calendar.json", "premiums.json", "statutory.json", "artefacts.json", "p5.json", "p6.json", "p7.json", "p8.json", "p9.json"]) {
    const fixture = JSON.parse(readFileSync(join(fixturesDir, file), "utf8"));
    console.log(`\n${file} — ${fixture.description}`);
    for (const testCase of fixture.cases) runCase(file, fixture, testCase);
}

const total = passed + failures.length;
console.log(`\n${passed}/${total} checks passed`);
if (failures.length > 0) {
    console.error("\nFAILURES");
    for (const failure of failures) console.error(`  FAIL ${failure}`);
    process.exit(1);
}
console.log("PASS — payroll fixtures green");
