---
task_id: TASK-005
specification: docs/agent-tasks/TASK-005-session-management-endpoints.md
status: approved
owner: human-approval-required
---

# TASK-005 — Implementation plan

## Approved specification

- Spec: `docs/agent-tasks/TASK-005-session-management-endpoints.md`
- Spec status: `approved` (verified in file frontmatter before planning)
- Human decisions already frozen in the spec / request:
  1. **JWT-mode + OpenAPI strategy B** — always register routes; under `AUTH_DRIVER=jwt` reject with clear machine-readable error `SESSION_DRIVER_REQUIRED`; OpenAPI always documents endpoints with explicit “only when `AUTH_DRIVER=session`” wording
  2. **Revoke-others and revoke-all are required** — `DELETE /sessions/others` and `DELETE /sessions`

### Planner-frozen defaults (were open in the spec)

| ID | Decision | Rationale |
| -- | -------- | --------- |
| **OQ-2** | Allow `DELETE /sessions/:id` on the **current** session and **clear the cookie** | Spec assumption **A-06** |
| **OQ-3** | Non-owned / missing session id → **`404`** `SESSION_NOT_FOUND` (shared envelope) | Spec assumption **A-07**; reduces session-id oracle usefulness vs 403 |
| **OQ-4** | **Dual-read** legacy Redis JSON: missing metadata fields → `null` / sensible defaults; sessions **without** the new per-user index are omitted from list until re-login | Avoids hard crash on old keys; README already warns format changes; no Redis `SCAN` to recover orphans |
| **OQ-5** | **MVP `lastActivityAt`:** set equal to `createdAt` on create; do **not** touch on every authenticated request | Spec **A-08** allows this; avoids invasive `AuthGuard` / `verifyAccessToken` writes |
| **OQ-8** | Capture client IP via Express **`req.ip`** (API already `set('trust proxy', 1)` in `apps/api/src/main.ts`); User-Agent via `req.get('user-agent')` | No new env; matches existing proxy trust |
| **OQ-9** | Dedicated rate-limit key prefixes `sessions:*` with limits aligned to authenticated sensitive routes (`auth:me`-style: e.g. list `limit: 30` / `ttlSeconds: 60`; deletes `limit: 10` / `ttlSeconds: 60`) | Spec recommendation; keeps auth bucket separate |
| **OQ-10** | Session-management routes **hard-require** the session cookie for “current session” identity; OpenAPI advertises **only** `ApiCookieAuth('sessionCookie')` | Spec product surface; if `AuthGuard` somehow authenticated via Bearer, controller still requires cookie or returns `401` |
| **Driver error status** | `SESSION_DRIVER_REQUIRED` as **`ValidationError` → HTTP 400** | Stable machine-readable code; analogous to other capability mismatches; OpenAPI documents `400` |
| **Port shape** | New **`ISessionManagementService`** (+ rejecting stub under JWT) rather than bloating `IAuthTokenService` | Mirrors TASK-004 Google stub pattern; keeps JWT token service free of session-list APIs |

**Branch note:** Working tree is clean on `main` (TASK-002/003/004 already merged). Do **not** mix Google SSO or password-reset work into this task.

## Current implementation

Inspected evidence (code, not docs alone):

| Area | Current behavior |
| ---- | ---------------- |
| URI versioning | `apps/api/src/main.ts` — `setGlobalPrefix('v1')`; controllers stay `@Controller('…')`; public paths `/v1/sessions…` |
| HTTP Auth | `AuthController` under `/auth/*` — register/login/logout/refresh/me + password + (separate) Google SSO; **no** `/sessions` routes |
| Composition | `AuthApplicationCompositionModule` wires auth use cases + `AuthModule.forRootAsync` (exactly one of jwt/session) |
| Session store | `RedisSessionStore` — key `sessions:{sessionId}` JSON; **no** per-user index; `ISessionStore` = `create` / `get` / `delete` only |
| Session record | `SessionRecord` = `{ userId, authVersion }` only |
| Create path | `LoginUseCase` → `IAuthTokenService.createAuthSession(CurrentUser)` — **no** IP/UA; `SessionAuthTokenService` writes minimal record |
| Current session id | `AuthGuard` verifies Bearer **or** cookie but does **not** attach `sessionId` to the request; logout extracts cookie via `SessionCookieService` |
| Request context | `RequestContextMiddleware` — request/correlation ids only (no IP/UA) |
| RedisService | get/set/del/ttl/scan/eval/… — **no** set (`SADD`/`SMEMBERS`/`SREM`) helpers yet |
| AuthModule async | `forRootAsync` builds `RedisSessionStore` **inside** the `AuthTokenService` factory; **`TOKENS.SessionStore` is not registered/exported** on the async path (sync `forRoot` does export it) |
| Errors | `GlobalExceptionFilter` maps `ValidationError`→400, `NotFoundError`→404, `AuthenticationError`→401 |
| OpenAPI | `create-openapi-document.ts` + `openapi-contract.spec.ts`; strategy-B precedent: Google routes always documented, disabled → `GOOGLE_SSO_DISABLED` |
| Docs | README §16.1 session mode + breaking-change note for Redis JSON shape; EXAMPLES session login/logout — **no** session-management endpoints |
| Trust proxy | `application.set('trust proxy', 1)` already set |

