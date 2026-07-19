---
task_id: TASK-005
task_type: feature
status: approved
owner: human-approval-required
---

# TASK-005 — Session management endpoints (AUTH_DRIVER=session)

## Original request

Четверте - якщо AUTH_DRIVER=session я хочу щоб ти додав нові ендпоінти GET /sessions який поверне всі сесії користувача з усіма метаданими необхідними, DELETE /session/:id та решта необхідних можливо ендпоінтів для роботи з сесіями ( можна в описі API якось виділити це, що це лише якщо мод сесія доступно )

## Human decisions (2026-07-19)

1. **JWT-mode + OpenAPI strategy:** **B — always register routes**; under `AUTH_DRIVER=jwt` reject with a clear machine-readable error (e.g. `SESSION_DRIVER_REQUIRED`). OpenAPI always documents the endpoints with explicit “only when `AUTH_DRIVER=session`” wording.
2. **Discretionary endpoints:** **include both** revoke-others and revoke-all in this task’s required scope (no longer discretionary for delivery).

## Problem or opportunity

When `AUTH_DRIVER=session`, the starter issues an httpOnly session cookie backed by Redis, but the authenticated user has no HTTP API to inspect or revoke their other sessions (for example after a stolen device or shared browser). Today the only session revocation path is `POST /auth/logout`, which targets the current cookie session only. JWT mode already has family-based refresh revocation; session mode needs an equivalent “manage my sessions” surface.

## Goal

When `AUTH_DRIVER=session`, expose authenticated session-management endpoints so a user can list their own sessions (with useful metadata), revoke a specific session, revoke all other sessions, and revoke all sessions including current. Document in OpenAPI that these operations apply only when the session auth driver is enabled; routes stay registered under JWT and reject clearly (strategy B). When required metadata is not stored today, extend the Redis session data model accordingly.

## Users and actors

- **Authenticated end user** (session cookie): lists and revokes their own sessions.
- **API client / OpenAPI consumer**: discovers driver-conditional availability from the generated contract.
- **Operator / deployer**: selects `AUTH_DRIVER=session` vs `jwt`; under JWT expects registered routes that reject with `SESSION_DRIVER_REQUIRED` (or equivalent).

## Current system context

Evidence from the current codebase (not assumed from docs alone):

- **Driver composition:** `AuthApplicationCompositionModule` (`apps/api/src/composition/auth-application.module.ts`) wires `AuthModule.forRootAsync` with either `resolveSessionUser` (`AUTH_DRIVER=session`) or `resolveAccessUser` (`AUTH_DRIVER=jwt`). Only one driver branch is instantiated (`AuthModule` / module-portability rule).
- **Config:** `AUTH_DRIVER` is `jwt | session` (default `jwt`) in `libs/infrastructure/src/config/env.schema.ts`, with `AUTH_SESSION_TTL_SECONDS` (default `604800`) and cookie knobs `AUTH_SESSION_COOKIE_*`.
- **Session persistence:** `RedisSessionStore` (`libs/infrastructure/src/auth/redis-session-store.service.ts`) stores a single key `sessions:{sessionId}` with JSON payload. There is **no** per-user index of session IDs, so listing sessions by user is impossible without scanning Redis or adding a secondary index.
- **Session record shape:** `SessionRecord` (`libs/contracts/src/auth/session-record.ts`) is only `{ userId, authVersion }`. No `createdAt`, `lastActivityAt`, `ip`, `userAgent`, `expiresAt`, or “current” flag. Expiry exists only as Redis key TTL; `createAuthSession` returns `expiresAt` to the client at login time but does not persist it in the record.
- **Create path:** `LoginUseCase` calls `IAuthTokenService.createAuthSession` with user id / email / roles / authVersion only — **no IP or User-Agent** is passed from `AuthController.login`. Request middleware (`RequestContextMiddleware`) tracks request/correlation IDs only, not client network metadata.
- **Current session identity:** `AuthGuard` accepts Bearer first, else cookie named `AppConfigService.auth().sessionCookieName` (default `sid`). `SessionCookieService` attaches/clears that cookie when `sessionId` is present.
- **Revoke today:** `LogoutUseCase` → `SessionAuthTokenService.revoke({ sessionId })` → `sessionStore.delete(sessionId)`. No list/delete-by-id use cases or controllers exist. `ISessionStore` exposes only `create` / `get` / `delete`.
- **HTTP surface:** `AuthController` under `/auth/*` is always registered in `ApiModule`. OpenAPI (`create-openapi-document.ts` + `openapi-contract.spec.ts`) already describes driver-conditional fields on login/logout/refresh; there is no `/sessions` route and no pattern yet for registering controllers only for one driver.
- **Storage backend:** sessions are Redis-only (not PostgreSQL). README §16.1 documents session cookie behavior and notes that changing Redis session JSON shape is a breaking change for existing sessions.

