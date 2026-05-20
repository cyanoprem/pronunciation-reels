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

Key rules for gating premium features:
- `subscription.is_active === true` is NOT "user has paid" — free-trial users have `is_active: true` and `subscription.type: "free_trial"`. Gating only on `is_active` lets trial users through.
- Require BOTH `user.is_paid === true` AND `user.subscription.is_active === true` for paid-feature access (see `docs/host-spec-supernova.md` → "Gating premium features").
- For redirecting free users to the native paywall, use `bridge.emit("navigation.open", { path: "/premium" })`. The native payment modal (`payment.showModal`) is NOT wired through the bridge as of this writing.
