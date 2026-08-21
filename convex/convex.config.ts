import { defineApp } from "convex/server";
import rateLimiter from "@convex-dev/rate-limiter/convex.config.js";
import { v } from "convex/values";

const app = defineApp({
  env: {
    CREEM_API_KEY: v.optional(v.string()),
    CREEM_PRODUCT_ID: v.optional(v.string()),
    CREEM_WEBHOOK_SECRET: v.optional(v.string()),
    ADMIN_PASSWORD: v.optional(v.string()),
    XQUIK_API_KEY: v.optional(v.string()),
    SITE_URL: v.optional(v.string()),
  },
});
app.use(rateLimiter);

export default app;