## Functional requirements

- **FR-01:** When `AUTH_DRIVER=session`, the API shall provide `GET /sessions` for the authenticated user, returning all of that user’s active Redis sessions with session-management metadata (see FR-03 / FR-04).
- **FR-02:** When `AUTH_DRIVER=session`, the API shall provide `DELETE /sessions/:id` to revoke exactly one session owned by the authenticated user (path uses plural resource collection for REST consistency with `GET /sessions`; the original request’s singular `/session/:id` is treated as the same resource — see Assumptions).
- **FR-03 (required metadata on list/detail payloads):** Each listed session item shall include at least:
  - `id` (session id);
  - `createdAt` (ISO-8601);
  - `lastActivityAt` (ISO-8601; may equal `createdAt` until activity tracking is implemented);
  - `expiresAt` (ISO-8601; derived from Redis TTL and/or stored value);
  - `ip` (string or `null` if unknown);
  - `userAgent` (string or `null` if unknown);
  - `isCurrent` (boolean: whether this session is the one authenticating the request).
- **FR-04 (data-model prerequisite):** Because current `SessionRecord` and `ISessionStore` cannot satisfy FR-01/FR-03, this task **includes** extending the Redis session model and store API as needed (fields + ability to enumerate sessions for a user). PostgreSQL schema/migrations are not required unless a human decision chooses PG persistence (default: Redis-only).
- **FR-05 (login capture):** Session creation (`POST /auth/login` session path) shall persist client `ip` and `userAgent` when available from the HTTP request into the new session record. Exact extraction source (e.g. `req.ip` / `X-Forwarded-For` trust) is an implementation detail subject to NFR-03 and open questions.
- **FR-06 (ownership):** A user may list and revoke **only** their own sessions. Attempting to revoke another user’s session id must not succeed and must not confirm cross-user existence beyond the chosen error semantics (see open questions).
- **FR-07 (current-session delete):** Deleting the session that matches the request’s session cookie shall revoke that Redis session and clear the session cookie on the response (same cookie-clearing behavior as logout), so the client is logged out. Alternative semantics (forbid delete of current; require `POST /auth/logout`) require human approval — see open questions; default assumption is allow + clear cookie.
- **FR-08 (required — revoke others):** Provide `DELETE /sessions/others` that revokes all of the user’s sessions **except** the current one. Current session remains valid; cookie unchanged.
- **FR-09 (required — revoke all including current):** Provide `DELETE /sessions` that revokes **every** session for the user and clears the current session cookie (sign out everywhere).
- **FR-10 (JWT driver behavior):** When `AUTH_DRIVER=jwt`, session-management routes remain registered but must reject with a stable error (strategy **B**, human decision). OpenAPI still documents them with session-only descriptions.
- **FR-11 (OpenAPI highlighting):** Every session-management operation’s OpenAPI `summary`/`description` (and preferably tag description) must state clearly that the endpoint is available only when `AUTH_DRIVER=session`.
- **FR-12 (auth):** Session-management endpoints require authentication via the configured session cookie (`ApiCookieAuth` / `AuthGuard` session path). They are not part of the public unauthenticated surface.
- **FR-13 (response envelope):** Success responses follow the existing `{ success: true, data: ... }` pattern; errors use the shared `ErrorEnvelopeDto` (`success: false`, `error.code` / `message` / `details`).
- **FR-14 (idempotent delete):** `DELETE /sessions/:id` for an already-deleted or unknown-but-not-owned id follows the chosen not-found semantics (open question) and must not delete another user’s session.
- **FR-15 (docs baseline):** Update starter-facing docs that describe session auth (`README.md` §16.1 and/or `EXAMPLES.md` as applicable) so they mention session-management endpoints and driver gating, aligned with the implemented contract.

### Endpoint summary (all required)

