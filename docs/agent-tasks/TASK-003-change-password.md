---
task_id: TASK-003
task_type: feature
status: approved
owner: human-approval-required
---

# TASK-003 — Password change and email reset

## Original request

Друге що я хочу, це щоб ти зробив базові ендпоінти для зміни пароля

## Human decisions (2026-07-19)

1. **Forgot-password / email reset is in scope** for this task (not a separate task).
2. **Post-change session policy:** after a successful authenticated password change, **re-issue a fresh auth session/tokens** in the response (and set the session cookie in session mode), analogous to `POST /auth/login`. Still bump `authVersion` so prior credentials become stale, then issue new credentials for the current client.

## Problem or opportunity

The starter kit already supports account registration and password-based login (`POST /auth/register`, `POST /auth/login`) with bcrypt hashing via `IPasswordHasher`, but an authenticated user cannot change their password through the HTTP API, and there is no email-based recovery path when the password is forgotten. Downstream apps that adopt this foundation therefore lack basic, documented password-change and reset contracts.

Repository conventions already anticipate password-change security effects: `IUserRepository.incrementAuthVersion` is documented for password-change and other security-reset events, and `authVersion` is embedded in JWT/session credentials so stale credentials fail verification after a bump. Mail infrastructure exists (`MAIL_DRIVER` smtp/null) and can deliver reset messages when SMTP is configured.

## Goal

Add:

1. an **authenticated password-change** endpoint (`currentPassword` + `newPassword`) that bumps `authVersion` and **immediately re-issues** auth artifacts for the active `AUTH_DRIVER`;
2. a **public forgot-password / email reset** flow (request reset + confirm new password with a one-time token) that uses the existing mail port when available, with safe behavior when mail is disabled.

## Users and actors

- **Authenticated end user** changing their own password.
- **Unauthenticated end user** recovering access via email reset.
- **API client** using `AUTH_DRIVER=jwt` or `AUTH_DRIVER=session`.
- **Mail provider** (SMTP or null driver) delivering reset messages when configured.

## Current system context

Inspected behavior on the current branch:

- **HTTP Auth surface** (`apps/api/src/controllers/auth.controller.ts`): `POST /auth/register`, `POST /auth/login`, `POST /auth/logout`, `POST /auth/refresh`, `GET /auth/me`. No change-password or reset-password routes.
- **Application use cases** (`libs/application/src/use-cases/auth/`): register, login, logout, refresh, get-current-user only.
- **Password hashing**: `IPasswordHasher` (`hash` / `compare`) via `BcryptPasswordHasher`.
- **Password validation today**: register/login DTOs require `@IsString()` + `@MinLength(8)` only.
- **User domain**: holds `passwordHash` and `authVersion`; `incrementAuthVersion()` exists; no password-update helper yet.
- **Auth freshness**: bumping `authVersion` invalidates JWT/session credentials on next verification.
- **Mail**: optional `MAIL_DRIVER` (`smtp` | `null`); examples in `EXAMPLES.md` mention a future password-reset template pattern but no reset flow exists.
- **Reference (non-normative):** `E:\Projects\levych-api` exposes `POST /v1/auth/change-password` and a three-step restore-password flow under users (`restore-password` → `check` → `setup`). This starter must improve layering, enumeration safety, token hashing, OpenAPI, and auth re-issue consistency — levych is not the contract to copy.

**Conclusion:** this is a **new feature**, not a bugfix from `docs/agent-backlog/`.

## Functional requirements

### Authenticated change-password

