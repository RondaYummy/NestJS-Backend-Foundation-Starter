---
task_id: TASK-004
specification: docs/agent-tasks/TASK-004-google-sso-module.md
status: approved
owner: human-approval-required
---

# TASK-004 — Implementation plan

## Approved specification

- Spec: `docs/agent-tasks/TASK-004-google-sso-module.md`
- Spec status: `approved` (verified in file frontmatter before planning; `docs/agent-tasks/INDEX.md` may still say `proposed` — treat the specification file as source of truth)
- Human decisions already frozen in the spec:
  1. Account linking: **auto-link** when Google email matches an existing local user **and** Google email is verified
  2. Primary OAuth flow: **Candidate A** (authorization-code redirect)
  3. Lookup order: Google `sub` first, then email auto-link policy
  4. Same auth artifacts as `POST /v1/auth/login` for active `AUTH_DRIVER`
  5. Rate-limit with auth routes (`auth:*` / `RATE_LIMIT_AUTH_*`)
  6. Optional / off by default; fail-fast when enabled without credentials
  7. levych-api is **non-normative** — improve (typed config, persist `sub`, no wildcard `postMessage`, layered architecture, verified-email gate, nullable `password_hash`, full OpenAPI)

### Planner-frozen decisions (were open in the spec)

| ID | Decision | Rationale |
| -- | -------- | --------- |
| **OQ-03** | **Nullable `password_hash`** for Google-only users | Matches FR-09 / A-10; avoids placeholder hashes |
| **OQ-04** | **Hybrid success UX** — see Architecture decision | JSON is the canonical OpenAPI success contract; allowlisted 302 is available for session/browser without putting JWTs in URLs |
| **OQ-05** | **Always register routes**; disabled → **503** `GOOGLE_SSO_DISABLED` | Spec planning default; keeps OpenAPI stable |
| **OQ-06** | Keep starter Google SSO **independent** of legacy `/v1/auth/google*` migration docs | Spec planning default; out of scope |
| **OQ-07** | Authenticated “link Google while logged in” **out of MVP** | Spec planning default |
| **OQ-08** | Optional `GOOGLE_SSO_HOSTED_DOMAIN`; empty = unrestricted | Spec planning default |
| **FR-05 naming** | Callback path **`GET /v1/auth/google/callback`** (not `/redirect`) | Matches spec “recommended” table; clearer OAuth vocabulary |
| **Dependency** | Add **`google-auth-library`**; do **not** add `@nestjs/passport` / `passport-google-oauth20` | Existing `passport` / `passport-jwt` are unused by current AuthModule (`@nestjs/jwt`); port-based HTTP token exchange keeps Google SDK out of Application/Domain |
| **Schema** | Nullable unique column **`users.google_sub`**; nullable **`users.password_hash`** | One provider is enough (A-06); avoids multi-IdP framework in MVP |
| **Controller** | Separate **`GoogleAuthController`** `@Controller('auth/google')` | Keeps password auth controller from growing further (TASK-003 already expanded it) |
| **Login null-hash code** | `POST /v1/auth/login` rejects null hash with **`INVALID_CREDENTIALS`** (same as wrong password) | Avoids revealing Google-only accounts; AC-05 only requires rejection |
| **Change-password null-hash** | When `passwordHash === null`, fail with **`PASSWORD_NOT_SET`** (400) | Aligns with TASK-003 planner note; reset-password remains the path to set an initial password |

## Current implementation

Inspected branch state (auth + config + user model). Working tree already contains **TASK-003 password change/reset** implementation (uncommitted / in progress) — this plan must coexist with it, not rewrite it.