| Endpoint                  | Priority         | Notes                                              |
| ------------------------- | ---------------- | -------------------------------------------------- |
| `GET /sessions`           | **Required**     | List own sessions + metadata                       |
| `DELETE /sessions/:id`    | **Required**     | Revoke one own session                             |
| `DELETE /sessions/others` | **Required**     | Revoke all except current                          |
| `DELETE /sessions`        | **Required**     | Revoke all including current (sign out everywhere) |
| `GET /sessions/:id`       | **Out of scope** | List already returns full metadata                 |

## Non-functional requirements

- **NFR-01:** Preserve layering: application use cases depend on Contracts ports (`ISessionStore` / `IAuthTokenService` extensions as needed); Redis details stay in Infrastructure; API controllers remain thin.
- **NFR-02:** Listing sessions for a user must be efficient enough for normal interactive use (prefer an explicit per-user Redis index over full keyspace `SCAN` as the primary design). Document any Redis key/TTL coupling so session keys and index membership stay consistent on create/delete/expiry.
- **NFR-03:** Do not log raw session ids, full cookies, or secrets. IP / User-Agent may be stored for security UX but must not be written to logs at info level in bulk.
- **NFR-04:** Extending `SessionRecord` is a **breaking change** for existing Redis sessions (README already notes this class of change). Rollout must either invalidate old sessions or tolerate legacy records with null metadata (human choice — see open questions).
- **NFR-05:** No new npm dependencies unless planning proves an existing Nest/Redis capability is insufficient.
- **NFR-06:** OpenAPI drift tests and typed DTOs must stay aligned with runtime responses for the session-driver build under test.

## Public API and interface impact

### HTTP API contract

#### Methods and paths (all required)

| Method   | Path               | Auth                      | Purpose                               |
| -------- | ------------------ | ------------------------- | ------------------------------------- |
| `GET`    | `/sessions`        | Session cookie (required) | List authenticated user’s sessions    |
| `DELETE` | `/sessions/:id`    | Session cookie (required) | Revoke one own session by id          |
| `DELETE` | `/sessions/others` | Session cookie (required) | Revoke all sessions except current    |
| `DELETE` | `/sessions`        | Session cookie (required) | Revoke all sessions including current |

Nest route ordering must register `/sessions/others` before `/sessions/:id` so `others` is not captured as an id.

#### Request parameters

- **`GET /sessions`:** no path/query body required. Optional future filters (pagination) are **out of scope** unless session counts become large enough to require them (not evidenced today).
- **`DELETE /sessions/:id`:** path param `id` — non-empty string (UUID as produced by current `randomUUID()` session ids). Invalid/missing id → `400` validation via existing pipes/DTO patterns.
- **`DELETE /sessions/others` / `DELETE /sessions`:** no body.

#### Success responses

- **`GET /sessions` → `200`:**

```json
{
  "success": true,
  "data": {
    "sessions": [
      {
        "id": "<session-id>",
        "createdAt": "2026-07-19T09:00:00.000Z",
        "lastActivityAt": "2026-07-19T10:00:00.000Z",
        "expiresAt": "2026-07-26T09:00:00.000Z",
        "ip": "203.0.113.10",
        "userAgent": "Mozilla/5.0 ...",
        "isCurrent": true
      }
    ]
  }
}
```

- **`DELETE /sessions/:id` → `200`:** `{ "success": true }` (align with `LogoutResponseDto` style). If the deleted session was current, response **must** include `Set-Cookie` clearing the session cookie (same attributes as logout clear).
- **`DELETE /sessions/others` → `200`:** `{ "success": true, data: { revokedCount: number } }` (or `{ success: true }` if count is deferred — prefer including `revokedCount`).
- **`DELETE /sessions` → `200`:** `{ "success": true }` and **must** clear the session cookie.

#### Error status codes (shared envelope `ErrorEnvelopeDto`)

| Status                           | When                                                                                                                              |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `401`                            | Missing/invalid session cookie (or auth credential not accepted for these routes)                                                 |
| `400`                            | Invalid path param / validation failure                                                                                           |
| `404`                            | Session id not found **for this user** (recommended default; see open questions for 403 alternative)                              |
| `404` or documented driver error | Entire capability rejected when `AUTH_DRIVER=jwt` — strategy **B**: routes registered, stable code e.g. `SESSION_DRIVER_REQUIRED` |
| `429`                            | If rate-limited consistently with other auth-adjacent routes (recommended for delete/list)                                        |
| `500`                            | Unexpected server error                                                                                                           |