## Architecture decision

### 1. Always-on HTTP surface + driver reject (strategy B)

- Add `SessionsController` `@Controller('sessions')`, always registered in `ApiModule` beside `AuthController`.
- Under `AUTH_DRIVER=jwt`, operations call an **`UnsupportedSessionManagementService`** that throws `ValidationError('SESSION_DRIVER_REQUIRED', …)` → HTTP **400** + `ErrorEnvelopeDto`.
- Under `AUTH_DRIVER=session`, operations use a Redis-backed **`RedisSessionManagementService`**.
- OpenAPI always includes the four operations with explicit session-driver-only wording (tag + each `summary`/`description`).

### 2. Contracts: store expansion + management port

**`SessionRecord`** (Redis JSON) becomes:

```ts
{
  userId: string;
  authVersion: number;
  createdAt: string;       // ISO-8601
  lastActivityAt: string;  // ISO-8601 (MVP: equals createdAt)
  ip: string | null;
  userAgent: string | null;
}
```

`expiresAt` is **not** required in the stored JSON: compute on read as `now + ttlSeconds` from `RedisService.ttl(sessionKey)`, or if TTL is missing/`-1`, fall back to `createdAt + configured session TTL` when available. List items always expose ISO-8601 `expiresAt`.

**`ISessionStore`** expands to support FR-01/FR-04/AC-09:

- `create(record, ttlSeconds): Promise<string>` — also maintains per-user index
- `get(sessionId): Promise<SessionRecord | null>` — dual-read legacy (missing fields → nulls / `createdAt` fallback)
- `delete(sessionId): Promise<void>` — deletes key **and** removes id from user index when `userId` known
- `listByUserId(userId: string): Promise<Array<{ id: string; record: SessionRecord; expiresAt: Date }>>` — reads index, loads keys, **prunes stale index members** whose session key is gone (no `KEYS *` / unbounded `SCAN` of all sessions)

**Per-user index (logical keys):**

```text
sessions:{sessionId}              → JSON SessionRecord, TTL = session TTL
sessions:user:{userId}            → Redis SET of sessionId members (no hard dependency on SCAN)
```

On `create`: `SET` session key + `SADD` user set. Optionally refresh a generous TTL on the user set (e.g. same as session TTL) so abandoned user sets do not live forever; stale members are pruned on list.

**`ISessionManagementService`** (new port + `TOKENS.SessionManagementService`):

- `listForUser(userId, currentSessionId): Promise<SessionListItem[]>` — adds `isCurrent`
- `revokeOne(userId, sessionId, currentSessionId): Promise<{ clearedCurrent: boolean }>` — ownership check; 404 if not found/not owned
- `revokeOthers(userId, currentSessionId): Promise<{ revokedCount: number }>`
- `revokeAll(userId): Promise<void>`

JWT composition wires the unsupported stub. Session composition wires Redis implementation over `ISessionStore`.

### 3. Application use cases (thin)

Four use cases (plain TS classes, Nest wiring only in composition):

| Use case | Responsibility |
| -------- | -------------- |
| `ListSessionsUseCase` | Delegate to management port |
| `RevokeSessionUseCase` | Delegate revoke-one; return `clearedCurrent` |
| `RevokeOtherSessionsUseCase` | Delegate revoke-others; return `revokedCount` |
| `RevokeAllSessionsUseCase` | Delegate revoke-all |

