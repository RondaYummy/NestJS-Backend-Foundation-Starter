# TASK-003 — Independent verification

## Verdict

approved

## Approved specification

- Path: `docs/agent-tasks/TASK-003-change-password.md`
- Frontmatter `status: approved` — confirmed
- Scope: authenticated `POST /auth/change-password` plus public `POST /auth/forgot-password` / `POST /auth/reset-password`, auth re-issue after change/reset, Redis hashed token store, email via `QUEUES.EMAIL`, OpenAPI + docs
- Human decisions honored: forgot/reset in scope; post-change re-issue of auth (and session cookie in session mode)

**Note:** `docs/agent-tasks/INDEX.md` still lists TASK-003 as `proposed` while the specification file is `approved`. Spec frontmatter is the approval source of truth (same pattern as TASK-002 verification). INDEX lag is recorded under Findings (not an AC failure).

## Approved plan

- Path: `docs/agent-plans/TASK-003-change-password.md`
- Frontmatter `status: approved` — confirmed
- Planner defaults applied in code: Redis-only hashed TTL store; TTL default 1800 s; no HTTP token backdoor; enqueue `send-password-reset-email` on `QUEUES.EMAIL`; rate limits forgot 3/3600 and reset 5/900; optional `PASSWORD_RESET_URL_BASE`; paths under `/v1/auth/...` (TASK-002 already on branch)

## Scope checked

- Task under verification: **TASK-003 only**
- Diff matches the approved plan file list (domain helper, three use cases + specs, Redis token port/adapter, config/env, mail template + registry, queue job name, API composition + `QUEUES.EMAIL`, three HTTP endpoints + DTOs + OpenAPI drift, EXAMPLES/README/`.env.example`)
- No SQL migrations; no Worker/Cron feature changes beyond consuming the new email template via existing `EmailProcessor`
- No `package-lock.json` changes
- No TASK-004 / TASK-005 / TASK-006 production code mixed in

**Related agent-docs only (not production scope expansion):**

- Untracked `docs/agent-plans/TASK-003-change-password.md`, `docs/agent-reports/TASK-003-implementation.md`
- Modified `docs/agent-plans/INDEX.md` adds TASK-003 row (index status still `proposed` while plan file is `approved`)

**Pre-existing / untouched:**

- Historical `docs/agent-plans/TASK-003-auth-v1-parity.md` (different artifact; not part of this implementation)

## Actual changed files

**New**

| Path | Role |
| ---- | ---- |
| `libs/contracts/src/auth/password-reset-token-store.ts` | `IPasswordResetTokenStore` port |
| `libs/infrastructure/src/auth/redis-password-reset-token-store.service.ts` | Redis hashed TTL adapter |
| `libs/infrastructure/src/auth/redis-password-reset-token-store.service.spec.ts` | Store unit tests |
| `libs/application/src/use-cases/auth/change-password.usecase.ts` (+ `.spec.ts`) | Authenticated change + re-issue |
| `libs/application/src/use-cases/auth/forgot-password.usecase.ts` (+ `.spec.ts`) | Enumeration-safe request + enqueue |
| `libs/application/src/use-cases/auth/reset-password.usecase.ts` (+ `.spec.ts`) | Consume token + re-issue |
| `libs/infrastructure/src/mail/templates/password-reset.email.tsx` | React Email template |
| `apps/api/src/dto/auth/change-password.dto.ts` | Request DTO |
| `apps/api/src/dto/auth/forgot-password.dto.ts` | Request DTO |
| `apps/api/src/dto/auth/reset-password.dto.ts` | Request DTO |

**Modified (production / docs)**

