# TASK-003 — Implementation report

## Verdict

implemented

## Approved specification

- `docs/agent-tasks/TASK-003-change-password.md` — frontmatter `status: approved` (verified before any edit).
- Scope: authenticated `POST /auth/change-password` plus public `POST /auth/forgot-password` / `POST /auth/reset-password` email-reset flow, with auth re-issue after change/reset, OpenAPI coverage, and docs.

## Approved plan

- `docs/agent-plans/TASK-003-change-password.md` — frontmatter `status: approved` (verified before any edit).
- Implemented all five plan phases in order. Planner defaults applied as approved: Redis-only hashed token store, TTL default 1800 s, no HTTP token backdoor, email enqueued to `QUEUES.EMAIL` from the API, rate limits forgot 3/3600 s and reset 5/900 s, `PASSWORD_RESET_URL_BASE` optional.

## Changed files

New production/test files:

| Path | Purpose |
| ---- | ------- |
| `libs/contracts/src/auth/password-reset-token-store.ts` | `IPasswordResetTokenStore` port (save / atomic single-use consume) |
| `libs/infrastructure/src/auth/redis-password-reset-token-store.service.ts` | Redis adapter; stores SHA-256 hashes only; `compareAndDelete` for single-use |
| `libs/infrastructure/src/auth/redis-password-reset-token-store.service.spec.ts` | Store unit tests (hash-only keys, TTL args, consume-once, prior-token invalidation) |
| `libs/application/src/use-cases/auth/change-password.usecase.ts` | Verify current password, reject same password, `User.changePassword`, re-issue auth |
| `libs/application/src/use-cases/auth/change-password.usecase.spec.ts` | AC-01, AC-03, AC-04, AC-05, AC-09 |
| `libs/application/src/use-cases/auth/forgot-password.usecase.ts` | Enumeration-safe request; token generation/hashing; enqueue reset email; warn-on-enqueue-failure |
| `libs/application/src/use-cases/auth/forgot-password.usecase.spec.ts` | AC-06, AC-07 (token capture via queue fake), AC-09, FR-12/FR-15 |
| `libs/application/src/use-cases/auth/reset-password.usecase.ts` | Consume hashed token, set password, bump authVersion, re-issue auth |
| `libs/application/src/use-cases/auth/reset-password.usecase.spec.ts` | AC-07, AC-08, AC-09 |
| `libs/infrastructure/src/mail/templates/password-reset.email.tsx` | React Email template (token + optional reset URL + expiry minutes) |
| `apps/api/src/dto/auth/change-password.dto.ts` | `currentPassword` / `newPassword`, both `@MinLength(8)` |
| `apps/api/src/dto/auth/forgot-password.dto.ts` | `email` (`@IsEmail`) |
| `apps/api/src/dto/auth/reset-password.dto.ts` | `token` (non-empty) / `newPassword` (`@MinLength(8)`) |

Modified files:

