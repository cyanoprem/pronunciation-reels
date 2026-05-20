# Webview Bridge — Guest Integration Guide

How prototypes (the "guest") receive auth credentials and talk to the Supernova mobile app (the "host") when rendered inside a webview.

See also: [`host-spec-supernova.md`](./host-spec-supernova.md) for the full context shape and event catalogue, and [`api-web-prototypes.md`](./api-web-prototypes.md) for the API routes you'll call with these credentials.

---

## How auth reaches the guest

The mobile app passes auth credentials into the webview through **two mechanisms**:

### 1. `sourceHeaders` — HTTP headers on the initial document request

The `<WebviewHost>` component receives a `sourceHeaders` prop containing `Authorization: Bearer <token>` and `x-sn-user-id: <userId>`. These are sent as HTTP headers when the WebView first loads the URL.

```ts
const sourceHeaders = {
  ...apiHeaders,
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
  ...(userId ? { "x-sn-user-id": userId } : {}),
};
```

(See `packages/app/features/webview/screen.tsx` lines 61–65 in the Supernova app repo.)

### 2. `context` — injected JS boot blob readable via `bridge.getContext()`

The host also passes a `context` prop to `<WebviewHost>` which gets injected into the guest as `window.WebviewBridge`. The guest reads it with `bridge.getContext()`:

```ts
const context = {
  auth: { token, userId },
  app: { ...apiHeaders, platform: Platform.OS },
  settings: { motherTongue, aiResponseLanguage },
  user: selectedUser,
};
```

**So:** `sourceHeaders` handles initial page-load auth at the network level, and `bridge.getContext().auth` provides the token/userId for all subsequent JS-initiated API calls from within the webview.

---

## `getBridge` — defensive bootstrap

`getBridge` is **not** an import — it's a tiny inline polling snippet you paste into your prototype. There's no package to install (by design — see ADR-0002).

The host injects `window.WebviewBridge` via `injectedJavaScriptBeforeContentLoaded`. On iOS this lands reliably before guest scripts; on Android it occasionally doesn't. The defensive bootstrap handles both:

```js
function getBridge(callback) {
  const bridge = window.WebviewBridge;
  if (bridge) { callback(bridge); return; }
  setTimeout(() => getBridge(callback), 0);
}
```

It polls `window.WebviewBridge` on every `setTimeout(0)` tick until it appears, then calls your callback. No ready event needed — just wrap your boot code in `getBridge(...)` and you're safe.

---

## Local dev fallback (running in a regular browser)

The repo ships a browser shim at `browser-shim-snippet.js`. Include it before your other scripts:

```html
<script src="browser-shim-snippet.js"></script>
```

What it does:

- If `window.WebviewBridge` already exists (native) → bails, no-op.
- If `window.ReactNativeWebView.postMessage` exists (native, pre-bridge) → bails.
- Otherwise (regular browser) → installs a no-op shim:
  - `getContext()` returns `{ host: { isNative: false, platform: "web", bridgeVersion: 1 } }` — no auth, no user, no app headers.
  - `emit()` logs a console warning.
  - `on()` returns a no-op unsubscribe.

So in browser dev mode, `ctx.auth` will be `undefined` and `ctx.app` will be `undefined`. Your auth helper should handle this gracefully — e.g. fall back to reading a token from `localStorage` or a query param for local testing:

```js
getBridge((bridge) => {
  const ctx = bridge.getContext();
  const headers = {};

  if (ctx.auth?.token) {
    // Native path — real credentials from the host
    headers["Authorization"] = `Bearer ${ctx.auth.token}`;
    headers["x-sn-user-id"] = ctx.auth.userId ?? "";
    Object.assign(headers, ctx.app); // telemetry headers
  } else {
    // Browser dev fallback — read from localStorage or query param
    const devToken =
      localStorage.getItem("dev_token") ||
      new URLSearchParams(location.search).get("token");
    if (devToken) headers["Authorization"] = `Bearer ${devToken}`;
    const devUserId =
      localStorage.getItem("dev_user_id") ||
      new URLSearchParams(location.search).get("user_id");
    if (devUserId) headers["x-sn-user-id"] = devUserId;
  }
});
```