| Path | Role |
| ---- | ---- |
| `libs/domain/src/entities/user.entity.ts` | `changePassword()` |
| `libs/contracts/src/tokens.ts` | `PasswordResetTokenStore` |
| `libs/contracts/src/mail/email-template-id.ts` | `PASSWORD_RESET` |
| `libs/contracts/src/mail/email-template-data.ts` | template data map |
| `libs/contracts/src/queues/queue-gateway.ts` | `send-password-reset-email` |
| `libs/infrastructure/src/mail/mail-template.registry.tsx` | registry case |
| `libs/infrastructure/src/mail/templates/index.ts` | re-export |
| `libs/infrastructure/src/config/env.schema.ts` | TTL + URL base |
| `libs/infrastructure/src/config/infrastructure-config.module.ts` | `passwordReset` slice |
| `libs/infrastructure/src/config/app-config.service.ts` | accessor |
| `.env.example` | document env vars |
| `apps/api/src/api.module.ts` | register `QUEUES.EMAIL`; pass `queuesModule` |
| `apps/api/src/composition/auth-application.module.ts` (+ `.spec.ts`) | DI for store + three use cases |
| `apps/api/src/controllers/auth.controller.ts` | three endpoints |
| `apps/api/src/dto/auth/auth-response.dto.ts` | `ForgotPasswordResponseDto` |
| `apps/api/src/openapi/create-openapi-document.ts` | `extraModels` |
| `apps/api/src/openapi/openapi-contract.spec.ts` | drift assertions |
| `EXAMPLES.md`, `README.md` | curl / route / env docs |

## Requirements matrix

| Requirement | Evidence | Result |
| ----------- | -------- | ------ |
| FR-01 | `AuthController` `@Post('change-password')` under `@Controller('auth')`; live path `/v1/auth/change-password` | passed |
| FR-02 | `ChangePasswordDto` `@IsString` + `@MinLength(8)` for both fields | passed |
| FR-03 | `ChangePasswordUseCase`: compare → hash → `user.changePassword` → `update` (authVersion bump in domain) | passed |
| FR-04 | Wrong current → `ValidationError('INVALID_CURRENT_PASSWORD')`; live HTTP 400 with that code | passed |
| FR-05 | Same password → `SAME_PASSWORD`; live HTTP 400 | passed |
| FR-06 | Re-issue via `createAuthSession`; controller `attachIfNeeded`; `@HttpCode(200)`; live session cookie re-issue | passed |
| FR-07 | Composition registers `ChangePasswordUseCase` (+ forgot/reset); module spec resolves providers | passed |
| FR-08 | `@RateLimit({ keyPrefix: 'auth:change-password' })` | passed |
| FR-09 | `POST forgot-password` + `ForgotPasswordDto` `@IsEmail` | passed |
| FR-10 | `POST reset-password` + `ResetPasswordDto` token `@IsNotEmpty`, `newPassword` `@MinLength(8)` | passed |
| FR-11 | `randomBytes(32)` base64url; Redis stores SHA-256 hash only; email job carries raw token | passed |
| FR-12 | Known/unknown both `{ success: true }`; live unknown + known both 200 | passed |
| FR-13 | Reset consume → changePassword → createAuthSession; cookie attach; login-shaped body | passed |
| FR-14 | Invalid token → `INVALID_RESET_TOKEN` 400; live confirmed | passed |
| FR-15 | Enqueue failure caught → warn log, still success; no HTTP token backdoor | passed |
| FR-16 | Forgot limit 3/3600; reset limit 5/900 | passed |
| FR-17 | OpenAPI decorators + live `/v1/docs-json` routes/security/schemas | passed |
| FR-18 | `extraModels` + `openapi-contract.spec.ts` extended; drift tests pass | passed |
| FR-19 | `EXAMPLES.md` §5.2 curls; README auth surface + env | passed |
| NFR-01 | Domain/Application/Contracts/Infrastructure/`apps/api` layering preserved; use cases port-typed | passed |
| NFR-02 | Session mode live e2e; JWT path uses same `createAuthSession` / AuthGuard machinery | passed |
| NFR-03 | Redis-only hashed TTL store; no migration | passed |
| NFR-04 | Logs use `userId` only; unit asserts no raw token in logs; responses omit hashes/passwords | passed |
| NFR-05 | No `package-lock.json` change | passed |
| NFR-06 | `@MinLength(8)` retained | passed |

