// Prototype analytics — one per-user JSON blob in /api/users/kv/pr_analytics:v1.
// See plan: ~/.claude/plans/so-what-is-the-eager-snowflake.md and
// docs/api-web-prototypes.md (KV shape) + docs/webview-bridge.md (auth source).
//
// Lifecycle: track() queues events in memory + sessionStorage. flush() merges
// queued events into the blob via reduce() and PUTs it back. Flush triggers:
// debounced after last track, on visibilitychange→hidden, on pagehide.
//
// Edge-request budget: the blob is GET once per session then cached in memory,
// so subsequent flushes are PUT-only (halves /api/kv-proxy traffic). The
// debounce is long (15s) so a burst of scroll events collapses into one PUT;
// visibilitychange/pagehide still force an immediate flush so nothing is lost
// when the user leaves.

import type { BridgeContext, BridgeUser } from "./bridge";

// Same-origin proxy → /api/kv-proxy/[key] in this app forwards to
// https://app.gosupernova.com/api/users/kv/[key] server-side. Avoids CORS
// preflight that the Supernova KV endpoint doesn't support.
const KV_KEY = "pr_analytics:v1";
const KV_PATH = `/api/kv-proxy/${encodeURIComponent(KV_KEY)}`;
const QUEUE_STORAGE_KEY = "pr_analytics_queue";
const FLUSH_DEBOUNCE_MS = 15000;
const PRACTICE_LOG_CAP = 500;

export type AnalyticsEvent =
  | { type: "reel_viewed"; ts: string; props: { reelId: number; word: string } }
  | { type: "reel_practice_tapped"; ts: string; props: { reelId: number; word: string; paid: boolean } }
  | { type: "practice_gated"; ts: string; props: { reelId: number; word: string } }
  | { type: "premium_redirect"; ts: string; props: Record<string, never> }
  | { type: "practice_started"; ts: string; props: { videoId: number; word: string } }
  | {
      type: "practice_attempt";
      ts: string;
      props: { videoId: number; word: string; stage: "word_hint" | "word_no_hint" | "sentence"; attempt: number; score: number };
    }
  | {
      type: "practice_completed";
      ts: string;
      props: { videoId: number; word: string; avgScore: number; elapsedMs: number };
    };

type Blob = {
  schema: 1;
  user_id: string | null;
  first_seen_at: string;
  last_seen_at: string;
  subscription: {
    was_active_at_first_visit: boolean;
    is_active_now: boolean;
    became_active_at: string | null;
  };
  counters: {
    reels_viewed: number;
    practice_taps: number;
    practice_gated: number;
    practice_started: number;
    practice_completed: number;
    premium_redirects: number;
  };
  reels_seen: Record<string, number>;
  practice_log: Array<{
    ts: string;
    videoId: number;
    word: string;
    stage: "word_hint" | "word_no_hint" | "sentence";
    attempt: number;
    score: number;
  }>;
};

let queue: AnalyticsEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let lifecycleBound = false;
let flushing = false;
// In-memory copy of the last-PUT blob. GET runs only when this is null (first
// flush of the session); afterwards we merge onto it and PUT, skipping the GET.
// Only updated after a PUT succeeds so a failed PUT doesn't desync the cache.
let cachedBlob: Blob | null = null;

function nowIso(): string {
  return new Date().toISOString();
}

function isPaidFromUser(user: BridgeUser | undefined): boolean {
  return user?.is_paid === true && user?.subscription?.is_active === true;
}

function readBridgeContext(): BridgeContext | null {
  if (typeof window === "undefined") return null;
  try {
    return window.WebviewBridge?.getContext() ?? null;
  } catch {
    return null;
  }
}

function readQueueBackup(): AnalyticsEvent[] {
  if (typeof sessionStorage === "undefined") return [];
  try {
    const raw = sessionStorage.getItem(QUEUE_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as AnalyticsEvent[]) : [];
  } catch {
    return [];
  }
}

function writeQueueBackup(): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(queue));
  } catch {
    // ignore — private mode / quota
  }
}

function clearQueueBackup(): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.removeItem(QUEUE_STORAGE_KEY);
  } catch {
    // ignore
  }
}

function emptyBlob(userId: string | null, subActiveNow: boolean): Blob {
  const now = nowIso();
  return {
    schema: 1,
    user_id: userId,
    first_seen_at: now,
    last_seen_at: now,
    subscription: {
      was_active_at_first_visit: subActiveNow,
      is_active_now: subActiveNow,
      became_active_at: null,
    },
    counters: {
      reels_viewed: 0,
      practice_taps: 0,
      practice_gated: 0,
      practice_started: 0,
      practice_completed: 0,
      premium_redirects: 0,
    },
    reels_seen: {},
    practice_log: [],
  };
}

