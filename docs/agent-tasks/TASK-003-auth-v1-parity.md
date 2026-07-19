---
task_id: TASK-003
task_type: feature
status: approved
owner: human-approval-required
---

# TASK-003 — Auth JWT cookie transport and /v1/auth parity

## Original request

Перенести auth зі старого бекенду на модель starter (D2), з optional cookie delivery і `/v1/auth/*` compatibility (D1), з security fixes (D6).

## Problem or opportunity

Starter має JWT/session і `/auth/*`; OLD — cookie-centric `/v1/auth/*`, Google OAuth, admin login. Потрібен один auth engine + compatibility.

## Goal

Повна behavioral parity auth під `/v1/auth` на базі starter JWT (+ optional httpOnly cookies), плюс Google OAuth; без витоку password hash.

## Users and actors

- End users, admins, Google OAuth users, frontend SPA/popup

## Current system context

- Starter: Register/Login/Logout/Refresh/GetCurrentUser; `AUTH_DRIVER=jwt|session`; Bearer or session cookie in AuthGuard.
- OLD: `OLD_BACKEND/src/v1/auth/*`; cookies `auth-cookie` / `refresh-cookie`; plaintext refresh in `tokens` table.

## Functional requirements

- **FR-01:** Use `AUTH_DRIVER=jwt` as migration auth engine (Redis refresh families, authVersion).
- **FR-02:** Optional cookie transport: set/clear access and refresh httpOnly cookies on login/refresh/logout; configurable names.
- **FR-03:** AuthGuard accepts Bearer access token OR access-token cookie when jwt driver is active.
- **FR-04:** Compatibility routes: `POST /v1/auth/login`, `POST /v1/auth/login/admin`, `POST /v1/auth/reg`, `GET /v1/auth/refresh`, `POST /v1/auth/log-out`, `POST /v1/auth/change-password`, `GET /v1/auth/google`, `GET /v1/auth/google/redirect`.
- **FR-05:** Admin login preserves OLD latest-login tracking where modeled; never return password hashes (D6).
- **FR-06:** Google OAuth popup `postMessage` payload remains compatible; document origin policy.
- **FR-07:** Existing starter `/auth/*` remains available unless later deprecated by human decision.

## Non-functional requirements

- **NFR-01:** Do not persist refresh JWTs in PostgreSQL plaintext.
- **NFR-02:** Rate limit auth endpoints consistently with starter auth limits.
- **NFR-03:** OpenAPI documents Bearer and cookie auth for `/v1/auth`.

## Public API and interface impact

### HTTP API contract (if applicable)

- Methods and paths: FR-04 under `/v1/auth`.
- Success bodies per TASK-002; must omit `password` / `passwordHash`.
- Cookies: access + refresh httpOnly when enabled; cleared on logout.
- Errors: proper HTTP errors (D6); no Error-as-200.
- OpenAPI + drift test for all `/v1/auth` operations.

## Data model and migration impact

- May extend users for Google/phone identifiers (coordinate with TASK-004).
- Do not reintroduce `tokens` table.

## Events, queues and background processing

- Reuse registration Outbox welcome email if reg uses RegisterUseCase.

## Security and authorization

- D6: strip secrets; secure cookie flags in production; OAuth state validation; role checks for admin login.

## Entrypoints and deployment impact

- API (+ env for Google OAuth and cookie names).

## Observability and operations

- Log auth failures without secrets; audit where available.

## Compatibility requirements

- Preserve OLD path prefixes under `/v1` for endpoints owned by this task (D1).
- Response bodies for successful legacy routes must match the parity matrix from TASK-002 unless D6 explicitly changes them.
- Auth uses starter JWT; cookie transport per TASK-003 when applicable (D2).

## Dependencies

- TASK-002 approved.
- Soft dependency on TASK-004 for extended user fields.

## Assumptions

- Frontend can use `/v1/auth` with cookies and/or body tokens.
- Session driver not required for cutover.

## Out of scope

- Password restore (TASK-004); profile CRUD; WebSocket auth details (TASK-015).

## Acceptance criteria

- **AC-01:** All FR-04 routes implemented and in OpenAPI.
- **AC-02:** Auth responses never include password hashes.
- **AC-03:** Cookie transport works with credentialed CORS.
- **AC-04:** Google OAuth completes and sets auth artifacts.
- **AC-05:** build/lint/unit/module + OpenAPI drift pass.
- **AC-06:** Parity-matrix auth rows updated.

## Verification strategy

- Unit tests for use cases and pure domain rules.
- Module/OpenAPI drift tests for every HTTP route owned by this task.
- `npm run build:api` (and `build:worker` / `build:cron` / `build:migrations` when those entrypoints change).
- `npm run lint` and relevant `npm run test:unit` / `test:module`.
- Smoke against parity-matrix rows for this task.

## Rollout and rollback

- Prefer completing the slice before exposing `/v1` routes in production.
- Rollback: revert deploy; no TypeORM hybrid.
- Schema changes: forward-only Drizzle migrations; ETL is TASK-020.

## Open questions requiring human decision

- Final cookie names; whether refresh is also returned in JSON for mobile clients.
- Whether `/auth/*` stays publicly documented beside `/v1/auth/*`.
