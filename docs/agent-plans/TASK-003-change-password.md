---
task_id: TASK-003
specification: docs/agent-tasks/TASK-003-change-password.md
status: approved
owner: human-approval-required
---

# TASK-003 — Implementation plan

## Approved specification

- Spec: `docs/agent-tasks/TASK-003-change-password.md`
- Spec status: `approved` (verified in file frontmatter before planning; index row may still say `proposed` — treat the specification file as source of truth)
- Human decisions already frozen:
  1. Forgot-password / email reset **is in scope**
  2. After authenticated password change: bump `authVersion`, then **re-issue** fresh auth session/tokens (and session cookie in session mode), same shape as login
- Path convention: TASK-002 URI versioning is **already implemented** on this branch (`setGlobalPrefix('v1')` in `apps/api/src/main.ts`). Controllers stay `@Controller('auth')`; public paths are `/v1/auth/...`. Docs and OpenAPI must use `/v1/auth/...`.

## Current implementation

Inspected branch state (auth + mail + redis):

| Area | Current behavior |
| ---- | ---------------- |
| HTTP Auth | `apps/api/src/controllers/auth.controller.ts` — `register`, `login`, `logout`, `refresh`, `me` only; no change/forgot/reset |
| Composition | `apps/api/src/composition/auth-application.module.ts` wires Register/Login/Logout/Refresh/GetCurrentUser + `SessionCookieService`; no mail/queue for auth yet |
| Login success | `LoginUseCase` → `IAuthTokenService.createAuthSession`; controller `SessionCookieService.attachIfNeeded`; response `{ success, data: { user, auth } }`; Nest default POST status **201** |
| Password hashing | `IPasswordHasher` / `BcryptPasswordHasher`; register/login DTOs `@MinLength(8)` |
| User domain | `User` has `passwordHash`, `authVersion`, `incrementAuthVersion()`; **no** `changePassword` / `withPasswordHash` helper |
| User repo | `IUserRepository.update` + `incrementAuthVersion`; columns already include `password_hash`, `auth_version` |
| Auth freshness | `authVersion` embedded in JWT/session; bump invalidates prior credentials on verify |
| Mail pattern | Welcome mail: `RegisterUseCase` → Outbox `UserRegisteredEvent` → Worker handler → `QUEUES.EMAIL` → `EmailProcessor` → `MailTemplateService` → `IEmailGateway`. `EXAMPLES.md` §9 documents **use-case → QUEUES.EMAIL (template + data)** for new templates. API currently registers **only** `QUEUES.OUTBOX` (`apps/api/src/api.module.ts`) |
| Templates | `EMAIL_TEMPLATE.WELCOME` only; registry + React Email under `libs/infrastructure/src/mail/` |
| Redis TTL keys | `RedisService.set(key, value, ttlSeconds)`, `del`, `compareAndDelete`; session store pattern `sessions:{id}` |
| Rate limit | `@RateLimit({ keyPrefix: 'auth:…' })`; auth defaults `RATE_LIMIT_AUTH_MAX=5` / `RATE_LIMIT_AUTH_TTL=60`; refresh/me override limits |
| Errors | `ValidationError` → HTTP **400** via `GlobalExceptionFilter`; login uses `INVALID_CREDENTIALS` |
| OpenAPI | DTOs under `apps/api/src/dto/auth/`; `create-openapi-document.ts` `extraModels`; `openapi-contract.spec.ts` expects `/v1/auth/*` |
| Docs | `EXAMPLES.md` / `README.md` already `/v1/auth/...`; EXAMPLES §9 sketches a future `password-reset` template but no runtime flow |

**Note:** Do not overwrite any historical unrelated `TASK-003-*` plan artifact if present. This plan file is deliberately `TASK-003-change-password.md`.

## Architecture decision

### Authenticated change-password