- **FR-01:** Expose `POST /auth/change-password` under `@Controller('auth')`.
- **FR-02:** Request body MUST include `currentPassword` and `newPassword` (both string, required, `@MinLength(8)` matching register/login).
- **FR-03:** Use case MUST verify `currentPassword` with `IPasswordHasher.compare`, hash `newPassword`, persist the new hash, and bump `authVersion`.
- **FR-04:** On wrong `currentPassword`, fail without updating the password; HTTP **400** via `ValidationError` and shared error envelope. Prefer dedicated code `INVALID_CURRENT_PASSWORD` (stable machine-readable).
- **FR-05:** `newPassword` MUST differ from `currentPassword`; otherwise **400**.
- **FR-06:** On success, bump `authVersion`, then **create a fresh auth session** via `IAuthTokenService.createAuthSession` and return the same success shape as login (`{ success: true, data: { user, auth } }`). Session mode MUST set the session cookie via `SessionCookieService` (same as login). Prior credentials become stale due to `authVersion`.
- **FR-07:** Wire the use case in `AuthApplicationCompositionModule` like other Auth use cases.
- **FR-08:** Rate-limit under the Auth rate-limit family (`auth:…` key prefix).

### Forgot-password / email reset

- **FR-09:** Expose a public request endpoint: `POST /auth/forgot-password` with body `{ email }` (validated email).
- **FR-10:** Expose a public confirm endpoint: `POST /auth/reset-password` with body `{ token, newPassword }` (token non-empty string; `newPassword` `@MinLength(8)`).
- **FR-11:** Request flow MUST generate a high-entropy one-time reset token, store only a **hashed** form with expiry and user binding (Redis preferred for TTL, or a dedicated table — planner chooses; must not store plaintext tokens), and attempt to send an email containing the raw token or a link that embeds it.
- **FR-12:** Enumeration safety: `POST /auth/forgot-password` MUST return a generic success envelope (**200**) whether or not the email exists and whether or not mail was actually sent (when mail is null/disabled, still return success but do not leak that fact in the response body; log internally at appropriate level).
- **FR-13:** Confirm flow MUST validate token (hash match, not expired, not reused), set the new password hash, bump `authVersion`, invalidate the reset token, and **re-issue a fresh auth session/tokens** like login / change-password (same response shape and session cookie behavior).
- **FR-14:** Invalid/expired/reused token → **400** with stable code (e.g. `INVALID_RESET_TOKEN`); do not change the password.
- **FR-15:** When `MAIL_DRIVER=null` (or mail send fails), forgot-password still returns generic success; document that consumers must configure SMTP (or inspect logs in local null-driver tests) for real delivery. Do not invent a backdoor that returns the token in the HTTP response in production; for **test/development** only, an optional documented test hook is an open question (see open questions).
- **FR-16:** Apply stricter rate limits to forgot/reset endpoints than ordinary authenticated routes.

### OpenAPI and docs

- **FR-17:** Document all three endpoints in OpenAPI with typed DTOs, success/error responses, auth schemes (change-password: Bearer + session cookie; forgot/reset: public), and cookie behavior on success where applicable.
- **FR-18:** Update `openapi-contract.spec.ts` and `create-openapi-document.ts` `extraModels`.
- **FR-19:** Update `EXAMPLES.md` (and README Auth section if it lists routes) with curl examples for all three endpoints; document required mail env for reset delivery.

## Non-functional requirements

- **NFR-01:** Preserve layering: Domain / Application / Contracts / Infrastructure / `apps/api` composition.
- **NFR-02:** Support both `AUTH_DRIVER=jwt` and `AUTH_DRIVER=session` for change-password auth and for re-issued credentials on change + reset.
- **NFR-03:** Prefer Redis for reset-token TTL storage unless planning proves a SQL table is required for audit; either way must be safe and hashed-at-rest.
- **NFR-04:** Never log plaintext passwords or raw reset tokens.
- **NFR-05:** Do not change `package-lock.json` unless a dependency is intentionally required (not expected).
- **NFR-06:** Password policy remains `@MinLength(8)` unless a later task strengthens it.

## Public API and interface impact

### HTTP API contract

| Method | Path                    | Auth                     | Purpose                                      |
| ------ | ----------------------- | ------------------------ | -------------------------------------------- |
| `POST` | `/auth/change-password` | Bearer or session cookie | Authenticated change; re-issues auth         |
| `POST` | `/auth/forgot-password` | Public                   | Request email reset                          |
| `POST` | `/auth/reset-password`  | Public                   | Confirm token + new password; re-issues auth |

#### `POST /auth/change-password`

