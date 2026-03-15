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
import type * as auth from "../auth.js";
import type * as employees from "../employees.js";
import type * as helpers from "../helpers.js";
import type * as http from "../http.js";
import type * as invitations from "../invitations.js";
import type * as organizations from "../organizations.js";
import type * as timeEntries from "../timeEntries.js";
import type * as timesheets from "../timesheets.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  actions: typeof actions;
  auth: typeof auth;
  employees: typeof employees;
  helpers: typeof helpers;
  http: typeof http;
  invitations: typeof invitations;
  organizations: typeof organizations;
  timeEntries: typeof timeEntries;
  timesheets: typeof timesheets;
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