1. Add `ChangePasswordUseCase` (application): load user by `request.user.id`, `IPasswordHasher.compare(currentPassword)`, reject same password, hash `newPassword`, apply domain password update that also bumps `authVersion`, `IUserRepository.update`, then `IAuthTokenService.createAuthSession` with the **new** `authVersion`.
2. Controller: `AuthGuard` + `RateLimiterGuard`, mirror login cookie attach + `{ success, data: { user, auth } }`, force HTTP **200** (`@HttpCode(HttpStatus.OK)` + `@ApiOkResponse`).
3. Error codes: `INVALID_CURRENT_PASSWORD` (wrong current); `SAME_PASSWORD` (new === current). Missing user → `NotFoundError('USER_NOT_FOUND')` (**404**), consistent with `GetCurrentUserUseCase`.

### Forgot / reset token store (Redis)

Prefer **Redis-only TTL store** (NFR-03). No migration.

- Port: `IPasswordResetTokenStore` + `TOKENS.PasswordResetTokenStore`
- Persist **SHA-256 hex hash** of raw token only (never plaintext)
- Keys (logical, via `RedisService` / existing key prefix):
  - `password-reset:token:{tokenHash}` → `userId` (string), TTL = config
  - `password-reset:user:{userId}` → `tokenHash` (optional index to invalidate prior token on re-request)
- Single-use: `consume(tokenHash)` must atomically read+delete (Lua / `compareAndDelete` pattern or get+del with ownership check)
- Token material: `randomBytes(32)` → `base64url` string

### Reset email delivery (follow repo mail pattern)

**Do not** put raw reset tokens in the PostgreSQL Outbox (plaintext durable store).

**Do** follow `EXAMPLES.md` §9:

```text
ForgotPasswordUseCase → QUEUES.EMAIL (template + data including token/url)
  → EmailProcessor → MailTemplateService → IEmailGateway
```

Implications:

- Extend API BullMQ registration to include `QUEUES.EMAIL` (in addition to `OUTBOX`) and inject `TOKENS.QueueGateway` into Auth composition for `ForgotPasswordUseCase` only.
- Add typed job name `send-password-reset-email` on `QueueJobRegistry.email` (payload remains `EmailJobPayload` / templated job).
- Add `EMAIL_TEMPLATE.PASSWORD_RESET` + React template + registry case + `EmailTemplateDataMap` entry.
- Enumeration safety: always return `{ success: true }`; if user missing, skip store/enqueue; if enqueue fails, log warn and still return success (FR-12 / FR-15).
- Delivery requires Worker running + `MAIL_DRIVER=smtp` for real SMTP; `MAIL_DRIVER=null` still “sends” via Worker null adapter (logs skip without token). Document in EXAMPLES/README.

### Email content default (OQ-1)

- Env `PASSWORD_RESET_URL_BASE` (optional, default empty).
- When set: email includes **frontend link** `{PASSWORD_RESET_URL_BASE}?token={rawToken}` (or `token=` query; document exact query param `token`) **and** the raw token for API clients.
- When unset: email includes **raw token only** (no invented frontend URL).
- Template data: `{ email, token, resetUrl?: string, expiresInMinutes: number }`.

### Dev/test token visibility (OQ-2)

**Default: no HTTP backdoor.** Unit/integration tests obtain tokens by:

- mocking `IPasswordResetTokenStore` / capturing the raw token before hash in the use-case test double, or
- injecting a test double `IQueueGateway` that records the enqueued `data.token`.

Do **not** return the token in the HTTP body or a special header in any `NODE_ENV`. Null-mail logs must not include the raw token (extend null/processor logging discipline: log `to`/`subject`/`template` only).

### TTL default (OQ-4)

- `PASSWORD_RESET_TOKEN_TTL_SECONDS` default **1800** (30 minutes). Exposed via `AppConfigService.passwordReset()`.

### Google-only / null-password users (OQ-5)

TASK-004 is not implemented; `passwordHash` is currently required. **Planner default if TASK-004 lands first:**

