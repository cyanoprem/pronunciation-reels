# Host Spec: Supernova

What the Supernova native host (RN/Expo app) exposes to web guests via `webview-bridge`. Use this to build a guest. When this package is reused for a different host, replace this file with that host's spec.

See also: [`webview-bridge.md`](./webview-bridge.md) for the bootstrap pattern and browser dev shim.

---

## Context shape

Returned by `window.WebviewBridge.getContext()` once the bridge runtime is installed. All fields are JSON-serializable. **Snapshot only** — does not update after boot; live changes come as events.

```ts
type Context = {
  // Bridge-owned — fields the bridge fills in itself. Do not rely on the shim
  // returning all of these in browser dev (only `isNative: false` + platform).
  host: {
    isNative: true;
    platform: "ios" | "android";
    safeAreaInsets: {
      top: number;
      bottom: number;
      left: number;
      right: number;
    };
    bridgeVersion: 1;
  };

  // Host bearer credentials. `token` is a JWT; pass as
  // `Authorization: Bearer ${token}` for API calls back to Supernova services.
  auth: {
    token: string | null;
    userId: string | null;
  };

  // HTTP headers the host already attaches to the initial document request.
  // Mirror these on subsequent guest-initiated fetches for telemetry continuity.
  app: {
    "x-sn-app-id": string;
    "x-sn-app-version": string;
    "x-sn-app-build": string;
    "x-sn-app-update-id": string;
    "x-sn-app-update-channel": string;
    "x-sn-app-update-runtime": string;
    "x-sn-app-platform": string;
    "x-sn-app-os-version": string;
    "x-sn-app-supported-experiments": string;
    platform: "ios" | "android" | "web";
  };

  // User preferences relevant to AI behavior and copy localization.
  settings: {
    motherTongue: string;
    aiResponseLanguage: string | null;
  };

  user: {
    id: string;
    phone_number: string | null;
    name: string;
    user_type: string | null;
    occupation: string | null;
    need: string | null;
    english_persona: string | null;
    is_paid?: boolean;
    subscription: {
      is_active: boolean;
      status: "active" | "expiring" | "expired";
      started_at: string;
      ending_at: string;
      type: string;
      type_of_sale: string | null;
      case_type: string | null;
      auto_pay_status: string | null;
    };
    plan: Record<string, JsonValue> | null;
    experiments?: Record<string, JsonValue>;
  } | null;
};
```

### Gating premium features — `is_paid` vs `subscription.is_active`

⚠️ **`subscription.is_active === true` is NOT the same as "user has paid."**

Free-trial users have:
```
user.is_paid: false
subscription.is_active: true
subscription.status: "active"
subscription.type: "free_trial"
```

So a gate that only checks `subscription.is_active` will let free-trial users through.

For "paid with active subscription" gating, require **both**:

```ts
const hasActiveSubscription =
  ctx.user?.is_paid === true &&
  ctx.user?.subscription?.is_active === true;
```

Observed `subscription.type` values so far: `"free_trial"` (the rest are unconfirmed — ask the backend team if you need the full enum).

---

## Events the host accepts (guest → host)

Fire-and-forget; no return values. Unknown event types land in the host's Sentry as `WebView bridge: unhandled event "<type>"`.

### `host.close`

**Payload:** `{}`
Closes the current webview screen (host calls its router's `back()`). Single-page guests usually emit this in response to `host.hardwareBack` on Android. Full-screen webview pushes (via `webview.push`) also pop back to the previous screen.

### `device.haptic`

**Payload:** `{ style: "soft" | "light" | "medium" | "heavy" | "rigid" }`
Triggers a native haptic. Maps to `expo-haptics` `ImpactFeedbackStyle`. Use for button presses, selections, success/error cues.

### `navigation.open`

**Payload:** `{ path: string }`
Pushes a native route. `path` follows Solito-style internal route strings, with any query params already encoded by the guest. Leading `/` is optional.

```js
bridge.emit("navigation.open", { path: "/scenario-overview?id=abc" });
```

### `navigation.openTab`

**Payload:** `{ tab: string; params?: Record<string, JsonValue> }`
Switches the bottom-tab navigator to `tab` (the tab's screen name from `tab_navigation_config`). Use to jump between sibling tabs (e.g. webview-driven CTA that lands the user on "home").

### `webview.push`

**Payload:** `{ uri: string }`
Pushes a new full-screen webview through the app's Solito `/webview?uri=...` route. `uri` may be relative to the current page (resolved against `ctx.sourceUri` host-side), so:

```js
bridge.emit("webview.push", { uri: "/lesson/42" });
```

works from within an allowed origin.

### `webview.replace`

**Payload:** `{ uri: string }`
Replaces the current route with the app's Solito `/webview?uri=...` route for `uri`.

---

## Events the host emits (host → guest)

### `host.hardwareBack`

**Payload:** `{}`
Android hardware back pressed. **No default behavior** — guest must `bridge.on("host.hardwareBack", ...)` or the press is consumed and nothing happens.

Single-page guests typically forward to `host.close`:

```js
bridge.on("host.hardwareBack", () => bridge.emit("host.close"));
```

Multi-page guests check their router depth first:

```js
bridge.on("host.hardwareBack", () => {
  if (router.canGoBack()) router.back();
  else bridge.emit("host.close");
});
```

---

## Allowed origins

Guests are initially loaded only from subdomains of apex domains the host trusts (currently `*.getsupernova.ai`, `*.gosupernova.live`). Server-driven webview tabs provide their initial allowlist via `allowed_subdomains`; full-screen `/webview?uri=...` routes use the app fallback allowlist. v1 does not domain-gate every in-WebView top-level navigation, so guests must not navigate to URLs they do not own.