## Acceptance criteria matrix

| AC | Evidence | Result |
| -- | -------- | ------ |
| AC-01 | Unit success path; live session: change 200 + new `sid` Set-Cookie + login-shaped body | passed |
| AC-02 | `AuthGuard` on route; live unauthenticated → 401 `UNAUTHORIZED` | passed |
| AC-03 | Unit + live → 400 `INVALID_CURRENT_PASSWORD`; no update on failure | passed |
| AC-04 | Unit + live → 400 `SAME_PASSWORD` | passed |
| AC-05 | Unit bumps authVersion into `createAuthSession`; live old session cookie → 401 `/me`, new cookie → 200 | passed |
| AC-06 | Unit known/unknown; live unknown + known both 200 `{ success: true }` | passed |
| AC-07 | Unit queue fake captures token; reset use case consumes + re-issues; live forgot known returns success (full SMTP inbox path not required given test-double path) | passed |
| AC-08 | Unit consume miss; Redis `compareAndDelete`; live invalid token → 400 `INVALID_RESET_TOKEN` | passed |
| AC-09 | Unit serialization + log assertions; live responses lack secrets | passed |
| AC-10 | `openapi-contract.spec.ts` 3/3; live docs-json has three routes, bearer+cookie on change, public forgot/reset | passed |
| AC-11 | Drift + unit + live primary success/error paths (session driver) | passed |
| AC-12 | Composition registration; `build:api`, `lint`, `test:unit` pass; no migrations needed | passed |
| AC-13 | `EXAMPLES.md` curls for change, forgot, reset | passed |

## Architecture and DI verification

- **Dependency direction:** Application imports Contracts/Domain only; Redis adapter in Infrastructure; composition root in `apps/api` wires tokens — compliant.
- **Domain:** `User.changePassword` atomically sets hash + `authVersion+1` + `updatedAt`.
- **Token registration:** `TOKENS.PasswordResetTokenStore` → `RedisPasswordResetTokenStore` via `useExisting`.
- **API composition:** `AuthApplicationCompositionModule.register` requires `queuesModule` exporting `TOKENS.QueueGateway`; sole consumer `api.module.ts` updated; module spec asserts new providers resolve.
- **Queues:** API registers `[QUEUES.OUTBOX, QUEUES.EMAIL]`; forgot enqueues `send-password-reset-email` with typed `EmailJobPayload`.
- **Mail:** `EMAIL_TEMPLATE.PASSWORD_RESET` + React template + registry case; Worker unchanged (existing `EmailProcessor`).
- **Auth freshness:** Existing JWT/session `authVersion` checks remain the invalidation mechanism; confirmed live under `AUTH_DRIVER=session`.

## Database and migration verification

- No migrations added or required.
- User updates reuse existing `password_hash` / `auth_version` / `updated_at`.
- Reset tokens: Redis keys `password-reset:token:{hash}` and `password-reset:user:{userId}` with TTL.

## Security verification

- Change-password bound to authenticated `user.id`; current password verified; rate-limited.
- Forgot/reset public with stricter rate limits; SHA-256 at rest; single-use atomic consume; 30-minute default TTL.
- Enumeration-safe forgot responses (shape identical).
- No plaintext passwords or raw tokens in HTTP responses; structured logs omit tokens.
- Raw token briefly present in BullMQ job payload (plan-accepted short-lived Redis transit; not Outbox SQL).
- After change/reset, prior credentials fail; completing client receives fresh credentials.

## Commands executed