| Area | Current behavior |
| ---- | ---------------- |
| URI versioning | `apps/api/src/main.ts` — `setGlobalPrefix('v1')` with health exclusions; controllers stay `@Controller('auth')`; public paths `/v1/auth/...` |
| HTTP Auth | `apps/api/src/controllers/auth.controller.ts` — register/login/logout/refresh/me + change/forgot/reset password; **no Google routes** |
| Composition | `apps/api/src/composition/auth-application.module.ts` wires Register/Login/Logout/Refresh/GetCurrentUser/Change/Forgot/Reset + `SessionCookieService` + `AuthModule.forRootAsync` |
| Login success | `LoginUseCase` → `IAuthTokenService.createAuthSession`; controller `SessionCookieService.attachIfNeeded`; `{ success, data: { user, auth } }` |
| User domain | `User` requires non-null `passwordHash`; has `changePassword`, `incrementAuthVersion`; **no** `googleSub` |
| User schema | `users.password_hash` **NOT NULL**; no Google subject column |
| User repo | `findById` / `findByEmail` / `insert` / `update` / `incrementAuthVersion` only |
| Optional drivers | `MAIL_DRIVER` / `STORAGE_DRIVER` in `env.schema.ts` with `superRefine` credentials-when-enabled; modules use typed `forRoot` / `forRootAsync`; adapters must not read `process.env` |
| Auth engine | Exactly one of jwt/session against `TOKENS.AuthTokenService`; Redis-backed stores |
| Rate limit | `@RateLimit({ keyPrefix: 'auth:…' })`; defaults `RATE_LIMIT_AUTH_MAX=5` / `RATE_LIMIT_AUTH_TTL=60` |
| Errors | Domain errors via `GlobalExceptionFilter`; **no** 503 / `ServiceUnavailable` mapping yet |
| OpenAPI | DTOs + `create-openapi-document.ts` `extraModels`; drift test expects `/v1/auth/*` including TASK-003 routes |
| Dependencies | `passport` / `passport-jwt` present but AuthModule uses `@nestjs/jwt` directly; **no** Google OAuth packages |
| Migrations | Latest checked-in SQL is `0004_amusing_sauron.sql` (auth_version); next Google/password-nullability migration will be `0005_*` via `npm run db:generate` |
| Docs | `.env.example` / `EXAMPLES.md` / `README.md` document password auth + TASK-003 reset; no Google SSO |

**Concurrent TASK-003 interaction (important):**

- `ChangePasswordUseCase` / `LoginUseCase` call `passwordHasher.compare(..., user.passwordHash)` assuming a string hash.
- `ForgotPasswordUseCase` / `ResetPasswordUseCase` can set an initial password for Google-only users once `password_hash` is nullable (desirable).
- `User.changePassword` / mapper / drizzle schema currently assume non-null hash — TASK-004 must widen types carefully and patch login/change-password null guards without regressing TASK-003 tests.

## Architecture decision

### Optional Google SSO module (Mail/Storage pattern)

1. Add env `GOOGLE_SSO_ENABLED` default **`false`**. When `false`, API boots without Google credentials and routes return **503** `GOOGLE_SSO_DISABLED` without calling Google.
2. When `true`, `env.schema` `superRefine` requires non-empty `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`.
3. Infrastructure `GoogleSsoModule.forRoot` / `forRootAsync` accepts typed `GoogleSsoModuleOptions` (enabled discriminated union). Composition maps `AppConfigService` → options; module remains portable without requiring `AppConfigService` as its only API.
4. Contracts port `IGoogleIdentityService` (name frozen below) exchanges authorization `code` → verified profile (`sub`, `email`, `emailVerified`) without exposing Google SDK types to Application/Domain.
5. Application `CompleteGoogleSignInUseCase` (given verified profile): lookup by `googleSub` → else email auto-link if verified → else create Google-only user; then `IAuthTokenService.createAuthSession`. First-time create emits `UserRegisteredEvent` via Outbox inside a transaction (parity with `RegisterUseCase`).

### Candidate A HTTP flow

| Step | Behavior |
| ---- | -------- |
| `GET /v1/auth/google` | If disabled → 503. Else generate opaque `state`, store in Redis `google-sso:state:{state}` (TTL from config, default 600s) with optional allowlisted `returnUrl`, set httpOnly cookie `g_oauth_state` (SameSite=Lax, Secure in production, Path=/), **302** to Google authorization URL (`response_type=code`, `scope=openid email profile`, `client_id`, `redirect_uri`, `state`, optional `hd`) |
| `GET /v1/auth/google/callback` | If disabled → 503. Validate `state` (query == cookie) and **consume** Redis state (one-time). On Google `error` query → 401. Exchange `code` via port. Run use case. Attach session cookie if present. Then apply success UX below |

### OQ-04 success UX (frozen hybrid)

**Canonical success contract (OpenAPI + AC-02):** HTTP **200** JSON `{ success: true, data: { user, auth } }` reusing `LoginResponseDto` / `AuthUserDto` / `AuthTokensDto`, plus `Set-Cookie` when `AUTH_DRIVER=session`.

