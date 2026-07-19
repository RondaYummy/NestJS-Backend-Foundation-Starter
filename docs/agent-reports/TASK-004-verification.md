# TASK-004 — Independent verification

## Verdict

approved

## Approved specification

- Path: `docs/agent-tasks/TASK-004-google-sso-module.md`
- Frontmatter `status: approved` (verified)
- Note: `docs/agent-tasks/INDEX.md` still lists TASK-004 as `proposed`; per the approved plan, the specification file is the source of truth for approval status

## Approved plan

- Path: `docs/agent-plans/TASK-004-google-sso-module.md`
- Frontmatter `status: approved` (verified)
- Planner-frozen decisions checked against implementation: Candidate A redirect; callback `GET /v1/auth/google/callback`; `google-auth-library` (no Passport Google strategy); nullable `password_hash` + unique nullable `google_sub`; OQ-04 hybrid JSON/session-302; OQ-05 always-register + 503 `GOOGLE_SSO_DISABLED`; login null-hash → `INVALID_CREDENTIALS`; change-password null-hash → `PASSWORD_NOT_SET`; separate `GoogleAuthController`

## Scope checked

- Exactly one task (`TASK-004`) in the production diff
- Null-hash guards on login/change-password are in-plan coexistence with TASK-003 (already committed), not a second task implementation
- `docs/agent-plans/INDEX.md` adds the TASK-004 plan row only (related housekeeping)
- Documented deviations (acceptable, no AC weakened):
  - `GoogleSsoFlowService` extracted so controllers avoid restricted `@domain/*` imports
  - `IGoogleOAuthStateStore` in Contracts (plan-allowed option)
  - Extra ignored Google callback query fields for `forbidNonWhitelisted`
  - OpenAPI drift success matcher widened to 2xx|3xx for redirect routes
- No acceptance criteria removed or weakened

## Actual changed files

Modified (tracked):

| File | Role |
| ---- | ---- |
| `.env.example`, `EXAMPLES.md`, `README.md` | Consumer enablement docs |
| `package.json`, `package-lock.json` | `google-auth-library` |
| `apps/api/src/api.module.ts` | Registers `GoogleAuthController` |
| `apps/api/src/composition/auth-application.module.ts` (+ spec) | Google module + use case + flow service wiring |
| `apps/api/src/openapi/create-openapi-document.ts` | Extra models / description |
| `apps/api/src/openapi/openapi-contract.spec.ts` | Drift expectations for Google routes |
| `libs/application/.../login.usecase.ts`, `change-password.usecase.ts` (+ specs) | Null-hash guards |
| `libs/contracts/.../user.repository.ts`, `tokens.ts` | `findByGoogleSub`, Google tokens |
| `libs/domain/.../user.entity.ts`, `domain-errors.ts` | Google user model + `ServiceUnavailableError` |
| `libs/infrastructure/config/*`, `env.schema.ts` | Google env + options mapping |
| `libs/infrastructure/.../users.schema.ts`, mapper, repository, migration journal | Persistence |
| `libs/infrastructure/.../global-exception.filter.ts` | 503 mapping |
| `docs/agent-plans/INDEX.md` | Index row |

Created (untracked at verification time):

| File | Role |
| ---- | ---- |
| `libs/contracts/src/auth/google-identity.service.ts` | Identity port |
| `libs/contracts/src/auth/google-oauth-state.store.ts` | State store port |
| `libs/application/.../complete-google-sign-in.usecase.ts` (+ spec) | Sign-in use case |
| `libs/application/.../login.usecase.spec.ts` | AC-05 coverage |
| `libs/infrastructure/src/auth/google-sso.module*.ts` | Optional module |
| `libs/infrastructure/src/auth/google-oauth-identity.service.ts` (+ spec) | Adapter |
| `libs/infrastructure/src/auth/redis-google-oauth-state.store.ts` (+ spec) | CSRF state |
| `libs/infrastructure/.../migrations/0005_curious_captain_marvel.sql` (+ meta snapshot) | Additive migration |
| `apps/api/src/controllers/google-auth.controller.ts` | HTTP endpoints |
| `apps/api/src/auth/google-sso-flow.service.ts` | Flow orchestration |
| `apps/api/src/dto/auth/google-sso-query.dto.ts` | Query DTOs |
| `docs/agent-plans/TASK-004-google-sso-module.md` | Approved plan |
| `docs/agent-reports/TASK-004-implementation.md` | Implementer report (not trusted alone) |

Worker / Cron: no Google HTTP wiring (confirmed by search).

## Requirements matrix

