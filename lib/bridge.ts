// Webview bridge helpers. See docs/webview-bridge.md and docs/host-spec-supernova.md.
// This file is the framework-agnostic surface; React glue lives in app/user-context.tsx.

export type SubscriptionStatus = "active" | "expiring" | "expired";

export type BridgeUser = {
  id: string;
  name?: string | null;
  phone_number?: string | null;
  is_paid?: boolean;
  subscription?: {
    is_active: boolean;
    status: SubscriptionStatus;
    started_at?: string;
    ending_at?: string;
    type?: string;
    type_of_sale?: string | null;
    case_type?: string | null;
    auto_pay_status?: string | null;
  };
} | null;

export type BridgeContext = {
  host: {
    isNative: boolean;
    platform: "ios" | "android" | "web";
    bridgeVersion?: number;
    safeAreaInsets?: { top: number; bottom: number; left: number; right: number };
  };
  auth?: { token: string | null; userId: string | null };
  app?: Record<string, string>;
  settings?: { motherTongue?: string; aiResponseLanguage?: string | null };
  user?: BridgeUser;
};

export type WebviewBridge = {
  getContext: () => BridgeContext;
  emit: (type: string, payload?: unknown) => void;
  on: (type: string, listener: (payload: unknown) => void) => () => void;
};

declare global {
  interface Window {
    WebviewBridge?: WebviewBridge;
    ReactNativeWebView?: { postMessage?: (msg: string) => void };
  }
}

// Defensive polling bootstrap — on Android the bridge injection occasionally lands
// after guest scripts run. See docs/webview-bridge.md.
//
// In a regular browser (no native host, no shim — e.g. prod Vercel deploy opened
// directly) the bridge never appears. Cap the wait so the dev fallback in
// UserProvider (?is_paid query param / localStorage) can kick in instead of
// the gate staying "not ready" forever.
export function getBridge(callback: (bridge: WebviewBridge | null) => void): void {
  if (typeof window === "undefined") return;
  if (window.WebviewBridge) {
    callback(window.WebviewBridge);
    return;
  }
  const inRNWebView = typeof window.ReactNativeWebView !== "undefined";
  const maxMs = inRNWebView ? 5000 : 400;
  const start = Date.now();
  const poll = () => {
    if (window.WebviewBridge) {
      callback(window.WebviewBridge);
      return;
    }
    if (Date.now() - start >= maxMs) {
      callback(null);
      return;
    }
    setTimeout(poll, 0);
  };
  poll();
}

export function emitNavigationOpen(path: string): void {
  if (typeof window === "undefined") return;
  const bridge = window.WebviewBridge;
  if (!bridge) {
    console.warn("[bridge] navigation.open requested but bridge not present:", path);
    return;
  }
  bridge.emit("navigation.open", { path });
}