**Optional browser redirect (session-friendly):**

- Start accepts optional query `returnUrl` (absolute URL).
- Allowlist: URL origin must be in the parsed `CORS_ORIGINS` list (same origins the API already trusts for browser clients). Invalid `returnUrl` → **400** `INVALID_RETURN_URL` before redirecting to Google.
- If OAuth state recorded a valid `returnUrl` **and** `AUTH_DRIVER=session`: after attaching the session cookie, respond **302** to that `returnUrl` (no tokens in URL, no `postMessage`).
- If `returnUrl` was provided but `AUTH_DRIVER=jwt`: **ignore redirect for success delivery** and return the JSON login envelope (do not put JWTs in query/fragment). Document that JWT browser apps should use a BFF that consumes the JSON callback, or use session driver for cookie+302.
- If no `returnUrl`: always JSON 200.
- Optional env `GOOGLE_SSO_DEFAULT_RETURN_URL`: used only when start omits `returnUrl` and the default passes the same allowlist check; otherwise JSON.

**Forbidden:** wildcard `postMessage`, inline popup HTML as primary contract, tokens in URL query for production JWT delivery.

### CSRF / state

- Cryptographically random `state` (`randomBytes(32)` → base64url).
- Persist Redis entry; delete on successful consume (get+del / compareAndDelete pattern).
- Cookie `g_oauth_state` holds the same state value for double-submit binding.
- Mismatch / missing / expired → **400** `GOOGLE_SSO_INVALID_STATE`.

### Identity resolution (FR-07 / FR-08)

```text
1. findByGoogleSub(sub) → if found, createAuthSession
2. else if emailVerified === false → reject AuthenticationError GOOGLE_SSO_EMAIL_UNVERIFIED
3. else findByEmail(normalized email)
   - if found → link googleSub on user (update) → createAuthSession
   - if not → User.createFromGoogle({ email, googleSub }) with passwordHash=null, roles=['user']
     → insert + UserRegisteredEvent in transaction → createAuthSession
```

If `findByGoogleSub` finds user A but email belongs to different user B (should not happen if sub is durable), prefer **sub** identity and do not re-link by email.

### Nullable password + TASK-003 coexistence

- Domain/schema/mapper: `passwordHash: string | null`, `googleSub: string | null`.
- `LoginUseCase`: if `user.passwordHash == null` → `ValidationError('INVALID_CREDENTIALS', ...)` **before** bcrypt compare.
- `ChangePasswordUseCase`: if `user.passwordHash == null` → `ValidationError('PASSWORD_NOT_SET', ...)` (do not call bcrypt with null).
- `ForgotPasswordUseCase` / `ResetPasswordUseCase`: **allow** Google-only users (null hash) to obtain/set a password via reset (no change to enumeration-safe forgot behavior beyond null-safe compare absence).
- `RegisterUseCase` continues to require a password (non-null hash).

### 503 mapping

Add `ServiceUnavailableError` to `libs/domain/src/errors/domain-errors.ts` and map it to HTTP **503** in `GlobalExceptionFilter`. Use it for `GOOGLE_SSO_DISABLED` (and keep message free of secrets).

### Dependency choice

Add runtime dependency **`google-auth-library`**. Infrastructure adapter uses `OAuth2Client` for `getToken(code)` + `getTokenInfo` / ID token payload / userinfo as needed to obtain `sub`, `email`, `email_verified`. Unit tests mock the port or HTTP layer — **no live Google in CI**.

Do **not** introduce Passport Google strategy (avoids `process.env` in strategy, Nest Passport ceremony, and unused passport stack growth).

## Scope

- Domain user model: nullable password + Google subject association helpers
- Contracts: Google identity port + token; extend `IUserRepository`
- Application: `CompleteGoogleSignInUseCase` (+ unit tests); login/change-password null-hash guards
- Infrastructure: env/config, `GoogleSsoModule`, Google OAuth adapter, Redis OAuth state store, drizzle schema + migration, repository/mapper updates
- API: `GoogleAuthController`, composition wiring, OpenAPI + drift test
- Docs: `.env.example`, brief `EXAMPLES.md` and/or `README.md` enablement section
- Dependency: `google-auth-library` (+ lockfile update as intentional part of this task)