Ownership and driver rejection live in the management service (single place). Use cases stay free of Redis and Nest.

### 4. Login client metadata (FR-05)

- Extend `IAuthTokenService.createAuthSession(user, clientMeta?: { ip?: string \| null; userAgent?: string \| null })`.
- `SessionAuthTokenService` persists `ip` / `userAgent` (null when absent) plus timestamps.
- `JwtAuthTokenService` ignores `clientMeta` (signature-compatible).
- `AuthController.login` passes `req.ip` and User-Agent into `LoginUseCase`.
- Other `createAuthSession` callers (Google, change/reset password) may omit meta → null fields (FR-05 requires login only; do not expand those flows beyond optional nulls).

### 5. Cookie / current-session semantics

- Controller extracts `currentSessionId` via `SessionCookieService.getSessionIdFromCookies`.
- Missing cookie on session-management routes → `401` (Unauthorized), even if Bearer somehow passed `AuthGuard`.
- Revoking current session (`DELETE /sessions/:id` match or `DELETE /sessions`) → `sessionCookieService.clear(res)` (same attributes as logout).
- `DELETE /sessions/others` does **not** clear the cookie.

### 6. Nest route order

Register in this order inside `SessionsController`:

1. `DELETE others`
2. `DELETE` (collection / revoke-all)
3. `DELETE :id`
4. `GET` (list)

so `others` is never captured as `:id`.

### 7. AuthModule / Redis plumbing

- Extend `RedisService` with set helpers used by the store (`sadd` / `smembers` / `srem`, or a small multi-key Lua for create/delete consistency). **No new npm dependency.**
- Prefer registering `RedisSessionStore` + `TOKENS.SessionStore` on the **session** branch of `AuthModule.forRootAsync` (or construct `new RedisSessionStore(redis)` inside the session-driver management factory). Either way, logout/`delete` must go through the expanded `delete` that maintains the user index — **update `RedisSessionStore.delete`**, which `SessionAuthTokenService.revoke` already calls.

## Scope

- Redis `SessionRecord` + per-user index + `ISessionStore.listByUserId`
- `ISessionManagementService` real + JWT rejecting stub
- Four authenticated HTTP endpoints under `/v1/sessions…`
- Login capture of IP / User-Agent into new sessions
- OpenAPI schemas/decorators + drift-test updates
- README §16.1 and/or EXAMPLES session-management documentation
- Unit tests for store index consistency, use cases (ownership, current flag, driver reject), OpenAPI contract expectations
- Verification: `build:api`, `lint`, relevant unit/OpenAPI tests

## Out of scope

- JWT refresh-family “list my devices”
- Admin / cross-user session APIs
- `GET /sessions/:id`
- PostgreSQL session persistence / migrations
- Pagination / filtering / sorting
- Touching `lastActivityAt` on every authenticated request
- Changing default `AUTH_DRIVER`
- Google SSO / password-change behavior beyond optional null metadata on their `createAuthSession` calls
- New npm dependencies
- Worker / Cron / Migrations entrypoint changes
- Unrelated TASK-004 cleanup

## Files to create

| Path | Purpose |
| ---- | ------- |
| `libs/contracts/src/auth/session-management.service.ts` | `ISessionManagementService` + list-item types |
| `libs/application/src/use-cases/auth/list-sessions.usecase.ts` | List use case |
| `libs/application/src/use-cases/auth/list-sessions.usecase.spec.ts` | Unit tests |
| `libs/application/src/use-cases/auth/revoke-session.usecase.ts` | Revoke-one use case |
| `libs/application/src/use-cases/auth/revoke-session.usecase.spec.ts` | Unit tests |
| `libs/application/src/use-cases/auth/revoke-other-sessions.usecase.ts` | Revoke-others use case |
| `libs/application/src/use-cases/auth/revoke-other-sessions.usecase.spec.ts` | Unit tests |
| `libs/application/src/use-cases/auth/revoke-all-sessions.usecase.ts` | Revoke-all use case |
| `libs/application/src/use-cases/auth/revoke-all-sessions.usecase.spec.ts` | Unit tests |
| `libs/infrastructure/src/auth/redis-session-management.service.ts` | Redis-backed management adapter |
| `libs/infrastructure/src/auth/unsupported-session-management.service.ts` | JWT stub → `SESSION_DRIVER_REQUIRED` |
| `libs/infrastructure/src/auth/redis-session-store.service.spec.ts` | Store/index unit tests (if none exist) |
| `apps/api/src/controllers/sessions.controller.ts` | HTTP surface |
| `apps/api/src/dto/sessions/session-id-param.dto.ts` | `:id` validation (`IsUUID` / non-empty) |
| `apps/api/src/dto/sessions/sessions-response.dto.ts` | `SessionListItemDto`, list/revoke response DTOs |

