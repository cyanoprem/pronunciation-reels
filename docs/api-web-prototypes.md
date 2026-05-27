# API Documentation for Web Prototypes

All routes require authentication via `Authorization: Bearer <token>` header (or `auth_token` cookie) and `x-sn-user-id` header.

Base URL: `https://app.gosupernova.live` (`https://app.getsupernova.ai` also serves the same API). An earlier draft of this doc referenced `app.gosupernova.live` — that hostname does NOT resolve (NXDOMAIN). Use `app.gosupernova.live`.

## ⚠ CORS limitation (read before calling from a browser)

The `/api/kv/*` and `/api/users/kv/*` endpoints return no `Access-Control-*` headers. Any cross-origin browser fetch (e.g. from a prototype hosted on `*.vercel.app` or even on a different `*.gosupernova.live` subdomain) gets blocked at preflight with a 500/empty response — the analytics flush will fail silently.

To write KV from the client, route every request through a **same-origin proxy** in your prototype's own Next.js app. Reference implementation: `app/api/kv-proxy/[key]/route.ts` in `pronunciation-reels`. The proxy:

1. Accepts `GET` and `PUT` at `/api/kv-proxy/[key]`.
2. Forwards `Authorization`, `x-sn-user-id`, and all `x-sn-*` headers from the incoming request.
3. Calls `https://app.gosupernova.live/api/users/kv/[key]` server-side and returns the upstream response verbatim.

Browser sees same-origin → no preflight. Server-to-server call → CORS doesn't apply. The other `/api/speak/*` endpoints can be hit directly from the browser if they have CORS configured; KV does not.

---

## 1. `/api/kv` — Global Key-Value Store

A shared (non-user-scoped) key-value store. Keys are globally unique strings; values are arbitrary JSON.

**DB table:** `kv` — columns: `id` (uuid), `key` (text, unique), `value` (jsonb), `inserted_at`, `updated_at`

### `GET /api/kv/:key`

Get a single value by key.

**Response (200):**
```json
{ "key": "my_key", "value": <any JSON> }
```
**Response (404):**
```json
{ "error": "Not found" }
```

---

### `PUT /api/kv/:key`

Set (create or update) a value for a key. Upserts on conflict.

**Request body:**
```json
{ "value": <any JSON> }
```

**Response (200):**
```json
{ "key": "my_key", "value": <any JSON>, "updatedAt": "2026-05-19T..." }
```

---

### `POST /api/kv/bulk`

Fetch multiple keys at once.

**Request body:**
```json
{ "keys": ["key1", "key2", "key3"] }
```
- `keys`: array of strings (1–100 items, each 1–255 chars)

**Response (200):**
```json
{ "values": { "key1": <value>, "key2": <value>, ... } }
```
Missing keys are omitted from the response object.

---

## 2. `/api/users/kv` — Per-User Key-Value Store

Same as `/api/kv` but scoped to the authenticated user. Each user has their own namespace — the same key can hold different values for different users.

**DB table:** `users_kv_store` — columns: `id` (uuid), `user_id` (uuid), `key` (varchar 255), `value` (jsonb), `inserted_at`, `updated_at`. Unique constraint on `(user_id, key)`.

### `GET /api/users/kv`

List all key-value entries for the authenticated user.

**Response (200):**
```json
{ "entries": [{ "key": "pref_theme", "value": "dark", "updatedAt": "..." }, ...] }
```

---

### `GET /api/users/kv/:key`

Get a single value for the authenticated user.

**Response (200):**
```json
{ "key": "pref_theme", "value": "dark" }
```
**Response (404):**
```json
{ "error": "Not found" }
```

---

### `PUT /api/users/kv/:key`

Set (create or update) a value for the authenticated user. Upserts on conflict.

**Request body:**
```json
{ "value": <any JSON> }
```

**Response (200):**
```json
{ "key": "pref_theme", "value": "dark", "updatedAt": "2026-05-19T..." }
```

---

### `POST /api/users/kv/bulk`

Fetch multiple keys for the authenticated user at once.

**Request body:**
```json
{ "keys": ["key1", "key2"] }
```
- `keys`: array of strings (1–100 items, each 1–256 chars)

**Response (200):**
```json
{ "values": { "key1": <value>, "key2": <value> } }
```
Missing keys are omitted from the response object.

---

## 3. `/api/speak/scenarios` — Scenario Results

Routes for submitting and retrieving scenario completion results.

### `POST /api/speak/scenarios/:scenarioId/result`

Submit a result for a completed scenario. Also awards 500 gems and marks the attempt as completed.

**Request body:**
```json
{
  "id": "uuid-v4",
  "data": <any JSON>,
  "stars": 1 | 2 | 3,
  "attempt_id": "uuid-v4" | null
}
```

| Field        | Type             | Required | Description                                      |
|------------- |------------------|----------|--------------------------------------------------|
| `id`         | UUID string      | Yes      | Client-generated unique ID for this result        |
| `data`       | any JSON         | Yes      | Arbitrary result payload (scores, answers, etc.)  |
| `stars`      | integer (1–3)    | Yes      | Star rating for the attempt                       |
| `attempt_id` | UUID string/null | No       | Associated attempt ID (marks attempt as completed)|

**Response (200):**
```json
{
  "id": "uuid",
  "activity_end_redirect_to": "/some/path" | null
}
```

---

### `POST /api/speak/scenarios/results`

Get the latest result for each of the given scenario IDs for the authenticated user.

**Request body:**
```json
{
  "scenario_ids": ["uuid-1", "uuid-2", ...]
}
```
- `scenario_ids`: array of UUID strings (1–200 items)

**Response (200):**
```json
{
  "results": [
    {
      "id": "result-uuid",
      "data": <any JSON>,
      "user_id": "user-uuid",
      "scenario_id": "scenario-uuid",
      "inserted_at": "2026-05-19T...",
      "stars": 2,
      "attempt_id": "attempt-uuid"
    },
    ...
  ]
}
```
Returns only the *latest* result per scenario. Scenarios with no results are omitted.

---

## Authentication

All endpoints use the same auth middleware:

1. **Bearer token**: Pass `Authorization: Bearer <auth_token>` header
2. **Cookie**: Alternatively, set an `auth_token` cookie
3. **User selection**: Pass `x-sn-user-id: <user_uuid>` header to select which user profile to act as (required for family accounts with multiple profiles)

The token is validated against the database, and the selected user must belong to the authenticated family.

---

## Quick Reference

| Method | Endpoint                                  | Description                           |
|--------|-------------------------------------------|---------------------------------------|
| GET    | `/api/kv/:key`                            | Get global KV value                   |
| PUT    | `/api/kv/:key`                            | Set global KV value                   |
| POST   | `/api/kv/bulk`                            | Bulk get global KV values             |
| GET    | `/api/users/kv`                           | List all user KV entries              |
| GET    | `/api/users/kv/:key`                      | Get user-scoped KV value              |
| PUT    | `/api/users/kv/:key`                      | Set user-scoped KV value              |
| POST   | `/api/users/kv/bulk`                      | Bulk get user-scoped KV values        |
| POST   | `/api/speak/scenarios/:id/result`         | Submit a scenario result              |
| POST   | `/api/speak/scenarios/results`            | Get latest results for scenario IDs   |
