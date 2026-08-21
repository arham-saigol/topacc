# topacc.lol — Full App Build Plan

## Goal

Build and launch **topacc.lol**: a paid leaderboard where anyone spends money to rank X (Twitter) accounts. The account with the highest cumulative paid total is #1 ("the most valued account on X, decided by money"). Domain `topacc.lol` is already purchased. This plan covers the complete Phase 1 (launch) build: frontend, backend, payments, deployment, and seeding.

The implementing agent has no prior conversation context — everything needed is below.

---

## Product concept & context

- Inspired by outbid.lol (a paid link leaderboard), but the entries are **X profiles**, not links or videos. Buyers are X creators/builders who want clout, profile visits, and the flex of a high rank; every bidder has an audience to share their rank with.
- There are **no user accounts**. Identity = the X handle being ranked + email captured by the payment provider. Nobody logs in.
- Money mechanics are the entire product. Keep the site dead simple: one page, one job.

### Locked product decisions (authoritative)

| Decision | Value |
|---|---|
| Entry type | X profiles only |
| Currency | USD, all amounts stored in **cents** |
| Min bid | **$5.00** |
| Increment | **$5.00 only** — every payment is a multiple of 500 cents |
| Ranking | `totalCents DESC`; tie broken by **earlier** `lastBidAt` (first to reach a total holds the rank; you must strictly exceed to take it) |
| Duplicate handles | Impossible — one entry per canonical handle forever. Paying toward an existing handle = "boost" that adds to its total |
| Entry content | All displayed info is fetched from the live X profile: avatar, display name, @handle, bio truncated to one line. The **only** user input is the @handle + money |
| Profile data source | Avatars: unavatar.io (free, verified working). Display name/bio: **XQuik** (`https://xquik.com/api/v1/x/users/{handle}`, prepaid credits) — no free source exists; cached in Convex, graceful fallback to avatar + @handle when key unset/credits exhausted |
| Moderation | **None.** No filters, no review queue. |
| Auth | None anywhere |

---

## Architecture & stack

- **Frontend:** Next.js 16 (App Router, TypeScript, Tailwind CSS), deployed on **Vercel**.
- **Backend/DB:** **Convex** — database, realtime subscriptions (`useQuery`; the board live-updates in all open tabs with no polling), scheduled jobs, HTTP actions for webhooks, and the official `@convex-dev/rate-limiter` component for rate limiting.
- **Payments:** **Creem.io** (Merchant of Record). One product: **"$5 Bid Credit"**, one-time, $5.00. Larger bids are charged as `units = amountCents / 500` on that single product.
- **Avatars:** `https://unavatar.io/x/{handle}`, fetched server-side and cached in a Convex table with ~7-day TTL. Letter-avatar fallback rendered client-side when unavailable. Never call the official X API. Never let users type display names — cards render the canonical handle and link to `x.com/{handle}`.
- **No other services.** No Redis, no Postgres, no email (Phase 1.5), no auth provider.

### Environment variables

```
CREEM_API_KEY            # creem_test_... during development, creem_live_... for prod
CREEM_PRODUCT_ID         # the $5 one-time product id (prod_...)
CREEM_WEBHOOK_SECRET     # used to verify webhook signature (per current docs.creem.io webhook docs)
ADMIN_PASSWORD           # for the hidden /admin route
NEXT_PUBLIC_CONVEX_URL   # from convex dev/deploy
XQUIK_API_KEY            # optional: xq_... prepaid key (dashboard.xquik.com); unset = name/bio stay null, cards show avatar + @handle
```

---

## Data model (Convex schema)