## Out of scope

- Apple / Facebook / generic multi-provider IdP framework
- Candidate B ID-token POST endpoint
- Legacy levych `/v1/auth/google*` popup `postMessage` parity
- Authenticated “link Google to my account” (OQ-07)
- Hosted-domain-only product policy beyond optional config
- Worker / Cron Google HTTP
- Changing `AUTH_DRIVER` model or password hashing algorithm
- Live Google Cloud console setup beyond documenting redirect URI + env vars
- Frontend SPA implementation
- Putting JWT access/refresh tokens in redirect URLs

## Files to create

| Path | Responsibility |
| ---- | -------------- |
| `libs/contracts/src/auth/google-identity.service.ts` | Port types: `GoogleIdentityProfile`, `IGoogleIdentityService.exchangeAuthorizationCode(code)` |
| `libs/application/src/use-cases/auth/complete-google-sign-in.usecase.ts` | Find/link/create user + `createAuthSession` + outbox on create |
| `libs/application/src/use-cases/auth/complete-google-sign-in.usecase.spec.ts` | Unit tests for create / link / unverified / sub reuse |
| `libs/infrastructure/src/auth/google-sso.module-options.ts` | Typed options + `GOOGLE_SSO_MODULE_OPTIONS` symbol + type guards |
| `libs/infrastructure/src/auth/google-sso.module.ts` | `forRoot` / `forRootAsync`; registers port + state store when enabled; disabled stub port optional |
| `libs/infrastructure/src/auth/google-oauth-identity.service.ts` | `google-auth-library` adapter implementing the port |
| `libs/infrastructure/src/auth/google-oauth-identity.service.spec.ts` | Adapter tests with mocked OAuth client / HTTP |
| `libs/infrastructure/src/auth/redis-google-oauth-state.store.ts` | Redis TTL store for OAuth `state` (+ optional returnUrl payload) |
| `libs/infrastructure/src/auth/redis-google-oauth-state.store.spec.ts` | Store unit tests |
| `apps/api/src/controllers/google-auth.controller.ts` | `GET google` start + `GET google/callback` |
| `apps/api/src/dto/auth/google-sso-query.dto.ts` | Optional `returnUrl` query DTO / validation docs |
| `libs/infrastructure/src/database/drizzle/migrations/0005_*.sql` (+ meta) | Generated migration: nullable `password_hash`, add unique nullable `google_sub` |
| `docs/agent-plans/TASK-004-google-sso-module.md` | This plan (planner deliverable) |

## Files to modify

| Path | Change |
| ---- | ------ |
| `package.json` / `package-lock.json` | Add `google-auth-library` |
| `libs/domain/src/entities/user.entity.ts` | Nullable `passwordHash`; `googleSub`; `createFromGoogle`; `linkGoogleSubject` |
| `libs/domain/src/errors/domain-errors.ts` | Add `ServiceUnavailableError` |
| `libs/contracts/src/repositories/user.repository.ts` | Add `findByGoogleSub` |
| `libs/contracts/src/tokens.ts` | Add `GoogleIdentityService` (and optional `GoogleOAuthStateStore` if not internal-only) |
| `libs/application/src/use-cases/auth/login.usecase.ts` | Null-hash → `INVALID_CREDENTIALS` |
| `libs/application/src/use-cases/auth/login.usecase.spec.ts` | Add/adjust if present; else add focused null-hash test file |
| `libs/application/src/use-cases/auth/change-password.usecase.ts` | Null-hash → `PASSWORD_NOT_SET` |
| `libs/application/src/use-cases/auth/change-password.usecase.spec.ts` | Cover `PASSWORD_NOT_SET` |
| `libs/infrastructure/src/database/drizzle/schema/users.schema.ts` | Nullable password; `googleSub` unique |
| `libs/infrastructure/src/mappers/user.mapper.ts` | Map nullables + `googleSub` |
| `libs/infrastructure/src/repositories/user-drizzle.repository.ts` | `findByGoogleSub`; persist `googleSub`; unique violation handling if needed |
| `libs/infrastructure/src/exceptions/global-exception.filter.ts` | Map `ServiceUnavailableError` → 503 |
| `libs/infrastructure/src/config/env.schema.ts` | Google env + `superRefine` |
| `libs/infrastructure/src/config/infrastructure-config.module.ts` | Map Google config slice |
| `libs/infrastructure/src/config/app-config.service.ts` | `googleSso()` accessor |
| `libs/infrastructure/src/config/create-starter-kit-module-options.ts` | `mapAppConfigToGoogleSsoOptions` |
| `apps/api/src/composition/auth-application.module.ts` | Register Google module + `CompleteGoogleSignInUseCase` |
| `apps/api/src/composition/auth-application.module.spec.ts` | Still boots with Google disabled (default) |
| `apps/api/src/api.module.ts` | Register `GoogleAuthController` |
| `apps/api/src/openapi/create-openapi-document.ts` | Extra models / description note for Google SSO |
| `apps/api/src/openapi/openapi-contract.spec.ts` | Expect `/v1/auth/google` + `/v1/auth/google/callback` |
| `.env.example` | Document Google SSO vars (disabled by default) |
| `EXAMPLES.md` | Short enablement + curl/browser flow |
| `README.md` | Brief optional-module mention (auth section) |