#### Authentication / authorization

- Require authenticated user via session cookie (`AUTH_SESSION_COOKIE_NAME`, default `sid`).
- OpenAPI: `ApiCookieAuth('sessionCookie')` on these operations; do **not** advertise Bearer as a supported way to call session-management endpoints (session driver is the product surface). If `AuthGuard` still accepts Bearer when a JWT is somehow presented under session driver, that is pre-existing guard behavior — session-management use cases must still authorize by the resolved `CurrentUser.id` and session ownership, not by trusting a client-supplied user id.
- Authorization rule: `session.userId === request.user.id`.

#### Significant headers and cookies

- **Request:** Cookie header with configured session cookie name (required).
- **Response (`DELETE` current session):** `Set-Cookie` clearing session cookie (`Max-Age=0` / `clearCookie`), matching `SessionCookieService.clear`.
- **Response (other deletes):** no cookie change required.
- No new custom response headers required.

#### OpenAPI schemas / decorators to add or update

- New controller (or dedicated methods) under an OpenAPI tag such as `Sessions` with tag/operation description: **“Only available when AUTH_DRIVER=session.”**
- DTOs (names indicative): `SessionListItemDto`, `SessionsListDataDto`, `SessionsListResponseDto`, path DTO for `:id`, delete success DTO reusing logout-style `{ success: true }` if appropriate.
- Register extra models in `create-openapi-document.ts` `extraModels` as needed.
- Update `openapi-contract.spec.ts` expectations for the new paths/schemas **for the session-driver documentation strategy chosen in open questions**.
- Global API description may briefly note session-management endpoints are session-driver-only.

#### OpenAPI vs runtime driver matrix (must be decided)

| Strategy                         | Runtime when `AUTH_DRIVER=jwt`                                                          | OpenAPI contents                                                           | Notes                                                                                                          |
| -------------------------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| **A — Conditional registration** | Routes not registered → framework `404`                                                 | Document generated for a given driver may omit routes if controller absent | Drift tests must pin driver under test; dual-driver docs may need two fixtures or always-include + description |
| **B — Always register, reject**  | Routes present → `404` or `501` with explicit error code e.g. `SESSION_DRIVER_REQUIRED` | Routes always in OpenAPI with session-only description                     | Simpler single OpenAPI artifact; matches how `/auth/refresh` remains registered but rejects under session      |
| **C — Hybrid**                   | Conditional registration + OpenAPI always documents with session-only warning           | Docs can drift from a jwt-only running process                             | Only acceptable if drift test uses session composition or static document merge                                |

**Decided:** strategy **B** (always document + reject under jwt with a clear error).

### Acceptance criterion linking OpenAPI to runtime

- **AC-OpenAPI:** Generated OpenAPI includes `GET /sessions`, `DELETE /sessions/{id}`, `DELETE /sessions/others`, and `DELETE /sessions` with summaries/descriptions stating session-driver-only availability; documents cookie security scheme; documents `200` success schemas and at least one `4xx` error schema reference (`ErrorEnvelopeDto`); and the OpenAPI drift test fails if those operations/schemas regress. Runtime behavior under `AUTH_DRIVER=session` must match the documented success/error statuses.

## Data model and migration impact

- **Redis `SessionRecord` extension (in scope):** add fields needed for FR-03 (at minimum `createdAt`, `lastActivityAt`, `ip`, `userAgent`; `expiresAt` may be computed from TTL). Keep `userId` and `authVersion`.
- **Per-user session index (in scope):** e.g. Redis set/zset `sessions:user:{userId}` members = session ids, with TTL/membership maintenance on create/delete and a defined strategy for Redis key expiry (TTL on session key must remove or tolerate stale index members on list).
- **`ISessionStore` port expansion (in scope):** methods such as `listByUser(userId)`, `delete(sessionId)`, optionally `touch(sessionId)` for last activity — exact signatures left to planning, but capability is required.
- **PostgreSQL / Drizzle migrations:** **not required** under default Redis-only assumption.
- **Existing sessions:** deploying the new JSON shape without a dual-read strategy invalidates or breaks old sessions (README precedent). See open questions for invalidate-all vs legacy-null metadata.

