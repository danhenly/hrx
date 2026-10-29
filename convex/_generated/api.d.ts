/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as actions from "../actions.js";
import type * as audit from "../audit.js";
import type * as auth from "../auth.js";
import type * as employees from "../employees.js";
import type * as helpers from "../helpers.js";
import type * as http from "../http.js";
import type * as invitations from "../invitations.js";
import type * as lib_intervals from "../lib/intervals.js";
import type * as lib_payroll_calendar from "../lib/payroll/calendar.js";
import type * as lib_payroll_engine from "../lib/payroll/engine.js";
import type * as lib_payroll_premiums from "../lib/payroll/premiums.js";
import type * as lib_payroll_rates from "../lib/payroll/rates.js";
import type * as lib_payroll_tax from "../lib/payroll/tax.js";
import type * as lib_payroll_types from "../lib/payroll/types.js";
import type * as lib_week from "../lib/week.js";
import type * as organizations from "../organizations.js";
import type * as payroll_allowanceTypes from "../payroll/allowanceTypes.js";
import type * as payroll_backfillPayTerms from "../payroll/backfillPayTerms.js";
import type * as payroll_employeeStatutoryIds from "../payroll/employeeStatutoryIds.js";
import type * as payroll_previewPayslip from "../payroll/previewPayslip.js";
import type * as payroll_seedStatutory from "../payroll/seedStatutory.js";
import type * as payroll_settings from "../payroll/settings.js";
import type * as payroll_statutorySeed from "../payroll/statutorySeed.js";
import type * as payroll_statutoryTables from "../payroll/statutoryTables.js";
import type * as payroll_testData from "../payroll/testData.js";
import type * as positions from "../positions.js";
import type * as timeEntries from "../timeEntries.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  actions: typeof actions;
  audit: typeof audit;
  auth: typeof auth;
  employees: typeof employees;
  helpers: typeof helpers;
  http: typeof http;
  invitations: typeof invitations;
  "lib/intervals": typeof lib_intervals;
  "lib/payroll/calendar": typeof lib_payroll_calendar;
  "lib/payroll/engine": typeof lib_payroll_engine;
  "lib/payroll/premiums": typeof lib_payroll_premiums;
  "lib/payroll/rates": typeof lib_payroll_rates;
  "lib/payroll/tax": typeof lib_payroll_tax;
  "lib/payroll/types": typeof lib_payroll_types;
  "lib/week": typeof lib_week;
  organizations: typeof organizations;
  "payroll/allowanceTypes": typeof payroll_allowanceTypes;
  "payroll/backfillPayTerms": typeof payroll_backfillPayTerms;
  "payroll/employeeStatutoryIds": typeof payroll_employeeStatutoryIds;
  "payroll/previewPayslip": typeof payroll_previewPayslip;
  "payroll/seedStatutory": typeof payroll_seedStatutory;
  "payroll/settings": typeof payroll_settings;
  "payroll/statutorySeed": typeof payroll_statutorySeed;
  "payroll/statutoryTables": typeof payroll_statutoryTables;
  "payroll/testData": typeof payroll_testData;
  positions: typeof positions;
  timeEntries: typeof timeEntries;
  users: typeof users;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