## Files to delete

- None

## Domain changes

- `UserProps.passwordHash: string | null`
- `UserProps.googleSub: string | null` (default `null` on restore/create)
- `User.create` — password registration path unchanged (non-null hash, `googleSub: null`)
- `User.createFromGoogle({ email, googleSub, roles? })` — `passwordHash: null`, roles default `['user']`
- `User.linkGoogleSubject(googleSub: string): User` — sets `googleSub`, updates `updatedAt` (no authVersion bump required for link-only)
- `User.changePassword` — still requires non-null hash string (reset/change paths)
- `ServiceUnavailableError` domain error class

No Google SDK types in Domain.

## Application changes

### `CompleteGoogleSignInUseCase`

Constructor ports: `IUserRepository`, `IAuthTokenService`, `ITransactionManager`, `IOutboxWriter`.

Input: `{ sub: string; email: string; emailVerified: boolean }` (already verified by infrastructure port).

Output: same shape as `LoginUseCase` (`{ user, auth }`).

### Existing use cases

- `LoginUseCase` — null password guard
- `ChangePasswordUseCase` — `PASSWORD_NOT_SET` guard

No Google SDK imports in Application.

## Contract and DI changes

### New / extended contracts

```ts
// libs/contracts/src/auth/google-identity.service.ts
export type GoogleIdentityProfile = {
  sub: string;
  email: string;
  emailVerified: boolean;
};

export interface IGoogleIdentityService {
  exchangeAuthorizationCode(code: string): Promise<GoogleIdentityProfile>;
}
```

```ts
// IUserRepository addition
findByGoogleSub(googleSub: string, trx?: TransactionContext): Promise<User | null>;
```

```ts
// TOKENS
GoogleIdentityService: Symbol('IGoogleIdentityService'),
```

OAuth state store may remain infrastructure-internal (injected into controller/helper) **or** expose `IGoogleOAuthStateStore` under Contracts if the controller stays thin and tests need a port — prefer a small contracts port if the controller would otherwise import Redis types.

### Composition

- `AuthApplicationCompositionModule` imports `GoogleSsoModule.forRootAsync({ inject: [AppConfigService], useFactory: mapAppConfigToGoogleSsoOptions })` with redis available for state store.
- Provide `CompleteGoogleSignInUseCase` factory (users + auth tokens + tx + outbox).
- Export the use case for `GoogleAuthController`.

When `enabled: false`, still register a stub `IGoogleIdentityService` that throws `ServiceUnavailableError('GOOGLE_SSO_DISABLED', ...)` if called — controller should short-circuit first so Google is never contacted (AC-07).

## Infrastructure changes

### Config / env (frozen names)

```text
GOOGLE_SSO_ENABLED=false
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=
GOOGLE_SSO_HOSTED_DOMAIN=
GOOGLE_SSO_DEFAULT_RETURN_URL=
GOOGLE_SSO_STATE_TTL_SECONDS=600
```

`AppConfigService.googleSso()` returns a typed object consumed only at composition for module options.

### `GoogleSsoModule`

Mirrors Mail module:

- `forRoot(options)` / `forRootAsync`
- Providers: options token, Redis state store, `GoogleOauthIdentityService` → `TOKENS.GoogleIdentityService` when enabled; stub when disabled
- No `process.env` inside adapters

### Google adapter