## Files to modify

| Path | Change |
| ---- | ------ |
| `libs/contracts/src/auth/session-record.ts` | Extended fields |
| `libs/contracts/src/auth/session-store.service.ts` | `listByUserId`; document index contract |
| `libs/contracts/src/auth/auth-token.service.ts` | Optional `clientMeta` on `createAuthSession` |
| `libs/contracts/src/tokens.ts` | `SessionManagementService` token |
| `libs/infrastructure/src/redis/redis.service.ts` | Set helpers (`sadd`/`smembers`/`srem` or equivalent) |
| `libs/infrastructure/src/redis/redis.service.spec.ts` | Cover new helpers |
| `libs/infrastructure/src/auth/redis-session-store.service.ts` | Extended create/get/delete + `listByUserId` + legacy dual-read |
| `libs/infrastructure/src/auth/session-auth-token.service.ts` | Persist metadata timestamps/IP/UA on create |
| `libs/infrastructure/src/auth/session-auth-token.service.spec.ts` | Assert new fields |
| `libs/infrastructure/src/auth/jwt-auth-token.service.ts` | Accept optional unused `clientMeta` |
| `libs/infrastructure/src/auth/auth.module.ts` | Prefer providing/exporting `TOKENS.SessionStore` on async session path **or** keep store construction in management factory; ensure `delete` path maintains index |
| `libs/application/src/use-cases/auth/login.usecase.ts` | Accept optional client meta; pass to `createAuthSession` |
| `libs/application/src/use-cases/auth/login.usecase.spec.ts` | Cover meta passthrough |
| `apps/api/src/controllers/auth.controller.ts` | Pass IP/UA from login request |
| `apps/api/src/composition/auth-application.module.ts` | Wire management service (real vs stub) + four use cases; export them |
| `apps/api/src/api.module.ts` | Register `SessionsController` |
| `apps/api/src/openapi/create-openapi-document.ts` | Tag description / `extraModels` for session DTOs; global description note |
| `apps/api/src/openapi/openapi-contract.spec.ts` | Expect `/v1/sessions` paths, cookie security, schemas, session-only wording |
| `README.md` | §16.1 — session-management endpoints + driver gating + Redis key/index layout + breaking note |
| `EXAMPLES.md` | Curl examples for list / revoke-one / others / all under session driver |

## Files to delete

- None.

## Domain changes

- No new domain entities or events.
- Reuse existing domain errors only:
  - `ValidationError('SESSION_DRIVER_REQUIRED', …)` for JWT strategy B
  - `NotFoundError('SESSION_NOT_FOUND', …)` for missing/non-owned revoke target
- Do **not** add domain types for Redis session records (they stay in Contracts).

## Application changes

- `LoginUseCase.execute` input gains optional `ip` / `userAgent`; forwarded to `createAuthSession`.
- Add four session-management use cases depending only on `ISessionManagementService` (and returning DTO-shaped plain objects).
- No Outbox / queue / transaction changes.

## Contract and DI changes

- Extend `SessionRecord`, `ISessionStore`, `IAuthTokenService.createAuthSession`.
- Add `ISessionManagementService` + `TOKENS.SessionManagementService`.
- Composition (`AuthApplicationCompositionModule`):

```text
if AUTH_DRIVER=session:
  RedisSessionManagementService(sessionStore)
else:
  UnsupportedSessionManagementService
→ TOKENS.SessionManagementService

providers: List/Revoke/RevokeOthers/RevokeAll use cases
exports: those use cases
```

- `SessionsController` injects the four use cases + `SessionCookieService` + `AppLogger` (and uses `AuthGuard` / `RateLimiterGuard`).

## Infrastructure changes

