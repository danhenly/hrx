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
const [rates, calendar, tax, engine] = await Promise.all([
    load("rates.ts"),
    load("calendar.ts"),
    load("tax.ts"),
    load("engine.ts"),
]);

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

for (const file of ["rates.json", "calendar.json"]) {
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