- `forgot-password` / `reset-password`: **allow** setting an initial password via reset (no current-password required).
- `change-password`: if no usable password hash, fail with `INVALID_CURRENT_PASSWORD` (or later `PASSWORD_NOT_SET` if TASK-004 freezes that code) — do not invent a separate endpoint here.

Flag remaining human confirmation under Open questions (soft default above).

### Rate limits (FR-16)

Stricter than default auth family:

| Route | `keyPrefix` | `limit` | `ttlSeconds` |
| ----- | ----------- | ------- | ------------ |
| change-password | `auth:change-password` | default auth (`authMax`/`authTtl`) | default |
| forgot-password | `auth:forgot-password` | **3** | **3600** |
| reset-password | `auth:reset-password` | **5** | **900** |

## Scope

- Domain helper to update password hash + bump `authVersion`
- Three application use cases + unit tests
- Redis password-reset token port + adapter + DI token
- Config: `PASSWORD_RESET_TOKEN_TTL_SECONDS`, `PASSWORD_RESET_URL_BASE`
- Mail template `password-reset` + queue job registry entry
- API: register `QUEUES.EMAIL`, wire QueueGateway + token store into Auth composition
- Three HTTP endpoints + DTOs + OpenAPI + drift test
- EXAMPLES.md (+ README Auth route list if present) curl examples and mail/env notes

## Out of scope

- Admin password change; profile/email/roles; OAuth/MFA
- Stronger password complexity beyond `@MinLength(8)`
- Password-changed notification email / Outbox domain event for “password changed”
- Separate “check token” endpoint (levych three-step)
- SQL table for reset tokens / migrations
- Synchronous `IEmailGateway` inside API (unless human revises this plan)
- Worker/Cron feature work beyond consuming the new email job via existing `EmailProcessor`
- TASK-004 Google SSO implementation
- Unrelated refactors; `package-lock.json` changes (none expected)

## Files to create

| Path | Responsibility |
| ---- | -------------- |
| `libs/application/src/use-cases/auth/change-password.usecase.ts` | Authenticated change + re-issue session |
| `libs/application/src/use-cases/auth/change-password.usecase.spec.ts` | Unit tests AC-01–AC-05, AC-09 |
| `libs/application/src/use-cases/auth/forgot-password.usecase.ts` | Enumeration-safe request + token store + enqueue email |
| `libs/application/src/use-cases/auth/forgot-password.usecase.spec.ts` | AC-06, AC-09, enqueue/skip paths |
| `libs/application/src/use-cases/auth/reset-password.usecase.ts` | Consume token, set password, re-issue auth |
| `libs/application/src/use-cases/auth/reset-password.usecase.spec.ts` | AC-07, AC-08, AC-09 |
| `libs/contracts/src/auth/password-reset-token-store.ts` | `IPasswordResetTokenStore` port |
| `libs/infrastructure/src/auth/redis-password-reset-token-store.service.ts` | Redis hashed TTL store |
| `libs/infrastructure/src/auth/redis-password-reset-token-store.service.spec.ts` | Store unit tests (hash-only, consume once, TTL args) |
| `libs/infrastructure/src/mail/templates/password-reset.email.tsx` | React Email template |
| `apps/api/src/dto/auth/change-password.dto.ts` | `currentPassword`, `newPassword` |
| `apps/api/src/dto/auth/forgot-password.dto.ts` | `email` |
| `apps/api/src/dto/auth/reset-password.dto.ts` | `token`, `newPassword` |
| `apps/api/src/dto/auth/forgot-password-response.dto.ts` | `{ success: true }` envelope (or place in `auth-response.dto.ts`) |

## Files to modify