---

## Minimal working prototype

Full working example (also at `minimal-prototype.html` in the bridge repo):

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Minimal Prototype · webview-bridge</title>
    <style>
      body {
        font: 14px/1.5 system-ui, sans-serif;
        margin: 0;
        padding: 24px;
        padding-top: calc(24px + var(--sa-top, 0px));
        padding-bottom: calc(24px + var(--sa-bottom, 0px));
      }
      h1 { font-size: 20px; margin: 0 0 16px; }
      button {
        display: block; width: 100%;
        margin: 8px 0; padding: 14px;
        font-size: 15px; border: 1px solid #ccc;
        border-radius: 8px; background: #fff;
      }
      pre {
        background: #f4f4f4;
        padding: 12px; border-radius: 8px;
        overflow-x: auto;
      }
    </style>
  </head>
  <body>
    <!-- 1. Browser shim (skipped in native — host's injection wins) -->
    <script src="./browser-shim-snippet.js"></script>

    <h1>Minimal Prototype</h1>

    <pre id="ctx">loading…</pre>

    <button id="haptic">Haptic feedback</button>
    <button id="open">Open native screen "premium"</button>
    <button id="close">Close webview</button>

    <h2>Events</h2>
    <pre id="log">(none)</pre>

    <script>
      function getBridge(callback) {
        const bridge = window.WebviewBridge;
        if (bridge) { callback(bridge); return; }
        setTimeout(() => getBridge(callback), 0);
      }

      getBridge((bridge) => {
        // 2. Read boot context
        const ctx = bridge.getContext();
        document.getElementById("ctx").textContent = JSON.stringify(ctx, null, 2);

        // 3. Apply safe-area insets from boot context
        if (ctx.host.safeAreaInsets) {
          const { top, bottom } = ctx.host.safeAreaInsets;
          document.documentElement.style.setProperty("--sa-top", top + "px");
          document.documentElement.style.setProperty("--sa-bottom", bottom + "px");
        }

        // 4. Emit guest → host events
        document.getElementById("haptic").addEventListener("click", () => {
          bridge.emit("device.haptic", { style: "light" });
        });
        document.getElementById("open").addEventListener("click", () => {
          bridge.emit("navigation.open", { path: "/premium" });
        });
        document.getElementById("close").addEventListener("click", () => {
          bridge.emit("host.close");
        });

        // 5. Observe local event flow
        const log = document.getElementById("log");
        const lines = [];
        function appendLog(msg) {
          lines.push(msg);
          log.textContent = lines.slice(-10).join("\n");
        }

        // 6. Hardware back (Android). No default — if you skip this listener,
        //    the press is consumed and nothing happens.
        bridge.on("host.hardwareBack", () => {
          appendLog("hardwareBack");
          bridge.emit("host.close");
        });
      });
    </script>
  </body>
</html>
```

---

## Guest boot template (auth-focused)

Smaller template focused just on the auth-forwarding pattern:

```js
function getBridge(callback) {
  const bridge = window.WebviewBridge;
  if (bridge) return callback(bridge);
  setTimeout(() => getBridge(callback), 0);
}

getBridge((bridge) => {
  const ctx = bridge.getContext();

  // Auth: forward to Supernova APIs
  const headers = {
    Authorization: ctx.auth.token ? `Bearer ${ctx.auth.token}` : "",
    "x-sn-user-id": ctx.auth.userId ?? "",
    ...ctx.app, // include all x-sn-* telemetry headers
  };

  // Wire Android back
  bridge.on("host.hardwareBack", () => bridge.emit("host.close"));

  // Sample interactions
  someButton.onclick = () => {
    bridge.emit("device.haptic", { style: "light" });
    bridge.emit("navigation.open", { path: "/premium" });
  };
});
```