## Events, queues and background processing

- No Outbox events, BullMQ jobs, or cron schedules are required for MVP session management.
- Optional future: emit domain/application events on remote revoke — **out of scope**.

## Security and authorization

- Authenticated user scope only; no admin “list all users’ sessions” API.
- Ownership checks on every revoke.
- Deleting another user’s id must fail closed.
- Clearing cookie when revoking the current session prevents continued use of a deleted sid.
- Rate-limit list/delete similarly to other authenticated sensitive routes (recommendation; exact limits can mirror `auth:me` or a dedicated prefix).
- Do not return other users’ metadata. Prefer `404` over `403` for cross-user ids to reduce session-id oracle usefulness (assumption; open question).
- Session ids remain high-entropy UUIDs; still treat them as secrets (httpOnly cookie; avoid putting sid in URLs except the revoke path param, which is authenticated).

## Entrypoints and deployment impact

- **API only:** new controller/use cases/composition wiring under `apps/api` + contracts/application/infrastructure auth session store.
- **Worker / Cron / Migrations:** no required changes.
- **Config:** no new env vars strictly required for MVP; optional knobs (e.g. whether to refresh TTL on activity) are open questions.
- **Deploy note:** Redis session format change may force re-login for existing session-driver deployments (NFR-04).

## Observability and operations

- Structured logs may record `userId`, count of sessions listed/revoked, and whether current session was revoked — not raw session ids at info level.
- No new metrics required for MVP; optional counters left to implementer discretion without expanding scope.

## Compatibility requirements

- **JWT deployments:** must not gain a working session-management feature; behavior per FR-10 / open question.
- **Session deployments:** existing clients using only `/auth/*` continue to work; new endpoints are additive.
- **Breaking:** Redis session JSON / index layout change for session driver (document in README).
- Do not change JWT refresh-family storage in this task.

## Dependencies

- Existing Redis module / `RedisService`.
- Existing `AuthGuard`, `SessionCookieService`, `AuthApplicationCompositionModule`, `IAuthTokenService` / `ISessionStore`.
- No dependency on TASK-003 JWT cookie parity work; discretionary “revoke all” may later share a port method with password-change flows, but this task must not block on TASK-003.

## Assumptions

- **A-01:** This is a **feature** task, not a backlog bugfix.
- **A-02:** Path collection is `/sessions` and item revoke is `DELETE /sessions/:id` (plural), despite the original singular `/session/:id`. If TASK-002 (URI versioning) is implemented first, these routes inherit the `/v1` prefix automatically (`/v1/sessions...`).
- **A-03:** Persistence remains Redis-only; no PostgreSQL sessions table.
- **A-04:** Required metadata includes created/last activity timestamps, expiry, IP, user-agent, and `isCurrent`; “all necessary metadata” does not include device fingerprinting, geo-IP enrichment, or editable session labels unless separately requested.
- **A-05:** OpenAPI/runtime strategy **B** is **decided** (always register; jwt rejects with explicit error).
- **A-06:** Until human decides otherwise, deleting the current session via `DELETE /sessions/:id` is allowed and clears the cookie.
- **A-07:** Until human decides otherwise, unknown/non-owned session ids return `404` with the shared error envelope.
- **A-08:** `lastActivityAt` may be updated on authenticated requests that verify the session (best-effort); if planning finds that too invasive, updating only on login + explicit session endpoints is acceptable as long as the field exists and is documented.
- **A-09:** Revoke-others and revoke-all are **required** for this task (human decision 2026-07-19). Path spelling: `DELETE /sessions/others` and `DELETE /sessions`.
- **A-10:** INDEX.md update for this task is handled centrally by the parent agent.

## Out of scope

- JWT refresh-family listing UI/API (“list my devices” for JWT).
- Admin or cross-user session administration.
- Changing default `AUTH_DRIVER`.
- Social login / password-change flows (except not conflicting with future revoke-all ports).
- Migrating sessions into PostgreSQL.
- Pagination/filtering/sorting beyond a simple full list.
- Mobile push notification on remote revoke.
- Implementing only list/delete-one without revoke-others/all (both are now required).
- Editing `docs/agent-tasks/INDEX.md` in analyst passes (parent-owned).

## Acceptance criteria