| Path | Change |
| ---- | ------ |
| `libs/domain/src/entities/user.entity.ts` | Add `changePassword(passwordHash: string): User` (new hash + `authVersion+1` + `updatedAt`) |
| `libs/contracts/src/tokens.ts` | `PasswordResetTokenStore: Symbol(...)` |
| `libs/contracts/src/mail/email-template-id.ts` | `PASSWORD_RESET: 'password-reset'` |
| `libs/contracts/src/mail/email-template-data.ts` | `password-reset` data map |
| `libs/contracts/src/queues/queue-gateway.ts` | Add `'send-password-reset-email': EmailJobPayload` |
| `libs/infrastructure/src/mail/mail-template.registry.tsx` | Case for password-reset template |
| `libs/infrastructure/src/mail/templates/index.ts` | Re-export new template if pattern requires |
| `libs/infrastructure/src/config/env.schema.ts` | `PASSWORD_RESET_TOKEN_TTL_SECONDS`, `PASSWORD_RESET_URL_BASE` |
| `libs/infrastructure/src/config/infrastructure-config.module.ts` | Map new config slice `passwordReset` |
| `libs/infrastructure/src/config/app-config.service.ts` | `passwordReset()` accessor |
| `.env.example` | Document new env vars + mail note for reset |
| `apps/api/src/api.module.ts` | Register `QUEUES.EMAIL` alongside `OUTBOX`; pass queue module into Auth composition |
| `apps/api/src/composition/auth-application.module.ts` | Providers/exports for three use cases + Redis token store; inject QueueGateway + config into forgot |
| `apps/api/src/controllers/auth.controller.ts` | Three endpoints, OpenAPI decorators, rate limits, cookie attach on change/reset |
| `apps/api/src/dto/auth/auth-response.dto.ts` | Optional aliases/`ForgotPasswordResponseDto`; reuse `LoginResponseDto` for change/reset success |
| `apps/api/src/openapi/create-openapi-document.ts` | `extraModels` for new DTOs |
| `apps/api/src/openapi/openapi-contract.spec.ts` | Expect `/v1/auth/change-password`, `forgot-password`, `reset-password`; schema + security assertions |
| `EXAMPLES.md` | Curl for three endpoints; mail/worker/env notes; align §9 template list with real template |
| `README.md` | Auth route list / password-reset mail env if routes are enumerated |

## Files to delete

- None

## Domain changes

- `User.changePassword(passwordHash: string): User` — immutable restore with new hash, `authVersion + 1`, fresh `updatedAt`. Prefer this single write over `update` + separate `incrementAuthVersion` so hash and version stay consistent.
- No new domain events for this task (password-changed notification out of scope).

## Application changes

### `ChangePasswordUseCase`

- Input: `{ userId, currentPassword, newPassword }`
- Steps: findById → compare → same-password check → hash → `user.changePassword` → `update` → `createAuthSession` → return `{ user, auth }` (login shape)
- Errors: `NotFoundError`, `ValidationError('INVALID_CURRENT_PASSWORD')`, `ValidationError('SAME_PASSWORD')`

### `ForgotPasswordUseCase`

- Input: `{ email }` (normalize via `Email.create`)
- Always succeed from caller’s perspective
- If user found: generate raw token; `save` hashed binding; build `resetUrl` when `PASSWORD_RESET_URL_BASE` set; `queueGateway.add('email', 'send-password-reset-email', templated payload with idempotencyKey `password-reset:{userId}:{tokenHash}`)`; catch enqueue errors → log, do not throw
- Never log raw token or passwords

### `ResetPasswordUseCase`

- Input: `{ token, newPassword }`
- `consume(sha256(token))` → missing/expired → `ValidationError('INVALID_RESET_TOKEN')`
- find user → hash → `changePassword` → `update` → `createAuthSession` → login-shaped return
- Reused token fails because consume already deleted key (AC-08)

## Contract and DI changes

- New port `IPasswordResetTokenStore` (`save`, `consume`, optional `invalidateForUser` used internally by `save`)
- `TOKENS.PasswordResetTokenStore`
- `QueueJobRegistry.email['send-password-reset-email']`
- `EMAIL_TEMPLATE.PASSWORD_RESET` + typed template data
- `AuthApplicationCompositionModule.register` accepts queue module import (or receives `TOKENS.QueueGateway` via imports) and registers:
  - `RedisPasswordResetTokenStore` → token
  - three use-case factories (Change: users+hasher+authTokens; Forgot: users+store+queue+config; Reset: store+users+hasher+authTokens)
