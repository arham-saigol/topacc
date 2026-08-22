# topacc.lol

A paid leaderboard for X (Twitter) accounts. Anyone can spend money to rank an
account; the highest cumulative total is #1 — "the most valued account on X,
decided by money."

- **Stack:** Next.js 16 + Tailwind 4 (Vercel) · Convex (DB, realtime, jobs,
  HTTP actions) · Creem.io (Merchant of Record) · unavatar.io avatars ·
  optional XQuik profile enrichment.
- **No accounts, no moderation.** The only user input is a handle + money.
- All amounts are integer **cents**; every payment is a multiple of **$5**
  (`UNIT_CENTS = 500`), capped at **$25,000** per checkout.

## Money rules (authoritative)

- Ranking: `totalCents` desc; ties break to the **earlier** `lastBidAt`
  (first to reach a total holds the rank — you must strictly exceed).
- One entry per canonical handle forever. Paying toward an existing handle
  boosts it.
- Claim price for rank N: smallest $5 multiple strictly greater than the
  holder's total. Boosts: whole $5 increments covering the gap.
- Pending checkouts expire after 24h. Refunds/disputes subtract from the
  entry's total (floored at 0). Webhooks are signature-verified and
  idempotent by event id.

## Local development

```bash
npm install
npx convex dev          # generates convex/_generated, pushes functions
npm run dev             # Next.js on :3000
```

`.env.local`:

```text
NEXT_PUBLIC_CONVEX_URL=https://<deployment>.convex.cloud
```

## Environment variables

Convex-side (set with `npx convex env set KEY value`):

| Key | Purpose |
| --- | --- |
| `CREEM_API_KEY` | `creem_test_…` uses the sandbox API automatically; `creem_live_…` hits production. |
| `CREEM_PRODUCT_ID` | The single "$5 Bid Credit" one-time product (`prod_…`). Larger bids charge `units = amountCents / 500`. |
| `CREEM_WEBHOOK_SECRET` | Signing secret for webhook verification (HMAC-SHA256 over the raw body, `creem-signature` header). |
| `ADMIN_PASSWORD` | Password gate for `/admin` (find + remove a handle). Unset = admin denied everywhere. |
| `XQUIK_API_KEY` | Optional prepaid key (dashboard.xquik.com). Unset/empty = cards show avatar + @handle only. |
| `SITE_URL` | Public site origin used for Creem `success_url`. Defaults to `https://topacc.lol`. |

Vercel-side:

| Key | Purpose |
| --- | --- |
| `NEXT_PUBLIC_CONVEX_URL` | Convex deployment URL for the React client and server-side metadata queries. |

## HTTP endpoints (on `<deployment>.convex.site`)

| Route | Behavior |
| --- | --- |
| `POST /api/checkout` | `{handle, amountCents}` → rate-limited (3/IP/hour), creates-or-boosts the entry, inserts a pending payment, creates the Creem checkout, returns `{paymentId, checkoutUrl}`. |
| `POST /api/webhooks/creem` | Verifies signature, then handles `checkout.completed` (credit entry), `refund.created` / `dispute.created` (subtract). Always 200 for valid signatures. |
| `GET /api/c/{entryId}` | Click counter → 302 to `x.com/{handle}`. |

Register the webhook URL in the Creem dashboard (Developers → Webhooks) for
both test and live modes.

## Launch checklist

1. Create the **"$5 Bid Credit"** one-time product in Creem (test mode first),
   note its `prod_…`.
2. Set all Convex env vars above; register the webhook URL in Creem test mode.
3. End-to-end test with Creem test cards: new entry, boost, replayed webhook,
   tampered payload, expiry, rate limit, click tracking, `/v/{handle}` tags.
4. `npx convex deploy` + Vercel production deploy; switch to live Creem keys;
   re-register the webhook against the live deployment URL.
5. Seed the board so it never looks empty:
   ```bash
   npx convex run seed:seedBoard '{"entries":[
     {"handle":"someacc","amountCents":2500},
     {"handle":"another","amountCents":1500}
   ]}'
   ```
   Profile data (name/bio/verified) fills in automatically via scheduled
   enrichment once paid.

## Tests

```bash
npm test        # vitest: pricing/canonicalization units + convex-test money paths
npm run typecheck
```

The convex tests cover ranking tie-breaks, boost dedup, webhook idempotency,
expiry, refund floors, per-IP rate limiting, click counting, and admin removal
(see `convex/*.test.ts`).

## Known ceilings (deliberate)

- Board ranking sorts at most 500 active entries per query
  (`BOARD_SCAN_CAP`); pagination beyond that would need keyset work.
- Rate limiting counts checkout *attempts* per IP (3/hour), not live pending
  rows — abandoned checkouts expire after 24h regardless.
- Profile enrichment refreshes hourly for the top ~50 entries only.