| Path | Change |
| ---- | ------ |
| `libs/domain/src/entities/user.entity.ts` | `changePassword(passwordHash)` — new hash + `authVersion + 1` + fresh `updatedAt` in one transition |
| `libs/contracts/src/tokens.ts` | `TOKENS.PasswordResetTokenStore` |
| `libs/contracts/src/mail/email-template-id.ts` | `PASSWORD_RESET: 'password-reset'` |
| `libs/contracts/src/mail/email-template-data.ts` | `'password-reset'` data map (`email`, `token`, `resetUrl?`, `expiresInMinutes`) |
| `libs/contracts/src/queues/queue-gateway.ts` | `email['send-password-reset-email']: EmailJobPayload` |
| `libs/infrastructure/src/mail/mail-template.registry.tsx` | `PASSWORD_RESET` case; welcome case adjusted per lint (no behavior change) |
| `libs/infrastructure/src/mail/templates/index.ts` | Re-export new template |
| `libs/infrastructure/src/config/env.schema.ts` | `PASSWORD_RESET_TOKEN_TTL_SECONDS` (default 1800), `PASSWORD_RESET_URL_BASE` (default '') |
| `libs/infrastructure/src/config/infrastructure-config.module.ts` | Map `passwordReset` config slice |
| `libs/infrastructure/src/config/app-config.service.ts` | `passwordReset()` accessor |
| `.env.example` | Document the two new env vars + Worker/SMTP delivery note |
| `apps/api/src/api.module.ts` | Register `QUEUES.EMAIL` alongside `OUTBOX`; pass `queuesModule` into Auth composition |
| `apps/api/src/composition/auth-application.module.ts` | New required `queuesModule` option; `LoggerModule` import; providers/exports for token store + three use cases |
| `apps/api/src/composition/auth-application.module.spec.ts` | Stub queues module for the new required option; asserts new providers resolve |
| `apps/api/src/controllers/auth.controller.ts` | Three endpoints with `@HttpCode(200)`, guards, rate limits, cookie attach, full OpenAPI decorators |
| `apps/api/src/dto/auth/auth-response.dto.ts` | `ForgotPasswordResponseDto` |
| `apps/api/src/openapi/create-openapi-document.ts` | Four new DTOs in `extraModels` |
| `apps/api/src/openapi/openapi-contract.spec.ts` | Three new routes, schema presence, security (bearer+cookie on change; none on forgot/reset), request-body and 200-response `$ref` assertions |
| `EXAMPLES.md` | New §5.2 curl examples (change/forgot/reset) + §9 aligned to the real `password-reset` template |
| `README.md` | §6.3 auth use-case list + HTTP surface note; §21 env example gains the two password-reset vars |

Not part of TASK-003 (pre-existing, preserved untouched): staged TASK-002 changes across `apps/api/src/main.ts`, controller/openapi/docs files, `docs/agent-*` TASK-002 artifacts, the unstaged `docs/agent-plans/INDEX.md` line, and the untracked approved plan file `docs/agent-plans/TASK-003-change-password.md`.

## Completed phases

1. **Phase 1 — Domain + contracts + Redis token store + config**: done (store spec 5/5 green).
2. **Phase 2 — Application use cases + unit tests**: done (3 suites / 15 tests green).
3. **Phase 3 — Mail template + queue registry + API composition**: done (composition module DI spec green).
4. **Phase 4 — HTTP + OpenAPI**: done (openapi-contract spec 3/3 green with new assertions).
5. **Phase 5 — Docs + full verification**: done (EXAMPLES §5.2, README, builds/lint/test:unit green).

## Acceptance criteria self-check

| AC | Status | Evidence |
| -- | ------ | -------- |
| AC-01 | met (unit + static) | Change-password unit success path returns login shape with fresh auth; controller attaches session cookie; `@HttpCode(200)` |
| AC-02 | met (static + contract) | `@UseGuards(AuthGuard, ...)` on change-password; OpenAPI security bearer+sessionCookie asserted by drift spec |
| AC-03 | met (unit) | Wrong current → `ValidationError('INVALID_CURRENT_PASSWORD')`; `update` not called |
| AC-04 | met (unit) | Same password → `SAME_PASSWORD`; no hash/update calls |
| AC-05 | met (unit) | `createAuthSession` called with bumped `authVersion` (3→4); existing authVersion-freshness machinery invalidates prior credentials |
| AC-06 | met (unit) | Known and unknown emails both return `{ success: true }`; store/enqueue skipped for unknown |
| AC-07 | met (unit; runtime e2e not executed) | Queue fake captures raw token; stored value equals SHA-256 of it; reset use case consumes and re-issues auth |
| AC-08 | met (unit) | `consume` returns null on missing/raced token → `INVALID_RESET_TOKEN`, password unchanged; Redis adapter deletes atomically via `compareAndDelete` |
| AC-09 | met (unit) | Result serialization asserted to exclude hashes/passwords/raw token; logs asserted to exclude raw token; store persists hash only |
| AC-10 | met | `openapi-contract.spec.ts` extended and passing: 3 routes, schemas, security, request bodies, 200 responses |
| AC-11 | met for contract/unit level | Drift test + unit tests; live bootstrap smoke not run (see Unverified areas) |
| AC-12 | met | Composition registers all three use cases + token store; `build` (all 4 entrypoints), `lint`, `test:unit` pass; no SQL store → no migrations build required (still built successfully) |
| AC-13 | met | `EXAMPLES.md` §5.2 has curl for change, forgot, reset + mail/Worker/env notes |