- Export new use cases for `AuthController`

## Infrastructure changes

- `RedisPasswordResetTokenStore` using `RedisService` (same pattern as `RedisSessionStore`)
- Password-reset React Email template (use existing `Layout`/`Block`/`Paragraph`/`OtpCode` as appropriate for displaying token)
- Config wiring only — no AuthModule driver changes
- No SQL/migrations
- Worker: **no new processor**; existing `EmailProcessor` already renders any registered template

## Interface and entrypoint changes

### API controller (`AuthController`)

| Method | Path (relative) | Public path | Auth | Notes |
| ------ | --------------- | ----------- | ---- | ----- |
| POST | `change-password` | `/v1/auth/change-password` | Bearer + cookie (`AuthGuard`) | `@HttpCode(200)`; `attachIfNeeded`; reuse `LoginResponseDto` |
| POST | `forgot-password` | `/v1/auth/forgot-password` | Public | `@HttpCode(200)`; body `{ success: true }` only |
| POST | `reset-password` | `/v1/auth/reset-password` | Public | `@HttpCode(200)`; login-shaped; `attachIfNeeded` |

OpenAPI per endpoint:

- change-password: `@ApiBearerAuth('bearerAuth')` + `@ApiCookieAuth('sessionCookie')`; `@ApiOkResponse` (+ Set-Cookie header like login); 400/401/404/429/500 → `ErrorEnvelopeDto`
- forgot-password: public; `@ApiOkResponse` forgot envelope; 400/429/500
- reset-password: public; `@ApiOkResponse` `LoginResponseDto` + Set-Cookie; 400/429/500

### DTOs

- `ChangePasswordDto`, `ForgotPasswordDto`, `ResetPasswordDto` under `apps/api/src/dto/auth/`
- Validation mirrors register/login (`@MinLength(8)`, `@IsEmail()`, `@IsString()`, token non-empty `@IsNotEmpty()` / `@MinLength(1)`)

### `create-openapi-document.ts`

- Add new request/response DTOs to `extraModels` (at least `ChangePasswordDto`, `ForgotPasswordDto`, `ResetPasswordDto`, `ForgotPasswordResponseDto` if distinct)

### `openapi-contract.spec.ts`

- Add the three `/v1/auth/...` routes to `expectedRoutes`
- Assert schemas present; assert change-password security includes bearer + sessionCookie; assert requestBody `$ref`s

### Worker / Cron / Migrations

- Worker unchanged except it will process new job name/template automatically once registry+template exist
- Cron/Migrations: no changes

## Database and migration changes

- None. User columns already support password + authVersion updates.
- Reset tokens live in Redis only.

## Security and authorization changes

- Change-password bound to authenticated `user.id`; verify current password; rate-limit
- Forgot/reset public but stricter rate limits; hashed tokens; 30m TTL; single-use; enumeration-safe forgot
- After change/reset: bump `authVersion` then issue new credentials (completing client stays signed in; others fail)
- Never return `passwordHash`, plaintext passwords, or raw tokens in HTTP responses
- Never log raw tokens or passwords
- Job payload will contain raw token briefly in Redis (BullMQ) — acceptable short-lived; prefer not to persist in Outbox SQL

## Observability changes

- Structured info logs on successful change/reset with `userId` only
- Warn logs when forgot enqueue fails or mail path skipped for known user (without token)
- Distinct machine-readable codes: `INVALID_CURRENT_PASSWORD`, `SAME_PASSWORD`, `INVALID_RESET_TOKEN`

## Implementation phases

### Phase 1 — Domain + contracts + Redis token store