```ts
entries: defineTable({
    handle: string,          // canonical: lowercased, no @, ^[A-Za-z0-9_]{1,15}$
    totalCents: number,
    bidCount: number,
    clickCount: number,
    status: string,          // "active" | "removed"
    createdAt: number,
    lastBidAt: number,
  })
  .index("by_handle", ["handle"])                 // enforce uniqueness in logic
  .index("by_status_total", ["status", "totalCents"])

payments: defineTable({
    entryId: id("entries"),
    amountCents: number,     // always a multiple of 500, >= 500
    units: number,           // amountCents / 500
    status: string,          // "pending" | "paid" | "expired" | "refunded"
    checkoutId: optional(string),
    orderId: optional(string),
    eventId: optional(string),   // unique — webhook idempotency
    customerEmail: optional(string), // from Creem webhook; needed for Phase 1.5 emails
    createdAt: number,
    paidAt: optional(number),
  })
  .index("by_entry", ["entryId"])
  .index("by_event_id", ["eventId"])
  .index("by_status_created", ["status", "createdAt"])

profileCache: defineTable({
    handle: string,          // canonical
    avatarUrl: optional(string),
    displayName: optional(string),
    bio: optional(string),    // rendered truncated to one line
    verified: optional(boolean), // X verified badge
    fetchedAt: number,       // refetch if older than 7 days
  }).index("by_handle", ["handle"])
```