- Uses injected options (`clientId`, `clientSecret`, `redirectUri`)
- Exchanges code; reads `sub`, `email`, `email_verified` from ID token claims and/or userinfo
- Maps failures to `AuthenticationError('GOOGLE_SSO_TOKEN_EXCHANGE_FAILED', ...)` (or ValidationError where appropriate)
- Never logs code, tokens, or client secret

### Persistence

- `users.google_sub` `varchar` nullable + **unique** index (multiple NULLs allowed in PostgreSQL unique)
- `users.password_hash` drop `NOT NULL`
- Mapper + repository update/insert include `googleSub`
- Unique violation on `google_sub` → map to conflict if concurrent link races

## Interface and entrypoint changes

### `GoogleAuthController` (`@Controller('auth/google')`, `@ApiTags('Auth')`)

| Method | Path | Guards | Behavior |
| ------ | ---- | ------ | -------- |
| `GET ''` | `/v1/auth/google` | `RateLimiterGuard`, `@RateLimit({ keyPrefix: 'auth:google' })` | Start OAuth |
| `GET 'callback'` | `/v1/auth/google/callback` | same rate limit prefix `auth:google-callback` | Complete OAuth |

OpenAPI must document:

- Public (no bearer/cookie required)
- 302 responses for start (and conditional callback redirect)
- 200 `LoginResponseDto` for JSON success
- 400 / 401 / 503 + `ErrorEnvelopeDto`
- Cookie `g_oauth_state` on start; session cookie on success when session driver
- Stable error codes listed in operation descriptions

### `api.module.ts`

Add `GoogleAuthController` to `controllers` array (composition already exports use case / Google module).

### Worker / Cron / Migrations app

- No Google HTTP wiring
- Migrations entrypoint runs the new SQL when deployed (`db:migrate` / `db:migrate:prod` as usual — implementer generates migration; does not apply to unknown prod DBs without human approval)

## Database and migration changes

1. Update Drizzle `users.schema.ts`.
2. Run `npm run db:generate` to produce `0005_*.sql` + journal/snapshot meta.
3. Migration must be **additive / non-destructive**: `ALTER COLUMN password_hash DROP NOT NULL`; `ADD COLUMN google_sub ...`; unique index on `google_sub`.
4. Safe when Google SSO remains disabled (unused nullable column).
5. `npm run build:migrations` must succeed.

No new tables required for MVP.

## Security and authorization changes

- OAuth `state` CSRF (cookie + Redis one-time)
- Verified-email gate before auto-link / sign-in when resolving by email
- Resolve by `sub` first
- Secrets never in logs / OpenAPI examples / error details
- Rate limits on both Google routes (auth family defaults)
- Return URL allowlist = `CORS_ORIGINS` origins
- HTTPS redirect URIs documented for non-local; localhost allowed for development
- Public endpoints only; no authenticated link endpoint
- Optional hosted domain (`hd` query + post-exchange email domain check if `GOOGLE_SSO_HOSTED_DOMAIN` set): if configured, reject profiles whose email domain ≠ configured domain with `GOOGLE_SSO_HOSTED_DOMAIN_MISMATCH`

## Observability changes

- Structured logs: SSO start, success (`userId`), failure codes — never codes/tokens/secrets
- Distinct error codes: `GOOGLE_SSO_DISABLED`, `GOOGLE_SSO_INVALID_STATE`, `GOOGLE_SSO_EMAIL_UNVERIFIED`, `GOOGLE_SSO_TOKEN_EXCHANGE_FAILED`, `GOOGLE_SSO_HOSTED_DOMAIN_MISMATCH`, `INVALID_RETURN_URL`, `PASSWORD_NOT_SET`
- No new health IdP probe (out of scope)

## Implementation phases

### Phase 1 — Domain, contracts, schema types

- Paths: `libs/domain/src/entities/user.entity.ts`, `libs/domain/src/errors/domain-errors.ts`, `libs/contracts/src/auth/google-identity.service.ts`, `libs/contracts/src/repositories/user.repository.ts`, `libs/contracts/src/tokens.ts`, `libs/infrastructure/src/database/drizzle/schema/users.schema.ts`, `libs/infrastructure/src/mappers/user.mapper.ts`
- Symbols: `User.createFromGoogle`, `User.linkGoogleSubject`, `ServiceUnavailableError`, `IGoogleIdentityService`, `TOKENS.GoogleIdentityService`, `findByGoogleSub`
- AC: AC-03, AC-05 (types), AC-11
- Verify: `npx tsc -p libs/domain` / targeted unit compile or `npm run build` subset; domain unit tests if added

