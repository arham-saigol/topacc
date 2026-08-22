import { HOUR } from "@convex-dev/rate-limiter";
import { RateLimiter } from "@convex-dev/rate-limiter";
import { components } from "./_generated/api";

export const rateLimiter = new RateLimiter(components.rateLimiter, {
  // Max 3 checkout attempts per IP per hour (plan: pending-checkout abuse guard).
  createCheckout: { kind: "fixed window", rate: 3, period: HOUR, capacity: 3 },
  // Brute-force guard for the hidden /admin password check. Wrong guesses
  // share one small hourly budget; the correct password is never throttled.
  adminAttempt: { kind: "fixed window", rate: 3, period: HOUR, capacity: 3 },
});