- `RedisService` set helpers (logical keys via existing `RedisKeyBuilder`).
- `RedisSessionStore`: index maintenance, dual-read, `listByUserId` with stale-member pruning.
- `RedisSessionManagementService` / `UnsupportedSessionManagementService`.
- `SessionAuthTokenService.createAuthSession` writes full record shape.
- Ensure logout/`revoke({ sessionId })` continues to call `sessionStore.delete` so index stays consistent when users log out via `/auth/logout`.

## Interface and entrypoint changes

### Controller routes (`SessionsController`)

| Method | Path (public) | Handler | Auth | Cookie clear |
| ------ | ------------- | ------- | ---- | ------------ |
| `GET` | `/v1/sessions` | `list` | `AuthGuard` + cookie required | No |
| `DELETE` | `/v1/sessions/others` | `revokeOthers` | same | No |
| `DELETE` | `/v1/sessions` | `revokeAll` | same | **Yes** |
| `DELETE` | `/v1/sessions/:id` | `revokeOne` | same | **Yes if** `clearedCurrent` |

OpenAPI:

- `@ApiTags('Sessions')` with tag/operation text: **“Only available when AUTH_DRIVER=session.”**
- `@ApiCookieAuth('sessionCookie')` only (no Bearer advertised)
- `@ApiOkResponse` / `@ApiUnauthorizedResponse` / `@ApiBadRequestResponse` / `@ApiNotFoundResponse` / `@ApiTooManyRequestsResponse` / `@ApiInternalServerErrorResponse` using `ErrorEnvelopeDto` and success DTOs
- Document `400` with `SESSION_DRIVER_REQUIRED` for JWT deployments
- Document `Set-Cookie` clear headers on revoke-current / revoke-all like logout

### DTOs

- `SessionIdParamDto` — `id: string` with `@IsUUID('4')` (session ids are `randomUUID()`)
- `SessionListItemDto` — FR-03 fields
- `SessionsListDataDto` / `SessionsListResponseDto` — `{ success, data: { sessions } }`
- `RevokeOthersDataDto` / response — `{ success, data: { revokedCount } }`
- Reuse logout-style `{ success: true }` for revoke-one / revoke-all (`LogoutResponseDto` or dedicated `SessionMutationResponseDto`)

### Login

- `AuthController.login(@Req() req, …)` → pass `ip: req.ip`, `userAgent: req.get('user-agent') ?? null` into use case.

### Entrypoints

- **API only.** Worker / Cron / Migrations: no changes.

## Database and migration changes

- **None** (Redis-only; A-03).
- No Drizzle / SQL migrations.

## Security and authorization changes

- Authenticated user scope only; `session.userId === request.user.id`.
- Cross-user / unknown id → `404 SESSION_NOT_FOUND` without confirming foreign existence beyond that.
- Do not log raw session ids, full cookies, or secrets at info level; may log `userId`, `revokedCount`, `clearedCurrent` (NFR-03).
- Rate-limit list/deletes with `sessions:*` prefixes.
- Session ids remain httpOnly cookie secrets; path param on revoke is authenticated.

## Observability changes

- Structured info logs on list/revoke: `userId`, counts, `clearedCurrent` — **not** raw session ids.
- No new metrics required for MVP.

## Implementation phases

### Phase 1 — Contracts + Redis store/index

- **Paths:** `libs/contracts/src/auth/session-record.ts`, `session-store.service.ts`, `auth-token.service.ts`, `tokens.ts`; `libs/infrastructure/src/redis/redis.service.ts` (+ spec); `libs/infrastructure/src/auth/redis-session-store.service.ts` (+ spec)
- **Symbols:** extended `SessionRecord`; `ISessionStore.listByUserId`; `TOKENS.SessionManagementService`; Redis set helpers; `RedisSessionStore.create|get|delete|listByUserId`
- **AC:** AC-09, AC-06 (store fields), NFR-02
- **Verify:** unit tests for create→index→list→delete prune; legacy JSON dual-read; `npm run test:unit -- redis-session-store` (or project-equivalent path filter)

### Phase 2 — Auth token create metadata + AuthModule wiring

- **Paths:** `session-auth-token.service.ts` (+ spec), `jwt-auth-token.service.ts`, `auth.module.ts` (SessionStore provide/export if chosen), `login.usecase.ts` (+ spec)
- **Symbols:** `createAuthSession(user, clientMeta?)`; session record timestamps/IP/UA
- **AC:** AC-06
- **Verify:** `session-auth-token.service.spec.ts`, `login.usecase.spec.ts`