### Phase 2 — Migration + repository

- Paths: generate `libs/infrastructure/src/database/drizzle/migrations/0005_*.sql` (+ meta), `user-drizzle.repository.ts`
- Symbols: `UserDrizzleRepository.findByGoogleSub`; nullable persistence
- AC: AC-03, AC-10 (migration build)
- Verify: `npm run db:generate` (if schema hand-edited first), `npm run build:migrations`

### Phase 3 — Application use case + password null guards

- Paths: `complete-google-sign-in.usecase.ts` + spec; `login.usecase.ts` (+ spec); `change-password.usecase.ts` (+ spec)
- Symbols: `CompleteGoogleSignInUseCase.execute`
- AC: AC-02 (session factory call), AC-03, AC-04, AC-05, AC-13/FR-13 parity via outbox event
- Verify: `node node_modules/jest/bin/jest.js` on the new/updated unit specs (or `npm run test:unit -- --testPathPattern=google|login|change-password`)

### Phase 4 — Infrastructure Google module + adapter + state store

- Paths: `google-sso.module-options.ts`, `google-sso.module.ts`, `google-oauth-identity.service.ts` + spec, `redis-google-oauth-state.store.ts` + spec, env/config mapping files, `global-exception.filter.ts`, `package.json`
- Symbols: `GoogleSsoModule`, `GoogleOauthIdentityService`, `RedisGoogleOAuthStateStore`, `mapAppConfigToGoogleSsoOptions`
- AC: AC-01, AC-04 (verified email comes from adapter profile), AC-06 (state store), AC-07, AC-11, NFR-02/04
- Verify: adapter/state unit tests; config validation unit test if pattern exists for env schema

### Phase 5 — API controller, composition, OpenAPI

- Paths: `google-auth.controller.ts`, DTOs, `auth-application.module.ts` (+ spec), `api.module.ts`, `create-openapi-document.ts`, `openapi-contract.spec.ts`
- Symbols: `GoogleAuthController.start`, `GoogleAuthController.callback`
- AC: AC-01, AC-02, AC-06, AC-07, AC-08, AC-11
- Verify: OpenAPI drift test; module composition test with Google disabled

### Phase 6 — Docs + full verification gate

- Paths: `.env.example`, `EXAMPLES.md`, `README.md`
- AC: AC-09, AC-10
- Verify: full verification commands listed below

## Dependency and compatibility impact

- **New dependency:** `google-auth-library` (intentional lockfile change)
- **Backward compatible** when `GOOGLE_SSO_ENABLED=false` (default): existing auth behavior preserved after null-hash guards (only affects rows with null hash, which cannot exist until migration + Google create path)
- Migration is additive; password users unaffected
- Does not register a third auth driver; reuses `IAuthTokenService`
- Worker/Cron unchanged for Google HTTP
- TASK-003 routes remain; change-password gains `PASSWORD_NOT_SET` for Google-only users

## Targeted verification

```bash
npm run build:api
npm run build:migrations
node node_modules/jest/bin/jest.js libs/application/src/use-cases/auth/complete-google-sign-in.usecase.spec.ts
node node_modules/jest/bin/jest.js libs/application/src/use-cases/auth/change-password.usecase.spec.ts
node node_modules/jest/bin/jest.js libs/infrastructure/src/auth/google-oauth-identity.service.spec.ts
node node_modules/jest/bin/jest.js libs/infrastructure/src/auth/redis-google-oauth-state.store.spec.ts
node node_modules/jest/bin/jest.js apps/api/src/openapi/openapi-contract.spec.ts
node node_modules/jest/bin/jest.js apps/api/src/composition/auth-application.module.spec.ts
```

Add a focused login null-hash unit test (new or existing login spec) and run it.

For AC-02 both drivers: unit-test `CompleteGoogleSignInUseCase` with mocked `IAuthTokenService` asserting `createAuthSession` is called; plus one controller/integration-style test or dual unit tests that simulate jwt vs session token shapes returned by the mock (session includes `sessionId`). If full Nest session bootstrap is heavy, document one driver automated in module test and the other via use-case + cookie attach unit assertion on controller helper path.

