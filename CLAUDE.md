@AGENTS.md

## Backend / API work

This prototype is rendered inside the Supernova mobile app via a webview. Before writing any code that hits the backend, calls `/api/*`, reads auth credentials, or interacts with the native host, read the relevant doc:

- `docs/api-web-prototypes.md` — available API routes (`/api/kv`, `/api/users/kv`, `/api/speak/scenarios/*`), request/response shapes, auth headers.
- `docs/webview-bridge.md` — how the guest receives credentials from the host (`sourceHeaders` + `bridge.getContext()`), the `getBridge` polling bootstrap, the browser-dev shim and `localStorage`/query-param fallback, full minimal prototype.
- `docs/host-spec-supernova.md` — full `Context` type returned by `bridge.getContext()`, events the host accepts (`host.close`, `device.haptic`, `navigation.*`, `webview.*`), events the host emits (`host.hardwareBack`), allowed origins.
- `docs/launching-and-testing.md` — browser-dev testing (where to get a JWT, dev-only security note) and how the mobile app actually loads the webview (full-screen Solito push vs server-driven webview tab + allowlist requirements).

Key rules for API calls from the guest:
- Read `Authorization` and `x-sn-user-id` from `bridge.getContext().auth` — do not hardcode tokens.
- Forward `ctx.app` headers (`x-sn-*` telemetry) on every fetch so backend telemetry stays continuous.
- In local browser dev, `ctx.auth` is `undefined`; fall back to `localStorage` / query param per the pattern in `docs/webview-bridge.md`.
- **Base URL correction**: `docs/api-web-prototypes.md` says `https://app.gosupernova.com`. That hostname does NOT resolve (NXDOMAIN). The live API is `https://app.gosupernova.live` (`app.getsupernova.ai` also works). Always use `app.gosupernova.live` until the doc is fixed upstream.
- **KV endpoints have no CORS**. `/api/kv/*` and `/api/users/kv/*` on `app.gosupernova.live` return no `Access-Control-*` headers, so direct browser fetches from `*.vercel.app` or `*.gosupernova.live` get blocked at preflight. To write KV from the client, go through the same-origin Next.js proxy at `app/api/kv-proxy/[key]/route.ts`. It forwards `Authorization`, `x-sn-user-id`, and all `x-sn-*` headers to the upstream KV endpoint. Pattern: client fetches `/api/kv-proxy/{encodeURIComponent(key)}`, never the cross-origin upstream directly.

Key rules for gating premium features:
- `subscription.is_active === true` is NOT "user has paid" — free-trial users have `is_active: true` and `subscription.type: "free_trial"`. Gating only on `is_active` lets trial users through.
- Require BOTH `user.is_paid === true` AND `user.subscription.is_active === true` for paid-feature access (see `docs/host-spec-supernova.md` → "Gating premium features").
- For redirecting free users to the native paywall, use `bridge.emit("navigation.open", { path: "/premium" })`. The native payment modal (`payment.showModal`) is NOT wired through the bridge as of this writing.

## Analytics / telemetry

This prototype tracks engagement and conversion through one per-user JSON blob in Supernova KV at `pr_analytics:v1`. Implementation lives in `lib/analytics.ts`.

- Call sites are already wired in `app/page.tsx`, `app/practice/page.tsx`, and `app/user-context.tsx`. The seven event types (`reel_viewed`, `reel_practice_tapped`, `practice_gated`, `premium_redirect`, `practice_started`, `practice_attempt`, `practice_completed`) cover the funnel. Don't add new events without a reason.
- `track(type, props)` queues events in memory + `sessionStorage`. Flush is debounced 2s after the last event and also fires on `visibilitychange→hidden` and `pagehide`. Flush does `GET → reduce → PUT` through the same-origin KV proxy. The merge function `reduce(blob, events, subActiveNow)` in `lib/analytics.ts` is pure — keep it that way so it stays testable.
- Conversion detection: `subscription.was_active_at_first_visit` is snapshot once at blob creation and never changes. `subscription.became_active_at` stamps on the first observed `false → true` transition. Conversion rate = `COUNT(became_active_at IS NOT NULL) / COUNT(was_active_at_first_visit = false)`.
- Auth-gated: with no `auth.token` / `auth.userId` from the bridge, flush silently no-ops and events keep queuing in `sessionStorage`. Intended — they'll flush next time auth is present. Don't add a "send anonymous" path.
- A `practice_log` cap of 500 entries prevents unbounded blob growth. Older attempts evict from the head.

## Video feed performance

**Do not eager-load all videos.** The feed has 61+ cards. Loading all simultaneously saturates mobile bandwidth and causes cards to "stick" in the viewport during buffering — bad UX, and it inflates `reel_viewed` impressions because the dwell timer fires on cards stuck waiting to buffer.

`app/page.tsx` uses a rolling preload window: only cards in `[activeIdx - PRELOAD_BEHIND, activeIdx + PRELOAD_AHEAD]` (currently 1 behind, 3 ahead) have `src` set and `preload="auto"`. Outside the window, `src={undefined}` and `preload="none"`. `VideoFeedInner` owns `activeIdx` (initialized from `?next=N` to handle return-from-practice), and each `VideoCardItem` calls `onBecameActive(idx)` from its IntersectionObserver to shift the window. Don't break this pattern when adding cards or restructuring the feed.

`reel_viewed` requires **3 seconds of sustained ≥60% visibility** (the `DWELL_MS` constant in `app/page.tsx`). A card that flashes through during fast scroll does not count. Don't lower this — earlier shorter values produced phantom impressions during buffering and scroll lag.

## Deployment

- **Mobile webview allowlist**: URLs loaded by the Supernova app must match `*.gosupernova.live` or `*.getsupernova.ai`. `*.vercel.app` is blocked. To test a branch inside the real mobile app, add a `*.gosupernova.live` subdomain in Vercel → Settings → Domains → assign Git Branch to the feature branch. Then add a CNAME record in DNS pointing to `cname.vercel-dns.com`.
- **Vercel Deployment Protection** on this project: **Vercel Authentication is disabled** on all deployments so the mobile webview can load preview URLs without an SSO session cookie. Don't re-enable without first setting up Protection Bypass tokens (`?x-vercel-protection-bypass=…&x-vercel-set-bypass-cookie=true`) and wiring them into the mobile app config.