- **Paths:** `libs/domain/src/entities/user.entity.ts`; `libs/contracts/src/auth/password-reset-token-store.ts`; `libs/contracts/src/tokens.ts`; `libs/infrastructure/src/auth/redis-password-reset-token-store.service.ts(+spec)`; env/config files listed above; `.env.example`
- **Symbols:** `User.changePassword`; `IPasswordResetTokenStore`; `TOKENS.PasswordResetTokenStore`; `RedisPasswordResetTokenStore`; `AppConfigService.passwordReset`
- **AC:** AC-08 (consume once foundation), AC-09 (no plaintext at rest), AC-12 (config/DI foundation)
- **Verify:** unit test store save/consume/miss; `npm run test:unit -- redis-password-reset` (or equivalent path filter)

### Phase 2 — Application use cases

- **Paths:** three use-case files + specs under `libs/application/src/use-cases/auth/`
- **Symbols:** `ChangePasswordUseCase`, `ForgotPasswordUseCase`, `ResetPasswordUseCase`
- **AC:** AC-01–AC-09 (behavior via unit tests with fakes)
- **Verify:** `npm run test:unit` filtered to these specs

### Phase 3 — Mail template + queue registry + API composition

- **Paths:** email template id/data/registry/tsx; `queue-gateway.ts`; `apps/api/src/api.module.ts`; `auth-application.module.ts`
- **Symbols:** `EMAIL_TEMPLATE.PASSWORD_RESET`; `send-password-reset-email`; composition providers
- **AC:** AC-07 (mail path), AC-12 (composition registration)
- **Verify:** template registry resolves; queue registry parity spec still passes; module compiles

### Phase 4 — HTTP + OpenAPI

- **Paths:** DTOs; `auth.controller.ts`; `create-openapi-document.ts`; `openapi-contract.spec.ts`
- **Symbols:** controller handlers; OpenAPI decorators; drift expectations
- **AC:** AC-01–AC-05, AC-06–AC-11 (contract), AC-10
- **Verify:** `npm run test:unit -- openapi-contract` (or `test:module` if that is how this spec is classified — use the script that currently runs `openapi-contract.spec.ts`)

### Phase 5 — Docs + full verification

- **Paths:** `EXAMPLES.md`, `README.md` (Auth routes / mail env)
- **Symbols:** n/a (documentation)
- **AC:** AC-13, AC-11/AC-12 evidence
- **Verify:** `npm run build:api`, `npm run lint`, `npm run test:unit`; optional bootstrap smoke if Postgres/Redis/Worker available (record infra gaps separately)

## Dependency and compatibility impact

- Additive HTTP API; existing auth route shapes unchanged
- Clients with old credentials after change/reset must expect **401**; completing client receives fresh `auth`
- New env vars optional with safe defaults (`TTL=1800`, empty URL base)
- API now producers to `email` queue → **Worker must run** for reset email delivery (document; same operational expectation as welcome mail after outbox processing)
- No `package-lock.json` / dependency changes expected
- Paths documented as `/v1/auth/...` (TASK-002 already on branch)

## Targeted verification

| Check | Command / inspection | Expectation |
| ----- | -------------------- | ----------- |
| Unit: change-password | `npm run test:unit -- change-password` | success, wrong current, same password, authVersion bump + re-issue |
| Unit: forgot/reset | `npm run test:unit -- forgot-password` / `reset-password` | enumeration-safe; invalid token; consume once |
| Unit: token store | store spec | hash-only keys; consume deletes |
| OpenAPI drift | run existing openapi-contract Jest file via project scripts | three new routes + schemas + security |
| Queue parity | `queue-registry.parity.spec.ts` | registry still matches `QUEUES` |

## Full verification

| Command | Purpose |
| ------- | ------- |
| `npm run build:api` | Compile API + libs used by API |
| `npm run lint` | Lint gate |
| `npm run test:unit` | Full unit gate including new specs |
| Optional | Bootstrap API + Worker with Redis; SMTP or null mail; exercise three curls | Separate infra unavailability from code failure |

No migrations build required (Redis-only store).

## Acceptance criteria mapping