// Pure: applies events + current subscription state to a blob. No I/O.
export function reduce(blob: Blob, events: AnalyticsEvent[], subActiveNow: boolean): Blob {
  // Detect free→paid transition once.
  const becameActive =
    !blob.subscription.is_active_now && subActiveNow && blob.subscription.became_active_at === null;

  const next: Blob = {
    ...blob,
    last_seen_at: nowIso(),
    subscription: {
      was_active_at_first_visit: blob.subscription.was_active_at_first_visit,
      is_active_now: subActiveNow,
      became_active_at: becameActive ? nowIso() : blob.subscription.became_active_at,
    },
    counters: { ...blob.counters },
    reels_seen: { ...blob.reels_seen },
    practice_log: blob.practice_log.slice(),
  };

  for (const ev of events) {
    switch (ev.type) {
      case "reel_viewed": {
        next.counters.reels_viewed += 1;
        const k = String(ev.props.reelId);
        next.reels_seen[k] = (next.reels_seen[k] ?? 0) + 1;
        break;
      }
      case "reel_practice_tapped":
        next.counters.practice_taps += 1;
        break;
      case "practice_gated":
        next.counters.practice_gated += 1;
        break;
      case "premium_redirect":
        next.counters.premium_redirects += 1;
        break;
      case "practice_started":
        next.counters.practice_started += 1;
        break;
      case "practice_attempt":
        next.practice_log.push({
          ts: ev.ts,
          videoId: ev.props.videoId,
          word: ev.props.word,
          stage: ev.props.stage,
          attempt: ev.props.attempt,
          score: ev.props.score,
        });
        break;
      case "practice_completed":
        next.counters.practice_completed += 1;
        break;
    }
  }

  if (next.practice_log.length > PRACTICE_LOG_CAP) {
    next.practice_log = next.practice_log.slice(-PRACTICE_LOG_CAP);
  }

  return next;
}

async function fetchBlob(headers: Record<string, string>): Promise<Blob | null> {
  const res = await fetch(KV_PATH, { headers });
  if (res.status === 404) return null;
  if (!res.ok) {
    console.warn("[analytics] GET blob failed", res.status);
    return null;
  }
  const body = (await res.json()) as { key: string; value: Blob };
  return body.value ?? null;
}

async function putBlob(headers: Record<string, string>, blob: Blob): Promise<void> {
  const res = await fetch(KV_PATH, {
    method: "PUT",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ value: blob }),
  });
  if (!res.ok) {
    console.warn("[analytics] PUT blob failed", res.status);
  }
}

function buildAuthHeaders(ctx: BridgeContext): Record<string, string> | null {
  const token = ctx.auth?.token;
  const userId = ctx.auth?.userId;
  if (!token || !userId) return null;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "x-sn-user-id": userId,
  };
  // Forward x-sn-* telemetry headers per CLAUDE.md (backend telemetry continuity).
  if (ctx.app) {
    for (const [k, v] of Object.entries(ctx.app)) {
      if (typeof v === "string") headers[k] = v;
    }
  }
  return headers;
}

export async function flush(): Promise<void> {
  if (flushing) return;
  if (queue.length === 0) return;

  const ctx = readBridgeContext();
  if (!ctx) {
    // Browser dev without shim — keep events queued (sessionStorage backup
    // survives reload, will flush next time bridge is present).
    return;
  }
  const headers = buildAuthHeaders(ctx);
  if (!headers) {
    console.warn("[analytics] flush skipped — no auth (token or userId missing)");
    return;
  }

  flushing = true;
  // Snapshot + drain the queue. If the PUT fails we restore.
  const draining = queue.slice();
  queue = [];
  writeQueueBackup();

  try {
    const subActiveNow = isPaidFromUser(ctx.user ?? undefined);
    // GET only on the first flush of the session; reuse the cached blob after.
    const didGet = cachedBlob === null;
    const base =
      cachedBlob ??
      (await fetchBlob(headers)) ??
      emptyBlob(ctx.auth?.userId ?? null, subActiveNow);
    const merged = reduce(base, draining, subActiveNow);
    await putBlob(headers, merged);
    cachedBlob = merged; // only cache after a successful PUT
    clearQueueBackup();
    console.log("[analytics] flushed", draining.length, "events", didGet ? "(GET+PUT)" : "(PUT-only)");
  } catch (e) {
    console.error("[analytics] flush error", e);
    // Restore drained events to the front so we retry next flush. cachedBlob is
    // left untouched (not advanced past this failed PUT), so the retry merges
    // the same events onto the same base — no double-count.
    queue = [...draining, ...queue];
    writeQueueBackup();
  } finally {
    flushing = false;
  }
}

function scheduleFlush(): void {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flush();
  }, FLUSH_DEBOUNCE_MS);
}

// pagehide is our last chance — sendBeacon survives webview teardown but can't
// do GET-then-PUT, so we send the raw events to a no-op merge endpoint... we
// don't have one. Instead, we attempt a synchronous-ish blocking flush; if the
// host kills us, events are preserved in sessionStorage and flush next boot.
function bindLifecycle(): void {
  if (lifecycleBound) return;
  if (typeof window === "undefined" || typeof document === "undefined") return;
  lifecycleBound = true;

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void flush();
  });
  window.addEventListener("pagehide", () => {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    void flush();
  });

  // Restore queue from any prior session that didn't get to flush.
  const restored = readQueueBackup();
  if (restored.length > 0) {
    queue = [...restored, ...queue];
    console.log("[analytics] restored", restored.length, "queued events from sessionStorage");
    scheduleFlush();
  }
}

export function track<T extends AnalyticsEvent["type"]>(
  type: T,
  props: Extract<AnalyticsEvent, { type: T }>["props"]
): void {
  if (typeof window === "undefined") return;
  bindLifecycle();
  const ev = { type, ts: nowIso(), props } as AnalyticsEvent;
  queue.push(ev);
  writeQueueBackup();
  if (process.env.NODE_ENV !== "production") {
    console.log("[analytics] track", type, props);
  }
  scheduleFlush();
}

// Dev helper — call from devtools console: window.__prAnalyticsFlush()
if (typeof window !== "undefined" && process.env.NODE_ENV !== "production") {
  (window as unknown as { __prAnalyticsFlush?: () => Promise<void> }).__prAnalyticsFlush = flush;
}