## Full verification

```bash
npm run build
npm run build:api
npm run build:migrations
npm run lint
npm run test:unit
npm run test:module
```

Optional (infra available): `npm run start:api` with Google disabled must boot; with Google enabled + real credentials — manual smoke only (report unverified if secrets missing; not an automatic code defect).

Do **not** run production migrations or point at unknown databases.

## Acceptance criteria mapping

| AC | Phase(s) | Verification |
| -- | -------- | ------------ |
| AC-01 | 4, 5, 6 | Boot/module test with default env (no Google vars); existing auth unit/module tests pass |
| AC-02 | 3, 5 | Use-case asserts `createAuthSession`; controller attaches cookie when `sessionId` present; JWT mock returns tokens; both drivers evidenced per Architecture decision |
| AC-03 | 1–3 | Unit: first create persists `googleSub`; second `findByGoogleSub` returns same id |
| AC-04 | 3, 4 | Unit: verified email links existing user; unverified throws `GOOGLE_SSO_EMAIL_UNVERIFIED` |
| AC-05 | 3 | Unit: login with null `passwordHash` → `INVALID_CREDENTIALS` |
| AC-06 | 4, 5 | Unit/controller: bad/missing state → `GOOGLE_SSO_INVALID_STATE`; no use-case success |
| AC-07 | 5 | Controller/module: disabled → 503 `GOOGLE_SSO_DISABLED`; stub/port not calling Google |
| AC-08 | 5 | `openapi-contract.spec.ts` includes Google routes; decorators match runtime status/body/cookies |
| AC-09 | 6 | Inspect `.env.example` + EXAMPLES/README |
| AC-10 | 2, 6 | `build:api`, `lint`, unit/module tests, `build:migrations` |
| AC-11 | 1, 4, 5 | Static import review: no Google SDK in domain/application |

## Rollout strategy

1. Deploy migration `0005_*` first (nullable password + `google_sub`).
2. Deploy API with `GOOGLE_SSO_ENABLED=false` (default).
3. Create Google OAuth client; set redirect URI to `{API_PUBLIC_ORIGIN}/v1/auth/google/callback`.
4. Set `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI`; set `GOOGLE_SSO_ENABLED=true` per environment.
5. Ensure `CORS_ORIGINS` includes frontend origins used as `returnUrl`.
6. Password auth remains available throughout.

## Rollback strategy

1. Set `GOOGLE_SSO_ENABLED=false` — routes return 503; no Google calls; password auth unaffected.
2. Keep `google_sub` / nullable `password_hash` columns (do not drop without explicit human approval if data exists).
3. Full migration revert only with explicit human approval.

## Risks

| Risk | Mitigation |
| ---- | ---------- |
| TASK-003 uncommitted password work conflicts on `User`, mapper, login, composition, OpenAPI | Implement on top of current tree; coordinate null-hash guards with change/forgot/reset; do not revert TASK-003 files |
| JWT + browser redirect UX awkward | Frozen hybrid: JSON for JWT; 302+cookie only for session |
| Concurrent email register vs Google create race | Transaction + unique email; map `DuplicateRecordError` to conflict / retry-safe behavior in use case |
| `google-auth-library` API surface churn | Pin dependency; wrap behind port; mock in tests |
| Existing rows and NOT NULL drop | Additive migration; existing hashes remain non-null |
| bcrypt `compare` with null if guard missed | Explicit null checks in login/change-password before compare |
| State cookie on cross-site Google callback | SameSite=Lax works for top-level GET callbacks; document `none`+Secure only if product requires unusual setups (do not change global session cookie defaults here) |

## Open questions requiring human decision

None blocking for implementation if the planner freezes above are accepted.

Soft confirmations (defaults already frozen — override before approval if desired):

1. Confirm hybrid OQ-04 (JSON primary; session-only allowlisted 302) vs forcing 302 for both drivers with a one-time Redis exchange endpoint (would add `POST /auth/google/exchange`).
2. Confirm login null-hash uses `INVALID_CREDENTIALS` (frozen) vs a distinct public code like `PASSWORD_NOT_SET` on login too.
3. Confirm `google_sub` column on `users` (frozen) vs separate `user_identities(provider, subject)` table for future IdPs.
