/** Shared backend limits. Money constants live in ../src/lib/pricing. */
export const BOARD_SCAN_CAP = 500; // ranking sorts at most this many active entries
export const TOP_PAGES_ENRICH_LIMIT = 50; // cron refreshes profiles for the displayed top N
export const PROFILE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // refetch profile data after 7 days
export const PAYMENT_TTL_MS = 24 * 60 * 60 * 1000; // pending checkouts expire after 24h
export const ACTIVITY_FETCH_MAX = 50; // bounded read for the activity feed
export const MAX_REFUND_ATTEMPTS = 10; // retry cap before flagging for manual reconciliation
