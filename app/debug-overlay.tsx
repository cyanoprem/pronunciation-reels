"use client";

import { useEffect, useState } from "react";
import { useUser } from "./user-context";

const DEBUG_FLAG_KEY = "sn_debug";

function resolveDebugMode(): boolean {
  if (typeof window === "undefined") return false;
  const fromQuery = new URLSearchParams(window.location.search).get("debug");
  if (fromQuery === "1") {
    try {
      sessionStorage.setItem(DEBUG_FLAG_KEY, "1");
    } catch {
      // ignore
    }
    return true;
  }
  if (fromQuery === "0") {
    try {
      sessionStorage.removeItem(DEBUG_FLAG_KEY);
    } catch {
      // ignore
    }
    return false;
  }
  try {
    return sessionStorage.getItem(DEBUG_FLAG_KEY) === "1";
  } catch {
    return false;
  }
}

export function DebugOverlay() {
  const { ready, isNative, hasActiveSubscription, user, auth } = useUser();
  const [enabled, setEnabled] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [rawContext, setRawContext] = useState<unknown>(null);

  useEffect(() => {
    // Reading window / sessionStorage / bridge is client-only — populate once
    // on mount (and again when `ready` flips so we re-read the bridge context).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEnabled(resolveDebugMode());
    if (typeof window !== "undefined") {
      try {
        setRawContext(window.WebviewBridge?.getContext() ?? null);
      } catch {
        setRawContext(null);
      }
    }
  }, [ready]);

  if (!enabled) return null;

  const tokenPreview = auth?.token ? `${auth.token.slice(0, 12)}…` : "—";

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        maxHeight: collapsed ? 30 : "60vh",
        overflow: "auto",
        zIndex: 9999,
        background: "rgba(0,0,0,0.92)",
        color: "#0f0",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        fontSize: 11,
        lineHeight: 1.4,
        padding: "6px 10px",
        borderBottom: "1px solid #2a2a2a",
        boxShadow: "0 2px 8px rgba(0,0,0,0.4)",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: collapsed ? 0 : 4,
        }}
      >
        <strong style={{ color: "#fff" }}>
          DEBUG · ready={String(ready)} · paid={String(hasActiveSubscription)}
        </strong>
        <button
          onClick={() => setCollapsed((c) => !c)}
          style={{
            background: "#222",
            color: "#fff",
            border: "1px solid #444",
            borderRadius: 4,
            padding: "1px 8px",
            fontSize: 11,
            cursor: "pointer",
          }}
        >
          {collapsed ? "▼" : "▲"}
        </button>
      </div>
      {!collapsed && (
        <div>
          <div>isNative: {String(isNative)}</div>
          <div>hasActiveSubscription: {String(hasActiveSubscription)}</div>
          <div>user.id: {user?.id ?? "—"}</div>
          <div>user.name: {user?.name ?? "—"}</div>
          <div>user.is_paid: {String(user?.is_paid)}</div>
          <div>subscription.is_active: {String(user?.subscription?.is_active)}</div>
          <div>subscription.status: {user?.subscription?.status ?? "—"}</div>
          <div>subscription.type: {user?.subscription?.type ?? "—"}</div>
          <div>subscription.type_of_sale: {user?.subscription?.type_of_sale ?? "—"}</div>
          <div>subscription.case_type: {user?.subscription?.case_type ?? "—"}</div>
          <div>auth.userId: {auth?.userId ?? "—"}</div>
          <div>auth.token: {tokenPreview}</div>
          <details style={{ marginTop: 6 }}>
            <summary style={{ cursor: "pointer", color: "#aaa" }}>
              raw bridge.getContext()
            </summary>
            <pre
              style={{
                whiteSpace: "pre-wrap",
                wordBreak: "break-all",
                marginTop: 4,
                color: "#9ef",
              }}
            >
              {rawContext === null
                ? "null"
                : JSON.stringify(rawContext, null, 2)}
            </pre>
          </details>
        </div>
      )}
    </div>
  );
}