Uniqueness of `entries.handle` must be enforced inside the mutation (transactional read-then-insert is safe in Convex's serializable transactions).

---

## Core logic

### Canonicalization
Strip leading `@`, trim, lowercase, validate `^[A-Za-z0-9_]{1,15}$`. Reject anything else. All lookups/dedup use the canonical form.

### Claim-rank pricing (displayed on every row and in the claim bar)
- Let `rankN_total` = current total of the entry holding rank N.
- **New entrant:** price = smallest multiple of 500 cents that is **strictly greater than** `rankN_total`.
- **Existing entrant boosting:** price = `ceil((rankN_target − myTotal) / 500) × 500`, minimum 500. If the target is beating rank N already, show their current rank instead.
- Rank N for these formulas: N=1 for the claim bar; each list row shows its own N.
- Cap any single checkout at **$25,000** (reject above). UI requires a confirm step for any bid over **$500**.

### Payment flow (Creem)
1. Client submits `{handle, amountCents}` to a Convex **mutation**:
   - Validate amount (multiple of 500, ≥ 500, ≤ 25,000_00).
   - Canonicalize handle; find or create the entry (creation and boosting are the same operation apart from entry creation).
   - Insert `payments` row with `status: "pending"`.
   - Rate-limit via `@convex-dev/rate-limiter`: **max 3 pending checkouts per IP per hour** (pass client IP from the request context).
2. A Convex **action** then calls Creem's create-checkout API:
   - `product_id: CREEM_PRODUCT_ID`, `units: amountCents / 500`, `request_id: paymentRowId`, `success_url: https://topacc.lol/success?ref={paymentRowId}`, metadata containing the payment row id.
   - Patch the payment row with the returned `checkoutId`; return `checkoutUrl` to the client.
   - (Convex actions cannot mutate directly — sequence mutation → action → patch, or use the documented action-write patterns.)
3. User pays on Creem's hosted checkout.
4. **Webhook** (`checkout.paid`) arrives at a Convex `httpAction` registered in `convex/http.ts`:
   - Verify the signature per current Creem docs (`docs.creem.io/code/webhooks`) using `CREEM_WEBHOOK_SECRET`. Reject invalid signatures with 400.
   - Idempotency: upsert-by unique `eventId` — if the event/order was already processed, return 200 and do nothing.
   - Mark the payment `paid` (`paidAt: now`), add `amountCents` to the entry's `totalCents`, increment `bidCount`, set `lastBidAt: now`. All in one transaction so concurrent webhooks can't corrupt totals.
   - After marking paid: if the entry's `profileCache` row is missing/stale, schedule profile enrichment (XQuik lookup) via `ctx.scheduler` so the webhook responds fast and enrichment failures can't affect payment handling.
5. `/success?ref=` polls the payment status via a query until `paid` (covers webhook latency; usually seconds).
6. **Expiry:** when creating a pending payment, schedule `ctx.scheduler.runAt(+24h, expirePayment, paymentId)`; it flips `pending → expired` only if still unpaid. Expired payments never affect the board.

### Refund/chargeback handling
If Creem signals a refund/dispute event, mark the payment `refunded` and subtract `amountCents` from the entry total (floor at 0). Minimal implementation is acceptable but the subtraction path must exist.

### Profile data (avatar, name, bio)
Everything displayed about an account is fetched, never typed by users..

Implementation:
- Avatar: server-side fetch of `https://unavatar.io/x/{handle}`, cached in `profileCache`. (Free, no key.)
- Display name + bio + verified: **XQuik** — base URL `https://xquik.com/api/v1`, auth header `x-api-key: xq_...` (prepaid key from dashboard.xquik.com). Call `GET /x/users/{canonicalHandle}`; map response fields `name` → `displayName`, `description` → `bio`, `verified` → `verified` (absent → store nulls). Handle `401`/`402`/`429` by keeping existing cached values and leaving nulls otherwise — lookup failures must never surface to users.
- Fetch timing: **never at submission/preview time** (typing previews use only free unavatar.io). The first XQuik call fires when a handle's **first payment is confirmed** (webhook `paid` path) — until then the card intentionally shows avatar + @handle only. Refetch only when `profileCache.fetchedAt` is older than ~7 days AND the entry is currently displayed (top pages). With caching, volume stays in the hundreds/month — trivial against prepaid credits.
- Store results (or nulls) in `profileCache`. Missing fields simply don't render — a card showing only avatar + @handle is valid and is the default state before any provider is configured. Never block submission or rendering on these fetches.
- Since nothing user-authored except the handle is ever displayed, there is no impersonation or moderation surface.

### Click tracking
Profile-card links route through a Convex `httpAction` like `/api/c/{entryId}` that increments `clickCount` transactionally, then 302-redirects to `x.com/{handle}`.

---

## UI spec

### `/` — the entire product (single page)
1. **Claim bar** (sticky top): "Claim top acc for $X" where X = computed price to beat #1, plus an amount input (snaps to $5 multiples) and CTA button opening the bid modal.
2. **#1 hero card:** large avatar, display name + @handle with **blue verified checkmark when `verified === true`** (links via click tracker), bio truncated to one line — mirroring an X profile row — plus total, time since last bid, click count, "claim this rank for $Y" button.
3. **List rows #2–#9** (visible above the fold): compact row — avatar, display name + @handle, one-line truncated bio, total, clicks, "claim this rank for $Y" button per row.
4. **Pagination:** "Top 10 / Top 50" toggles plus numbered pages, matching the outbid.lol pattern.
5. **Activity feed:** latest payments — "@handle +$25 → now #4 · 2m ago".
6. **Revenue counter:** "This site has made $X so far" = sum of all `paid` payments. Live.
7. Everything subscribes via Convex `useQuery` — no refresh button, no polling.

**Bid modal** (opened from claim bar, hero, any row, or pagination):
- Handle input with **live avatar preview inside the box** (small thumbnail embedded in the input, like outbid.lol): debounced (~400ms) image from `https://unavatar.io/x/{handle}` rendered directly client-side — free/unkeyed, so typeahead costs nothing. Letter-avatar fallback when unresolvable.
  - **New handle:** the avatar preview doubles as the confirmation + amount stepper ($5 multiples). That's the entire form besides the handle.
  - **Existing handle:** switches to boost mode — compact card (avatar, display name, "#7 · $120"), amount stepper, single neutral button **"Add $25"**. Copy must never assume who the user is (works identically for everyone).
- Live line: "You'd land at #N".
- Confirm step for amounts over $500.
- Submit → redirect to Creem checkout URL.

### `/success?ref=`
Polls payment status; on `paid` shows the entry's new rank with share buttons (X share intent linking the `/v/{handle}` permalink).

### `/v/{handle}`
Shareable permalink for one account: full card + rank + total, with proper OG/Twitter meta tags (title like "Display Name (@handle) is #7 on topacc.lol — $120", avatar image) so shared links unfurl well on X.

### `/admin`
Hidden route behind `ADMIN_PASSWORD` (basic auth or password gate). Exactly one feature: search a handle and delete it (sets `status: "removed"`; excluded from board queries). Nothing else.

### Visual direction
Dark, bold, meme-native; crown emoji as the #1 motif is welcome. Mobile-first (most X traffic is mobile). No marketing sections, no FAQ walls, no footer bloat.

---

## Implementation steps (suggested order)

1. Scaffold Next.js 16 + TypeScript + Tailwind app; init Convex (`npx convex dev`).
2. Write the Convex schema + indexes exactly as specified above.
3. Implement queries: paginated ranked board (`by_status_total`, tie-break in JS), entry-by-handle, activity feed (recent paid payments), revenue total.
4. Implement mutations/actions: create-or-boost checkout flow, webhook `httpAction` with signature verification + idempotency, `expirePayment` scheduler, refund adjustment, click-tracker `httpAction`, avatar cache helper.
5. Install + configure `@convex-dev/rate-limiter` (3 pending checkouts / IP / hour).
6. Build UI components: ClaimBar, HeroCard, EntryRow, Pagination, ActivityFeed, RevenueCounter, BidModal (new + boost modes), letter-avatar fallback.
7. Build pages: `/`, `/success`, `/v/[handle]` with OG metadata, `/admin`.
8. Create the "$5 Bid Credit" one-time product in the Creem dashboard (test mode first); wire env vars; register the webhook URL (the Convex deployment's `httpAction` route) in Creem.
9. End-to-end test with Creem test-mode cards (see Verification).
10. Deploy: `npx convex deploy` + Vercel production; switch to live Creem keys; re-register webhook on the live URL.
11. Seed the board: 8–10 real accounts (meme pages + friends who agree to play along) at $5–$25 self-bids so the board never looks empty; cards render whatever those profiles show on X.

---

## Out of scope (do NOT build in Phase 1)

- Any content moderation (filters, queues, reports)
- User accounts, login, sessions
- Video/link/Instagram entry types (schema generalizes later; don't build it now)
- Email notifications ("you've been outbid" — Phase 1.5, will use Resend + emails already captured in `payments.customerEmail`)
- Seasons/decay mechanics, blog, API, embed widgets

---

## Verification / acceptance criteria

Test end-to-end in Creem **test mode** before going live:

1. **New entry:** submit an unused handle with a $5 test payment → after the webhook lands, the entry appears at the correct rank on the board **without refresh** (verify with two open tabs updating simultaneously).
2. **Boost:** pay toward an existing handle → its total increases, rank recomputes correctly, activity feed logs it, profile data unchanged.
3. **Claim-price math:** spot-check the claim bar and three row buttons against the formula (strictly-greater multiple of $5; boost formula for existing entrants).
4. **Idempotency:** replay the same webhook event → totals unchanged, response 200.
5. **Signature:** POST a tampered payload to the webhook endpoint → rejected.
6. **Expiry:** create a pending payment and abandon it → after expiry (temporarily shorten the 24h delay in dev) the board is unaffected and status becomes `expired`.
7. **Rate limit:** a 4th checkout attempt from the same IP within an hour is blocked with a clear error.
8. **Caps:** $25,000+ rejected; >$500 requires the confirm step.
9. **Click tracking:** clicking a card increments `clickCount` and lands on `x.com/{handle}`.
10. **Share permalink:** `/v/{handle}` renders correct OG/Twitter card tags.
11. **Admin:** deleting an entry removes it from all board views/feed immediately.
12. **Revenue counter** equals the sum of all `paid` payments.
13. **Missing profile data:** a handle whose name/bio can't be fetched still lists correctly, showing avatar + @handle only (no crash, no blank card).
14. **Enrichment timing:** typing in the bid modal updates the avatar preview live (free path only); a freshly paid entry gains name/bio/verified automatically via scheduled enrichment; verified accounts render the checkmark, unverified don't.

Launch is ready when all 12 pass on the deployed production URL with live Creem keys.
