// Proxy to Supernova's per-user KV endpoint.
//
// Why this exists: the Supernova /api/users/kv endpoint has no CORS support, so
// a browser doing fetch("https://app.gosupernova.com/api/users/kv/...") from a
// page on *.vercel.app or *.gosupernova.live gets blocked at preflight. By
// proxying through this same-origin Next.js route, the browser sees a same-
// origin request (no preflight) and our server makes the cross-origin call
// (server-to-server, no CORS).
//
// Auth headers (Authorization, x-sn-user-id, x-sn-*) come from the client —
// originally injected by the WebviewBridge per docs/webview-bridge.md.

// docs/api-web-prototypes.md lists app.gosupernova.com but that hostname does
// not resolve (NXDOMAIN). The live API is app.gosupernova.live.
const UPSTREAM = "https://app.gosupernova.live/api/users/kv";

function forwardHeaders(req: Request): Headers {
  const out = new Headers();
  const auth = req.headers.get("authorization");
  if (auth) out.set("authorization", auth);
  const userId = req.headers.get("x-sn-user-id");
  if (userId) out.set("x-sn-user-id", userId);
  // Forward x-sn-* telemetry headers (CLAUDE.md: keep backend telemetry continuous).
  req.headers.forEach((value, name) => {
    if (name.startsWith("x-sn-") && name !== "x-sn-user-id") {
      out.set(name, value);
    }
  });
  return out;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ key: string }> }
) {
  const { key } = await params;
  const headers = forwardHeaders(request);
  const upstream = await fetch(`${UPSTREAM}/${encodeURIComponent(key)}`, {
    method: "GET",
    headers,
    cache: "no-store",
  });
  const body = await upstream.text();
  return new Response(body, {
    status: upstream.status,
    headers: { "content-type": upstream.headers.get("content-type") ?? "application/json" },
  });
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ key: string }> }
) {
  const { key } = await params;
  const headers = forwardHeaders(request);
  headers.set("content-type", request.headers.get("content-type") ?? "application/json");
  const body = await request.text();
  const upstream = await fetch(`${UPSTREAM}/${encodeURIComponent(key)}`, {
    method: "PUT",
    headers,
    body,
    cache: "no-store",
  });
  const respBody = await upstream.text();
  return new Response(respBody, {
    status: upstream.status,
    headers: { "content-type": upstream.headers.get("content-type") ?? "application/json" },
  });
}