- **AC-01:** With `AUTH_DRIVER=session` and a valid session cookie, `GET /sessions` returns `200` and `data.sessions` containing every active session for that user, each with the FR-03 fields, and exactly one item has `isCurrent: true` matching the request cookie session.
- **AC-02:** After login from two distinct clients (two session ids) for the same user, `GET /sessions` returns both; `DELETE /sessions/:id` for the non-current id removes only that session; subsequent `GET /sessions` omits it; the current session still authenticates.
- **AC-03:** `DELETE /sessions/:id` for the current session returns `200`, deletes the Redis record, and clears the session cookie; a follow-up authenticated request with that cookie fails with `401`.
- **AC-04:** `DELETE /sessions/:id` for a session id belonging to another user (or nonexistent under the ownership rule) does not delete that session and returns the agreed client error (`404` per A-07 unless human overrides).
- **AC-05:** Unauthenticated `GET /sessions` and `DELETE /sessions/:id` return `401` with `ErrorEnvelopeDto`.
- **AC-06:** New sessions created via `POST /auth/login` under session driver persist `ip` and `userAgent` when present on the request such that they appear on `GET /sessions`.
- **AC-07:** OpenAPI documents both required endpoints with explicit session-driver-only wording, cookie auth, success and error responses; drift test (or agreed session-driver OpenAPI test) covers the new paths/schemas (**AC-OpenAPI**).
- **AC-08:** With `AUTH_DRIVER=jwt`, session-management routes respond with the strategy-B driver error (not a successful list/revoke); covered by at least one automated test.
- **AC-09:** `ISessionStore` / Redis implementation can enumerate sessions by user without relying on unbounded production `KEYS *` as the primary mechanism.
- **AC-10:** README and/or EXAMPLES mention the session-management endpoints and that they apply only when `AUTH_DRIVER=session`.
- **AC-11:** `DELETE /sessions/others` revokes every non-current session and leaves the current session usable; `DELETE /sessions` revokes all and clears the cookie.
- **AC-12:** Required verification commands for the change set pass: at least `npm run build:api`, `npm run lint`, and relevant unit/OpenAPI tests; record command/result/conclusion in the implementation report.

## Verification strategy

- Static: inspect diff for controller DTOs, OpenAPI decorators, `SessionRecord` / `ISessionStore` / Redis store, composition registration, ownership checks, cookie clear on current-session delete.
- Automated: unit tests for store list/index consistency and use cases (ownership, current flag, delete current); OpenAPI contract test updates; module/API tests with `AUTH_DRIVER=session` (and jwt negative case).
- Runtime (when Redis available): login twice → list → delete other → delete current → confirm `401`; under jwt confirm chosen negative behavior.
- Do not treat documentation alone as proof of runtime behavior.

## Rollout and rollback

- **Rollout:** deploy API with Redis session format/index changes; expect existing session-driver users to re-authenticate if dual-read is not implemented.
- **Rollback:** revert API deploy; orphan new Redis keys/fields are harmless if old code only reads `userId`/`authVersion` — but old code **cannot** list sessions. Prefer documenting a short maintenance window for session-driver environments.
- **Feature flag:** not required beyond `AUTH_DRIVER` itself.

## Open questions requiring human decision

1. **JWT-mode behavior + OpenAPI strategy:** **Decided — B** (always register + reject under jwt).
2. **Delete current session via `DELETE /sessions/:id`:** Allow + clear cookie (default), or reject and require `POST /auth/logout` / `DELETE /sessions`?
3. **Error for non-owned / missing session id:** `404` (default) vs `403`?
4. **Legacy Redis sessions after record shape change:** invalidate/expire all on deploy vs dual-read with null metadata for missing fields?
5. **Last-activity updates:** touch on every authenticated request vs only on login / session endpoints?
6. **Discretionary endpoints:** **Decided — include revoke-others and revoke-all** (`DELETE /sessions/others`, `DELETE /sessions`).
7. **Path spelling:** **Decided** as above unless human overrides.
8. **IP extraction trust:** use Express `req.ip` only, or honor `X-Forwarded-For` when behind a proxy (requires trusting proxy config)?
9. **Rate-limit policy:** reuse global authenticated limits, mirror `auth:me`, or dedicated stricter limits on delete?
10. **Should session-management routes hard-require the session cookie only**, or allow Bearer if the guard resolves a user under session driver?