### Phase 3 — Session management port + use cases

- **Paths:** `libs/contracts/src/auth/session-management.service.ts`; `redis-session-management.service.ts`; `unsupported-session-management.service.ts`; four use cases + specs
- **Symbols:** `ISessionManagementService`; `RedisSessionManagementService`; `UnsupportedSessionManagementService`; `ListSessionsUseCase`; `RevokeSessionUseCase`; `RevokeOtherSessionsUseCase`; `RevokeAllSessionsUseCase`
- **AC:** AC-01–AC-04, AC-08, AC-11 (logic level)
- **Verify:** use-case unit tests with in-memory/fake management or fake store; stub throws `SESSION_DRIVER_REQUIRED`

### Phase 4 — Composition + HTTP + OpenAPI

- **Paths:** `auth-application.module.ts`, `api.module.ts`, `sessions.controller.ts`, `apps/api/src/dto/sessions/*`, `auth.controller.ts` (login meta), `create-openapi-document.ts`, `openapi-contract.spec.ts`
- **Symbols:** `SessionsController` methods `list` / `revokeOthers` / `revokeAll` / `revokeOne`; DTO classes; composition factories selecting real vs stub by `config.auth().driver`
- **AC:** AC-01–AC-08, AC-11, AC-OpenAPI, FR-10–FR-14
- **Verify:** `npm run test:unit -- openapi-contract`; inspect generated paths `/v1/sessions`, `/v1/sessions/{id}`, `/v1/sessions/others`

### Phase 5 — Docs + full verification

- **Paths:** `README.md` §16.1, `EXAMPLES.md`
- **Symbols:** documentation only (endpoints, driver gating, Redis keys `sessions:` / `sessions:user:`, breaking/re-login note)
- **AC:** AC-10, AC-12
- **Verify:** `npm run build:api`, `npm run lint`, `npm run test:unit` (at least session + openapi suites); optional runtime Redis smoke if available (not required to pass if infra missing — separate infra unavailability from code failure)

## Dependency and compatibility impact

- **No new npm packages** (NFR-05).
- **JWT deployments:** routes registered; successful list/revoke impossible; `SESSION_DRIVER_REQUIRED` (AC-08).
- **Session deployments:** additive HTTP API; Redis JSON + index layout is a **breaking** change for existing session keys (document; dual-read mitigates crashes; index absence hides old sessions until re-login).
- **Logout** remains compatible but must keep index consistent via updated `delete`.
- Do not change JWT refresh-family storage.

## Targeted verification

| Command / inspection | Purpose |
| -------------------- | ------- |
| Unit: `RedisSessionStore` create/list/delete/prune | AC-09, index consistency |
| Unit: management + use cases (ownership, current, revoke others/all, stub) | AC-01–04, AC-08, AC-11 |
| Unit: `login.usecase` / `session-auth-token` metadata | AC-06 |
| `openapi-contract.spec.ts` | AC-07 / AC-OpenAPI |
| Static: route order `others` before `:id` | FR-08 path safety |
| Static: cookie clear on current/all | AC-03, AC-11 |

## Full verification

| Command | Expected |
| ------- | -------- |
| `npm run build:api` | Pass |
| `npm run lint` | Pass |
| `npm run test:unit` (or filtered suites covering new specs + OpenAPI) | Pass |
| Optional: `npm run test:module` if composition wiring specs are added | Pass if run |
| Optional runtime (Redis up, `AUTH_DRIVER=session`): two logins → list → delete other → delete current → `401`; under jwt → `SESSION_DRIVER_REQUIRED` | Manual/smoke when infra available |

Record each as command / result / conclusion in the implementation report (AC-12).

## Acceptance criteria mapping