| Requirement | Evidence | Result |
| ----------- | -------- | ------ |
| FR-01 | `CompleteGoogleSignInUseCase` → `IAuthTokenService.createAuthSession`; unit tests for jwt/session shapes | passed |
| FR-02 | `IGoogleIdentityService` / `GoogleIdentityProfile` in Contracts; no Google SDK types | passed |
| FR-03 | `GoogleOauthIdentityService` + typed `GoogleSsoModule.forRoot/forRootAsync`; no `process.env` in adapter | passed |
| FR-04 | `GOOGLE_SSO_ENABLED` default false; `superRefine` requires credentials when enabled | passed |
| FR-05 | `GET /v1/auth/google` + `GET /v1/auth/google/callback`; login-equivalent envelope + session cookie attach | passed |
| FR-06 | `User.createFromGoogle` roles `['user']`; create path unit-tested | passed |
| FR-07 | Verified-email auto-link; unverified → `GOOGLE_SSO_EMAIL_UNVERIFIED` (unit) | passed |
| FR-08 | `users.google_sub` unique; `findByGoogleSub` first in resolution order | passed |
| FR-09 | Nullable hash; login → `INVALID_CREDENTIALS` before bcrypt | passed |
| FR-10 | Redis one-time state + `g_oauth_state` cookie double-submit; ID token `verifyIdToken` + audience | passed |
| FR-11 | `@RateLimit` prefixes `auth:google` / `auth:google-callback` | passed |
| FR-12 | `.env.example`, `EXAMPLES.md` §5.3, `README.md` | passed |
| FR-13 | `UserRegisteredEvent` outbox append inside create transaction | passed |
| FR-14 | Worker/Cron unchanged for Google HTTP | passed |
| NFR-01 | Domain/Application free of `google-auth-library`; adapter only in infrastructure | passed |
| NFR-02 | Typed module options; `mapAppConfigToGoogleSsoOptions` at composition only | passed |
| NFR-03 | Still single `AUTH_DRIVER` registration; Google is identity source only | passed |
| NFR-04 | Adapter maps failures without codes/tokens/secrets; OpenAPI examples use placeholder cookie text | passed |
| NFR-05 | Default disabled; additive migration; existing password auth preserved | passed |
| NFR-06 | `build`, `build:api`, `build:migrations`, `lint`, `test:unit` green; OpenAPI drift green | passed |

## Acceptance criteria matrix

| AC | Evidence | Result |
| -- | -------- | ------ |
| AC-01 | Default env; `auth-application.module.spec.ts` resolves Google ports + use case; full unit suite green | passed |
| AC-02 | Use-case asserts `createAuthSession`; jwt and session auth shapes tested; controller uses `SessionCookieService.attachIfNeeded` | passed |
| AC-03 | Create persists `googleSub`; second sign-in by sub reuses id (unit) | passed |
| AC-04 | Verified link + unverified reject with zero side effects (unit) | passed |
| AC-05 | `login.usecase.spec.ts` null-hash → `INVALID_CREDENTIALS`, no bcrypt | passed |
| AC-06 | State store consume/expire/race tests; flow service cookie/query mismatch → `GOOGLE_SSO_INVALID_STATE` (static + store negatives) | passed |
| AC-07 | `assertEnabled` / disabled stubs throw `ServiceUnavailableError('GOOGLE_SSO_DISABLED')`; filter → 503; no Google contact when disabled | passed |
| AC-08 | OpenAPI documents both routes (public, 200/302/400/401/503, query params, LoginResponseDto); `openapi-contract.spec.ts` passed | passed |
| AC-09 | `.env.example` + EXAMPLES + README inspected | passed |
| AC-10 | `build:api`, `build:migrations`, `build`, `lint`, `test:unit` exit 0; migration file present | passed |
| AC-11 | No Google SDK imports under `libs/domain` or `libs/application` (search) | passed |

## Architecture and DI verification

- Dependency direction preserved: Domain entity/errors → Application use case on Contracts ports → Infrastructure adapters → API composition/controller
- Tokens: `TOKENS.GoogleIdentityService`, `TOKENS.GoogleOAuthStateStore`; options symbol `GOOGLE_SSO_MODULE_OPTIONS`
- `GoogleSsoModule` registers real adapter + Redis state store when enabled; refusing stubs when disabled
- Composition imports `GoogleSsoModule.forRootAsync` with Redis + config; exports use case and flow service for `GoogleAuthController`
- No third auth driver; reuses `IAuthTokenService`
- Transaction + outbox only on first-time Google user create (parity with register)

## Database and migration verification

- `0005_curious_captain_marvel.sql`: `password_hash DROP NOT NULL`; add nullable `google_sub`; unique constraint
- Additive / safe when feature stays disabled
- Journal + snapshot present; `npm run build:migrations` succeeded
- Migration not applied to a live DB in this verification (correct per safety rules)