## Contract and DI changes

- New port `IPasswordResetTokenStore` + `TOKENS.PasswordResetTokenStore`, implemented by `RedisPasswordResetTokenStore`, registered in `AuthApplicationCompositionModule`.
- `QueueJobRegistry.email` gains `'send-password-reset-email'` (payload type `EmailJobPayload`, same as welcome).
- `EMAIL_TEMPLATE.PASSWORD_RESET` + typed template data; Worker's existing `EmailProcessor` renders it via the registry with no Worker changes.
- `AuthApplicationCompositionModule.register` now requires `queuesModule` (module exporting `TOKENS.QueueGateway`). Sole consumer `apps/api/src/api.module.ts` updated in the same change; its module spec updated with a stub queues module. API now registers `QUEUES.EMAIL` in addition to `QUEUES.OUTBOX`.
- `ForgotPasswordUseCase` takes a minimal structural logger port satisfied by `AppLogger` at composition, keeping the application layer free of infrastructure imports.

## Database and migration changes

- None. Reset tokens live only in Redis (`password-reset:token:{sha256}` → userId, `password-reset:user:{userId}` → hash, both TTL-bound). User updates reuse existing `password_hash` / `auth_version` columns.

## Commands executed

```bash
npm run test:unit -- redis-password-reset
node node_modules/jest/bin/jest.js --config jest.unit.config.ts redis-password-reset
node node_modules/jest/bin/jest.js --config jest.unit.config.ts change-password forgot-password reset-password
node node_modules/jest/bin/jest.js --config jest.module.config.ts auth-application
node node_modules/jest/bin/jest.js --config jest.unit.config.ts openapi-contract
npm run build
node node_modules/@nestjs/cli/bin/nest.js build api && ... build worker && ... build cron && ... build migrations   # twice: fail → fix → pass
npm run lint                                                                                                        # twice: fail → fix → pass
npm run test:unit
node node_modules/jest/bin/jest.js --config jest.unit.config.ts
node node_modules/jest/bin/jest.js --config jest.module.config.ts
node node_modules/jest/bin/jest.js --config jest.module.config.ts apps/cron/src/cron.module.spec.ts
git status && git diff --name-only && git diff --stat
```

## Command results

| Command | Result | Conclusion |
| ------- | ------ | ---------- |
| `npm run test:unit -- redis-password-reset` | Exit -4048, no Jest output | Intermittent Windows npm wrapper crash (known pattern per AGENTS P2-08/P2-11); retried via direct node invocation |
| Direct jest, `redis-password-reset` | Exit 0 — 1 suite, 5 tests | Phase 1 store behavior verified |
| Direct jest, `change-password forgot-password reset-password` | Exit 0 — 3 suites, 15 tests | Phase 2 use-case behavior verified |
| Direct jest module config, `auth-application` | Exit 0 — 1 suite, 1 test | Composition resolves token store + three new use cases |
| Direct jest, `openapi-contract` | Exit 0 — 3 tests | AC-10 drift assertions pass (handler ERROR logs come from mocked DI smoke requests, pre-existing pattern, not failures) |
| `npm run build` | Exit -1073741819 (0xC0000005), no compiler output | Same intermittent npm wrapper crash; retried via nest CLI directly |
| nest CLI build ×4 (first run) | Exit 1 — 6 TS errors (`noUncheckedIndexedAccess` on `mock.calls[0]` in the three new spec files) | Fixed with explicit non-null assertions in test code only |
| nest CLI build ×4 (second run) | Exit 0 | API, Worker, Cron, Migrations all compile |
| `npm run lint` (first run) | Exit 1 — 2 `no-unnecessary-type-assertion` errors in new/edited files | Removed the two unnecessary assertions |
| `npm run lint` (second run) | Exit 0 with `--max-warnings=0` | Lint gate passes |
| `npm run test:unit` | Exit -4048 wrapper crash; direct jest rerun: Exit 0 — 23 suites, 150 tests | Full unit gate passes including all new specs |
| Direct jest module config (full) | Exit 1 — 9/10 suites pass; only `apps/cron/src/cron.module.spec.ts` fails (`ioredis_1.default is not a constructor` in its BullMQ/ioredis jest mock) | Pre-existing failure, already documented as pre-existing/unrelated in TASK-002 implementation and verification reports; TASK-003 touches no Cron/BullMQ-runtime/ioredis file |
| Cron spec isolated re-run | Exit 1 — same failure | Confirms deterministic pre-existing failure independent of suite ordering |
| `git status` / `git diff --name-only` / `git diff --stat` | 21 modified + 14 untracked files (13 TASK-003 + 1 pre-existing plan file) | Matches the changed-file list above; staged TASK-002 work preserved untouched |

