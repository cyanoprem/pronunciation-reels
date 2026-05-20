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
  }
}

// Defensive polling bootstrap — on Android the bridge injection occasionally lands
// after guest scripts run. See docs/webview-bridge.md.
export function getBridge(callback: (bridge: WebviewBridge) => void): void {
  if (typeof window === "undefined") return;
  const bridge = window.WebviewBridge;
  if (bridge) {
    callback(bridge);
    return;
  }
  setTimeout(() => getBridge(callback), 0);
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