## Security verification

- CSRF: random base64url state, Redis TTL, cookie binding, one-time consume
- Verified-email gate before email resolve/create
- Hosted-domain optional check after ID token verify
- Return URL allowlisted against `CORS_ORIGINS` origins
- Secrets/tokens not logged; generic token-exchange errors
- Rate limits on both Google routes
- Public endpoints only; no authenticated link endpoint (OQ-07 out of scope)
- Residual: concurrent `google_sub` unique violation on **link update** surfaces as `DuplicateRecordError` (likely 500) rather than mapped conflict — insert race is mapped to `USER_ALREADY_EXISTS`. Low practical impact; noted by implementer

## Commands executed

```text
Command: npm run build:api
Result: Exit 0
Conclusion: API compiles with Google SSO types and controllers

Command: npm run build:migrations
Result: Exit 0
Conclusion: Migrations entrypoint builds with 0005 artifacts

Command: node node_modules/jest/bin/jest.js --config jest.unit.config.ts <targeted Google/auth/OpenAPI specs> --runInBand
Result: Exit 0 — 6 suites, 33 tests
Conclusion: Targeted AC coverage (use cases, adapter, state store, OpenAPI) green

Command: npm run build
Result: Exit 0 (api + worker + cron + migrations)
Conclusion: All entrypoints compile; Worker/Cron unaffected at type level

Command: npm run lint
Result: Exit 0 (--max-warnings=0)
Conclusion: Layering/lint gate passes

Command: npm run test:unit (first attempt via npm script)
Result: Exit 1 — Node wrapper SyntaxError reading PE/MZ binary (Windows toolchain flake)
Conclusion: Environment flake, not a project defect; retried via direct jest

Command: node node_modules/jest/bin/jest.js --config jest.unit.config.ts
Result: Exit 0 — 27 suites, 175 tests
Conclusion: Full unit gate green (AC-10)

Command: node node_modules/jest/bin/jest.js --config jest.module.config.ts --runInBand
Result: Exit 1 — 9/10 suites pass; only `apps/cron/src/cron.module.spec.ts` fails (`ioredis_1.default is not a constructor`)
Conclusion: Pre-existing Cron/BullMQ mock defect; no Cron/Google files changed by TASK-004 — not a TASK-004 regression

Command: node node_modules/jest/bin/jest.js --config jest.module.config.ts --runInBand apps/api/src/composition/auth-application.module.spec.ts
Result: Exit 0 — 1 test
Conclusion: Auth composition boots with Google disabled and resolves Google ports (AC-01)
```

## Findings

### Pass highlights

- Spec/plan approved; implementation matches frozen decisions and layering
- Full functional path covered by unit tests for create/link/unverified/sub-reuse/null-hash/CSRF store/OpenAPI
- Optional module pattern (disabled default, fail-fast when enabled) is correctly wired
- OpenAPI drift includes `/v1/auth/google` and `/v1/auth/google/callback`
- Docs and `.env.example` describe enablement

### Non-blocking residual issues

1. Pre-existing `cron.module.spec.ts` failure keeps full `test:module` red (outside TASK-004)
2. No dedicated `GoogleSsoFlowService` unit file for cookie-mismatch negatives (behavior present; store tests cover Redis consume)
3. `GoogleAuthController` uses `@Res()` without `{ passthrough: true }` (unlike `AuthController`); exception filter still maps domain errors before response write, but this is a style/risk difference
4. Link-path unique race not mapped to conflict (see Security)
5. Live Google OAuth smoke and `start:api` with real Postgres/Redis not run (infra/credentials unavailable — not an automatic code defect per plan)

### High-impact defects

None found that violate required acceptance criteria.

## Documentation alignment

- Spec/plan/docs/OpenAPI/env example align on paths, disabled 503 code, hybrid success UX, and env names
- Task INDEX status lag (`proposed`) is documentation index drift only; file frontmatter is approved

## Remaining risks

- Production enablement still needs a real Google OAuth client, HTTPS redirect URI, and CORS allowlist for `returnUrl`
- Auto-link trusts Google `email_verified` (inherent to approved policy)
- Windows intermittent npm/jest flakes may require direct `node node_modules/jest/...` retries
- Concurrent Google-link unique race may return 500 until mapped

## Unverified areas

- End-to-end HTTP smoke with `GOOGLE_SSO_ENABLED=true` against live Google
- `npm run start:api` against real PostgreSQL/Redis
- Applying migration `0005_*` to a database (intentionally not done)
- HTTP-level assertion that disabled start/callback return 503 envelope (covered by static mapping + composition, not HTTP e2e)