- **Body:** `{ currentPassword: string, newPassword: string }` both `@MinLength(8)`.
- **Success:** **200** (update semantics) with `{ success: true, data: { user, auth } }` matching login user/auth DTOs; session mode also `Set-Cookie` for session cookie.
- **Errors:** **400** validation / wrong current / same password; **401** missing auth; **404** user missing; **429** rate limit; **500** unexpected.
- **OpenAPI:** `@ApiBearerAuth` + `@ApiCookieAuth`; reuse `LoginResponseDto` / `AuthUserDto` / `AuthTokensDto` where shapes match.

#### `POST /auth/forgot-password`

- **Body:** `{ email: string }` (email format).
- **Success:** **200** `{ success: true }` (no data that reveals account existence).
- **Errors:** **400** invalid email format; **429**; **500**. Do **not** return **404** for unknown email.

#### `POST /auth/reset-password`

- **Body:** `{ token: string, newPassword: string }` (`newPassword` `@MinLength(8)`).
- **Success:** **200** with login-equivalent `{ success: true, data: { user, auth } }` + session cookie when applicable.
- **Errors:** **400** validation / invalid-expired-reused token; **429**; **500**.

- **OpenAPI schemas/decorators:** new DTOs under `apps/api/src/dto/auth/`; register in `extraModels`; extend drift test.
- **Acceptance criterion linking OpenAPI to runtime:** **AC-12**.

## Data model and migration impact

- User row updates: `password_hash`, `auth_version`, `updated_at` (existing columns).
- Reset-token store: new Redis keyspace (preferred) **or** a Drizzle table + migration if planner chooses durability/audit. Must store hash, user id, expiry; single-use.
- No change to Worker/Cron schemas beyond existing user/outbox if password-changed events are deferred (out of scope unless open question expands).

## Events, queues and background processing

- Mail send for forgot-password uses existing mail port synchronously in the API path (same spirit as other transactional mail examples), unless an existing Outbox pattern for mail is already the project norm for similar messages — planner must follow existing mail send patterns in this repo.
- Optional “password changed” notification email: **deferred** (out of scope) unless human expands later.
- No new BullMQ queues required for MVP.

## Security and authorization

- Change-password: authenticated; bind to `request.user.id`; verify current password; rate-limit.
- Forgot/reset: public but rate-limited; hashed tokens; short TTL (planner picks default, e.g. 15–60 minutes); single-use; enumeration-safe responses.
- After change or reset: bump `authVersion` then issue **new** credentials so the completing client stays signed in while other sessions/tokens fail.
- Never return password hashes or plaintext passwords.

## Entrypoints and deployment impact

- **API** only for HTTP; Infrastructure mail + token store; possible Migrations if SQL token table is chosen.
- **Worker / Cron:** unaffected unless mail is already outbox-driven (follow existing pattern).
- Env: reuse mail config; may add `PASSWORD_RESET_TOKEN_TTL_SECONDS` and optional `PASSWORD_RESET_URL_BASE` for link construction in emails (names frozen in plan).

## Observability and operations

- Structured logs with `userId` on successful change/reset; never passwords or raw tokens.
- Distinct error codes for wrong current password and invalid reset token.

## Compatibility requirements

- Additive HTTP API; existing Auth routes unchanged in shape.
- Clients holding old credentials after change/reset must expect **401** on next use; the client that completed change/reset receives fresh credentials in the response.

## Dependencies

- Existing: `IPasswordHasher`, `IUserRepository`, `IAuthTokenService`, `AuthGuard`, mail port/module, Redis (likely), OpenAPI tooling.
- Reference only: levych-api restore-password (improve; do not copy unsafe patterns).

## Assumptions

