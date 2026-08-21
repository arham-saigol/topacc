/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as admin from "../admin.js";
import type * as checkouts from "../checkouts.js";
import type * as crons from "../crons.js";
import type * as entries from "../entries.js";
import type * as http from "../http.js";
import type * as payments from "../payments.js";
import type * as profiles from "../profiles.js";
import type * as profiles_fetch from "../profiles_fetch.js";
import type * as rateLimiter from "../rateLimiter.js";
import type * as seed from "../seed.js";
import type * as shared from "../shared.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  admin: typeof admin;
  checkouts: typeof checkouts;
  crons: typeof crons;
  entries: typeof entries;
  http: typeof http;
  payments: typeof payments;
  profiles: typeof profiles;
  profiles_fetch: typeof profiles_fetch;
  rateLimiter: typeof rateLimiter;
  seed: typeof seed;
  shared: typeof shared;
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

export declare const components: {
  rateLimiter: import("@convex-dev/rate-limiter/_generated/component.js").ComponentApi<"rateLimiter">;
};