| AC | Implementation phase | Verification |
| -- | -------------------- | ------------ |
| **AC-01** | Phase 3–4 (`ListSessionsUseCase`, `SessionsController.list`, `isCurrent`) | Unit list with two sessions + current id; optional Redis smoke `GET /v1/sessions` |
| **AC-02** | Phase 3–4 (`RevokeSessionUseCase` non-current) | Unit: revoke other leaves current; optional smoke |
| **AC-03** | Phase 4 (cookie clear when `clearedCurrent`) | Unit + inspect controller clear; optional smoke → follow-up `401` |
| **AC-04** | Phase 3 (`revokeOne` ownership → `SESSION_NOT_FOUND`) | Unit: foreign/missing id does not delete; expects `NotFoundError` |
| **AC-05** | Phase 4 (`AuthGuard` on controller) | Unit/module or OpenAPI `401` docs + guard presence inspection; runtime unauthenticated → `401` |
| **AC-06** | Phase 2 + 4 (login meta → store → list) | `login.usecase.spec` + store/list unit asserting `ip`/`userAgent` |
| **AC-07** / **AC-OpenAPI** | Phase 4 (`create-openapi-document.ts`, DTOs, `openapi-contract.spec.ts`) | `npm run test:unit -- openapi-contract` (or full unit); assert four paths + session-only text + cookie scheme + error schema |
| **AC-08** | Phase 3–4 (`UnsupportedSessionManagementService` + always-registered controller) | Unit stub throws `SESSION_DRIVER_REQUIRED`; automated test required |
| **AC-09** | Phase 1 (`listByUserId` via user SET, not `KEYS *`) | Store unit tests; code inspection of `RedisSessionStore` |
| **AC-10** | Phase 5 (`README.md`, `EXAMPLES.md`) | Doc inspection |
| **AC-11** | Phase 3–4 (`revokeOthers`, `revokeAll` + cookie clear on all) | Unit + controller cookie behavior inspection |
| **AC-12** | Phase 5 | `npm run build:api`, `npm run lint`, relevant unit/OpenAPI tests — record results |

## Rollout strategy

1. Deploy API with expanded Redis session JSON + user index helpers.
2. Session-driver users: expect re-login for sessions missing the index / old shape (document maintenance window). Dual-read prevents hard failures on leftover keys.
3. JWT-driver deployments: no behavior change except new routes returning `SESSION_DRIVER_REQUIRED` when authenticated.
4. No feature flag beyond `AUTH_DRIVER`.

## Rollback strategy

1. Revert API deploy to prior version.
2. New Redis fields/index keys are ignored by old code that only reads `userId`/`authVersion` — **but** old `delete` will **not** `SREM` index members (orphaned set members). Prefer flushing session keys or accepting stale set members until TTL/prune if rolling forward again.
3. Document short maintenance window for session-driver environments.

## Risks

| Risk | Mitigation |
| ---- | ---------- |
| Stale per-user SET members after Redis TTL expiry of session keys | Prune on `listByUserId`; optionally TTL the user set |
| Dual `RedisSessionStore` instances if AuthModule async does not export store | Both use same `RedisService`/key layout; prefer single provider export |
| `AuthGuard` Bearer-first under session driver | Hard-require cookie in `SessionsController` for current-session identity |
| Breaking existing Redis sessions | Document; dual-read; index omission until re-login |
| Route `others` captured as `:id` | Declare `others` route before `:id` |
| Logging session ids | Code review / NFR-03 in use cases and controller |
| Concurrent TASK scope creep (Google SSO) | Do not edit Google SSO files unless `createAuthSession` signature forces a trivial call-site update |

## Open questions requiring human decision

Frozen planner defaults above cover OQ-2, 3, 4, 5, 8, 9, 10 and driver error status. Remaining items only if a human overrides:

1. **Override OQ-2?** Forbid deleting current via `DELETE /sessions/:id` (force logout / revoke-all)? — default **allow + clear**.
2. **Override OQ-3?** Use `403` instead of `404` for non-owned ids? — default **404**.
3. **Override OQ-4?** Force-invalidate all Redis sessions on deploy instead of dual-read? — default **dual-read + index omission**.
4. **Override OQ-5?** Touch `lastActivityAt` inside `SessionAuthTokenService.verifyAccessToken`? — default **no** (equal to `createdAt` until a follow-up).
5. **Override driver error HTTP status?** Use `404`/`501` instead of `400 ValidationError` for `SESSION_DRIVER_REQUIRED`? — default **400**.
6. **Rate-limit numbers** — confirm `sessions:list` 30/60 and `sessions:delete` 10/60 or mirror exact `auth:me` (3/300)? — default as in planner table.

No blocker: implementation may proceed with the planner-frozen defaults unless a human changes plan status notes before approval.
