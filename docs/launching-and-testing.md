# Launching and Testing the Prototype

How to test the prototype in a regular browser, and how the mobile app actually loads it into a webview.

See also: [`webview-bridge.md`](./webview-bridge.md) for the bridge bootstrap and shim, [`host-spec-supernova.md`](./host-spec-supernova.md) for the context shape, and [`api-web-prototypes.md`](./api-web-prototypes.md) for the API routes.

---

## Testing in browser dev

The recommended approach is the browser shim (`browser-shim-snippet.js`). Include it before your scripts, and `window.WebviewBridge` gets a no-op stub with `{ host: { isNative: false, platform: "web" } }`.

Since the shim returns no `auth`/`user`/`app`, your prototype's auth helper needs a browser-dev fallback. The pattern is:

1. Check `ctx.auth?.token` first.
2. If absent, read from `localStorage` or a `?token=` query param.

This keeps a **single code path** for both native and browser — no `if (isNative)` branching scattered through your fetch wrapper.

### Where to get the JWT

Three options in preference order:

1. **Long-lived dev token from the backend team**, tied to a test user. Set it once via `?token=XXX&userId=YYY`; the shim persists it in `localStorage` so subsequent loads work without query params. This is the cleanest because you iterate without re-extracting tokens.
2. **Grab one from a debug build's network inspector** (DevTools / Flipper) — copy the `Authorization` header off any in-app request.
3. **Hit the login endpoint** directly with `curl` and read the token from the response. (Login endpoint not yet documented — ask the backend team.)

### Security note

JWTs in `localStorage` are XSS-readable. This shim and fallback path should **only** load in dev — gate it on `NODE_ENV !== "production"` or ship it as a separate `dev.html` entry. Don't let the dev fallback code run in production builds.

---

## Launching the webview from the mobile app

There are two ways the Supernova app can load a webview.

### 1. Full-screen push via Solito route (recommended for testing)

The simplest path. Used by existing features like SuperPrep (`screen.tsx:306`).

```ts
router.push(`/webview?uri=${encodeURIComponent(url)}`);
```

What this does:

- Pushes a `WebviewScreen` onto the native stack (`screen.tsx:334-359`).
- Applies the **fallback allowlist**: `["getsupernova.ai", "gosupernova.live"]` — your URL must be a subdomain of one of these (e.g. `pronunciation-reels.getsupernova.ai`).
- Automatically injects `sourceHeaders` (`Authorization` + `x-sn-user-id`) on the initial load and passes the full `context` blob to the bridge.
- Wires up all bridge events (haptics, navigation, close, hardware back).

To use this for the prototype:

1. Deploy to a subdomain of `getsupernova.ai` or `gosupernova.live`.
2. From anywhere in the app:
   ```ts
   router.push(
     `/webview?uri=${encodeURIComponent("https://pronunciation-reels.getsupernova.ai")}`
   );
   ```

Zero config. Works immediately once the prototype is on an allowed subdomain. Trigger it from a debug menu, a deep link, or a button in any existing screen.

### 2. Server-driven webview tab (for production as a bottom tab)

The more powerful option, used for persistent bottom-tab webviews (`index.tsx:331-353`). The tab config is **experiment-driven**:

```ts
type TabNavigationWebviewTabConfig = {
  type: "webview";
  screen: "webview-tab-1" | "webview-tab-2" | "webview-tab-3";
  url: string;
  allowed_subdomains: string[]; // custom allowlist per tab
  options: TabNavigationOptionsConfig;
};
```

This gives the prototype a dedicated bottom tab with its own allowlist, icon, label — and the WebView preserves state across tab switches via `active={useIsFocused()}`. But it requires setting up an experiment variant in the `tab_navigation_config` experiment set.

---

## Vercel deployment notes (for branch testing)

If hosting on Vercel:

- **Deployment Protection** defaults to "Vercel Authentication" on previews — visitors must be logged into Vercel to view the URL. The mobile webview has no Vercel session cookie, so a protected preview URL will hang on the SSO redirect when loaded in-app. Either disable Vercel Authentication for this project (Settings → Deployment Protection → toggle off "Require Log In") or generate a Protection Bypass token and pass it via `?x-vercel-protection-bypass=…&x-vercel-set-bypass-cookie=true` on every URL the app loads.
- **Use a `*.gosupernova.live` (or `*.getsupernova.ai`) domain per branch** so the webview allowlist permits it. In Vercel → Settings → Domains, add a subdomain like `exp-{feature}.gosupernova.live`, then edit it and pin Git Branch to the feature branch. Add a CNAME record at the DNS provider pointing the subdomain to `cname.vercel-dns.com`. The branch then auto-deploys to that URL on every push, and the mobile app can load it without changing `allowed_subdomains`.
- **Auto-generated `*.vercel.app` preview URLs are blocked by the webview allowlist.** Only use them for desktop browser testing.

---

## Recommendation

- **For testing / iteration:** Use the full-screen push (`/webview?uri=...`). Zero config once the prototype is on an allowed subdomain.
- **For production launch:** Use the server-driven webview tab if it should be a persistent bottom tab; otherwise stick with the full-screen push triggered from within an existing flow (e.g. tapping a CTA).