```text
Command: npm run build:api
Result: exit 0 (nest build api)
Conclusion: API and dependent libs compile.

Command: npm run lint
Result: exit 0 (eslint . --max-warnings=0)
Conclusion: Lint gate passes.

Command: npm run test:unit -- --testPathPatterns="change-password|forgot-password|reset-password|redis-password-reset|openapi-contract|queue-registry"
Result: exit 0 — 6 suites, 26 tests passed
Conclusion: Targeted TASK-003 unit/OpenAPI/queue parity tests pass. (Nest ERROR log noise from openapi-contract stub DI is pre-existing pattern; not test failures.)

Command: npm run test:unit
Result: exit 0 — 23 suites, 150 tests passed
Conclusion: Full unit gate passes including new specs.

Command: npm run test:module -- --testPathPatterns="auth-application"
Result: exit 0 — 1 suite, 1 test passed
Conclusion: Auth composition resolves PasswordResetTokenStore + three new use cases.

Command: Live HTTP smoke (docker compose API on localhost:3000, AUTH_DRIVER=session)
Result:
  - POST /v1/auth/change-password without auth → 401 UNAUTHORIZED
  - POST /v1/auth/forgot-password unknown email → 200 {success:true}
  - POST /v1/auth/reset-password invalid token → 400 INVALID_RESET_TOKEN
  - register → login → change-password → old sid /me 401, new sid /me 200; wrong current 400 INVALID_CURRENT_PASSWORD; same password 400 SAME_PASSWORD; forgot known 200
  - GET /v1/docs-json includes three new routes with expected security
Conclusion: Runtime evidence for AC-01–AC-06, AC-08–AC-11 under session driver. Not an infrastructure gap.
```

## Findings

1. **No high-impact defects** found against the approved specification or plan.
2. **INDEX lag (low):** `docs/agent-tasks/INDEX.md` and `docs/agent-plans/INDEX.md` still show TASK-003 as `proposed` while both the specification and plan files are `approved`. Same class of drift as TASK-002; does not fail ACs.
3. **Composition signature deviation (documented, acceptable):** plan allowed queue module import or QueueGateway via imports; implementer chose required `queuesModule` option and updated all consumers — matches plan allowance.
4. **Full SMTP inbox + reset-token e2e** (read email → extract token → reset) was not executed; AC-07 remains satisfied via queue test double + reset use-case unit tests + live forgot success. Delivery still depends on Worker + `MAIL_DRIVER=smtp` (by design).
5. **JWT-driver live change-password** not exercised in this session (compose used session driver). Shared `createAuthSession` / `authVersion` path and unit coverage make this residual, not a blocker.
6. Pre-existing `cron.module.spec.ts` ioredis mock failure (documented in TASK-002/003 implementation reports) was not re-run as a full `test:module` suite; auth-application module test passes. Out of TASK-003 scope.

## Documentation alignment

- `EXAMPLES.md` §5.2 documents change/forgot/reset curls, enumeration safety, Worker/SMTP prerequisites, TTL and `PASSWORD_RESET_URL_BASE`.
- `README.md` lists the three use cases and HTTP surface; env example includes new vars.
- `.env.example` documents `PASSWORD_RESET_TOKEN_TTL_SECONDS` and `PASSWORD_RESET_URL_BASE`.
- Live OpenAPI matches controller contracts for the three routes.

## Remaining risks

- Reset email delivery requires a running Worker and SMTP (or null-driver skip); forgot still returns generic success when enqueue/delivery fails — operators must watch warn logs.
- Raw reset token briefly exists in BullMQ Redis job payload (plan-accepted).
- Timing side channels on forgot (early return for unknown email) remain a theoretical enumeration risk; response shape is identical.
- If `consume` succeeds and subsequent DB update fails, the token is already spent (race/ops edge case).

## Unverified areas

- End-to-end: forgot → Worker renders `password-reset` → SMTP/null adapter → extract token → `reset-password` success under live mail.
- Live `AUTH_DRIVER=jwt` change/reset cookie-vs-token behavior (session path verified live).
- Visual HTML output of `password-reset.email.tsx` beyond registry compile.
- Full `npm run test:module` suite (cron ioredis pre-existing failure); only `auth-application` module spec re-verified here.