- **A-01:** Scope includes authenticated change **and** email forgot/reset (human decision 2026-07-19).
- **A-02:** Success for change and reset **re-issues** auth like login (human decision).
- **A-03:** Path names: `POST /auth/change-password`, `POST /auth/forgot-password`, `POST /auth/reset-password`. If TASK-002 (URI versioning) is implemented first, these routes inherit the `/v1` prefix automatically (`/v1/auth/...`); path segments in this spec are relative to the versioning convention in force.
- **A-04:** Success HTTP status **200** for change/reset (update/recovery semantics); forgot-password also **200**.
- **A-05:** Wrong current password → `INVALID_CURRENT_PASSWORD` (400).
- **A-06:** `newPassword` must differ from `currentPassword` on change-password.
- **A-07:** Password policy stays min length 8.
- **A-08:** Password-changed email notification is out of scope for this task.
- **A-09:** Two-step reset (request + confirm) is sufficient; a separate “check code” endpoint like levych is optional and not required if the confirm endpoint validates the token.

## Out of scope

- Admin changing another user’s password.
- Changing email, profile, or roles.
- OAuth / social / MFA.
- Stronger password complexity rules beyond min length.
- Password-changed notification email / Outbox event (unless later approved).
- OLD-backend HTTP parity as acceptance criteria.
- Worker/Cron feature work beyond existing mail patterns.

## Acceptance criteria

- **AC-01:** Authenticated `POST /auth/change-password` with valid passwords returns login-equivalent success; stored hash accepts new password and rejects old; response includes fresh `auth` artifacts; session mode sets cookie.
- **AC-02:** Unauthenticated change-password → **401**; no password change.
- **AC-03:** Wrong `currentPassword` → **400** `INVALID_CURRENT_PASSWORD`; hash unchanged.
- **AC-04:** `newPassword === currentPassword` → **400**; no persistence change.
- **AC-05:** After change, prior JWT/session credentials fail; the newly issued credentials work for `GET /auth/me`.
- **AC-06:** `POST /auth/forgot-password` for unknown email returns the same generic **200** success as for a known email.
- **AC-07:** With mail configured (or test double), a known user receives a reset message path that yields a usable token; `POST /auth/reset-password` with that token sets the new password, invalidates the token, bumps `authVersion`, and returns fresh auth artifacts.
- **AC-08:** Reused or expired reset token → **400**; password unchanged.
- **AC-09:** Success/error bodies never include `passwordHash`, plaintext passwords, or (in production responses) raw reset tokens.
- **AC-10:** OpenAPI documents all three routes with correct auth, bodies, statuses, errors, and cookies; drift test passes.
- **AC-11:** Runtime behavior matches OpenAPI for primary success/error paths (targeted tests and/or bootstrap evidence).
- **AC-12:** `AuthApplicationCompositionModule` registers new use cases; `npm run build:api`, `npm run lint`, and relevant `test:unit` pass; migrations build if a SQL store was added.
- **AC-13:** `EXAMPLES.md` includes curl examples for change, forgot, and reset.

## Verification strategy

1. Static review of controller, DTOs, use cases, token store, mail usage, composition, OpenAPI.
2. Unit tests: change success/fail; reset success/fail; enumeration-safe forgot; authVersion + re-issue.
3. OpenAPI drift test.
4. `npm run build:api`, `npm run lint`, `npm run test:unit` (auth-related).
5. Optional bootstrap with PostgreSQL/Redis/SMTP (or null mail + test hook if approved): full change and reset paths.
6. Record command/result/conclusion in implementation/verification reports.

## Rollout and rollback

- **Rollout:** deploy API (and migration if any); configure SMTP for real reset emails; feature is additive.
- **Rollback:** revert API deploy; outstanding reset tokens expire via TTL; password hashes already changed by users remain changed.

## Open questions requiring human decision

1. **Reset email link vs raw token:** Should the email contain a frontend URL (`PASSWORD_RESET_URL_BASE` + token query) only, a raw token for API clients, or both?
2. **Dev/test token visibility:** When `MAIL_DRIVER=null`, may development/test expose the reset token via a controlled mechanism (e.g. response header only when `NODE_ENV=test`), or must tests inject tokens through the store port only?
3. **Reset token storage:** Confirm Redis-only TTL store vs SQL table for audit.
4. **TTL default:** Confirm default reset token lifetime (recommendation: **30 minutes**).
5. **Google-only / null-password users:** If TASK-004 lands first with nullable passwords, should forgot-password refuse accounts without a password, or allow setting an initial password via reset?