| AC | Implementation phase | Verification |
| -- | -------------------- | ------------ |
| AC-01 | Phase 2 + 4 | Unit success path; controller returns login shape + cookie attach; optional bootstrap |
| AC-02 | Phase 4 | OpenAPI 401 + AuthGuard on route; unit/controller inspection; optional HTTP without auth |
| AC-03 | Phase 2 | Unit: wrong current → `INVALID_CURRENT_PASSWORD`; repo update not called |
| AC-04 | Phase 2 | Unit: same password → `SAME_PASSWORD`; no persistence |
| AC-05 | Phase 2 | Unit: createAuthSession called with bumped `authVersion`; prior token verify fails in auth service tests or mocked expectation |
| AC-06 | Phase 2 | Unit: unknown email and known email both return success; enqueue only when user exists |
| AC-07 | Phase 2–3 | Unit with queue fake capturing token; reset use case succeeds; optional Worker+SMTP/null evidence |
| AC-08 | Phase 1–2 | Consume twice → second `INVALID_RESET_TOKEN`; password unchanged on second |
| AC-09 | Phase 2 + 4 | Assert response objects omit secrets; null-mail/logs omit raw token |
| AC-10 | Phase 4 | `openapi-contract.spec.ts` passes with three routes |
| AC-11 | Phase 4–5 | Drift test + targeted unit; optional runtime smoke |
| AC-12 | Phase 3–5 | Composition registers use cases; `build:api`, `lint`, `test:unit` pass |
| AC-13 | Phase 5 | `EXAMPLES.md` contains curl for change, forgot, reset |

## Rollout strategy

1. Deploy API (and ensure Worker continues to run for email queue).
2. Configure `MAIL_DRIVER=smtp` (+ SMTP_*) for real reset delivery; optionally set `PASSWORD_RESET_URL_BASE` for frontend links.
3. Feature is additive — no migration, no dual-write.

## Rollback strategy

1. Revert API deploy (routes disappear).
2. Outstanding Redis reset tokens expire via TTL.
3. Password hashes already changed by users remain changed (no automatic rollback of credentials).
4. No DB migration to reverse.

## Risks

| Risk | Mitigation |
| ---- | ---------- |
| Reset emails never arrive if Worker down | Document Worker requirement; forgot still returns generic success; ops run Worker like welcome mail |
| Raw token in BullMQ job payload | Short-lived; hashed in durable Redis token key; never in Outbox SQL or HTTP |
| Race: two reset confirms | Atomic `consume` |
| Enumeration timing differences | Keep forgot path bounded; avoid obvious early-return timing gaps where cheap (same response shape always) |
| Login uses 201 vs change/reset 200 | Explicit `@HttpCode(200)` to match approved spec |
| TASK-004 nullable password | Soft default documented; implement defensive checks only if nullable hash already exists when implementing |

## Open questions requiring human decision

Planner defaults below are safe to implement unless a human overrides before approval:

1. **Reset email link vs raw token — DEFAULT: both when `PASSWORD_RESET_URL_BASE` is set; token-only otherwise.** Confirm query param name `token` and whether URL base should include path (e.g. `https://app.example/reset`) vs origin only.
2. **Dev/test token visibility — DEFAULT: no HTTP exposure; tests capture via queue/store fakes only.** Confirm rejection of any `NODE_ENV=test` response-header backdoor.
3. **Reset token storage — DEFAULT: Redis-only TTL (no SQL audit table).** Confirm no audit-table requirement for MVP.
4. **TTL — DEFAULT: 1800 seconds (`PASSWORD_RESET_TOKEN_TTL_SECONDS`).** Confirm or supply alternate.
5. **Google-only / null-password (if TASK-004 first) — DEFAULT: allow reset to set initial password; change-password without usable hash fails as invalid current.** Confirm or require refuse-on-forgot for passwordless accounts.
6. **Mail transport — DEFAULT: enqueue `QUEUES.EMAIL` from API (not Outbox, not sync API SMTP).** Confirm Worker dependency is acceptable for starter-kit ops; override only if human wants sync `IEmailGateway` in API instead.