## Deviations

1. **`AuthApplicationCompositionModule.register` signature gained a required `queuesModule` option** — the plan explicitly allowed "accepts queue module import (or receives `TOKENS.QueueGateway` via imports)"; the required option was chosen for explicitness. Both consumers (api.module, module spec) updated together.
2. **Test-only syntax fixes after first build/lint run** (non-null assertions on `mock.calls[0]`; removal of two lint-flagged unnecessary type assertions, one in `mail-template.registry.tsx` where the `welcome` cast proved redundant). No behavior change.
3. **npm wrapper crashes on Windows** (`npm run test:unit`, `npm run build`) were worked around by invoking `node node_modules/jest/bin/jest.js` / `node node_modules/@nestjs/cli/bin/nest.js` directly — the same underlying binaries the npm scripts call; consistent with the repository's documented Windows wrapper-crash mitigation.

## Documentation changes

- `EXAMPLES.md`: new §5.2 with curl for change-password, forgot-password, reset-password; response/error semantics; Worker + `MAIL_DRIVER=smtp` + `PASSWORD_RESET_URL_BASE` delivery notes; §9 template example aligned with the real `password-reset` template.
- `README.md`: §6.3 lists the three new use cases and the `/v1/auth/...` HTTP surface incl. password endpoints; §21 env example gains `PASSWORD_RESET_TOKEN_TTL_SECONDS` / `PASSWORD_RESET_URL_BASE`.
- `.env.example`: both new vars documented with delivery prerequisites.

## Remaining risks

- Raw reset token transits briefly through the BullMQ job payload in Redis (plan-accepted trade-off; hashed at rest in the durable token keys, never in Outbox SQL or HTTP responses).
- Reset email delivery depends on a running Worker and `MAIL_DRIVER=smtp`; forgot-password still returns generic success when delivery is impossible (by design, FR-12/FR-15) — operators must monitor warn logs.
- `npm run test:module` remains red solely due to the pre-existing `cron.module.spec.ts` ioredis-mock failure (needs its own bugfix ticket; out of TASK-003 scope).
- Registering `QUEUES.EMAIL` in the API means API health/queue wiring now includes the email queue (same connection; no extra infrastructure required).

## Unverified areas

- **Live bootstrap smoke (spec verification step 5, optional)**: full HTTP round-trips (change → old credential 401 / new credential 200 on `/v1/auth/me`; forgot → real email → reset) were not executed against running PostgreSQL/Redis/Worker/SMTP in this session. AC-05/AC-07/AC-11 runtime behavior is covered at unit/contract level; infrastructure-dependent end-to-end evidence is left to independent verification.
- Session-driver (`AUTH_DRIVER=session`) cookie attach on change/reset is exercised via the shared `SessionCookieService.attachIfNeeded` path (same as login) but not live-tested here.
- Real SMTP rendering of `password-reset.email.tsx` (template compiles and registry resolves; visual output unverified).
