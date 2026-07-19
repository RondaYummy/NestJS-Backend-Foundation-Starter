---
task_id: TASK-003
specification: docs/agent-tasks/TASK-003-auth-v1-parity.md
status: approved
owner: human-approval-required
---

# TASK-003 — Implementation plan

## Approved specification

`docs/agent-tasks/TASK-003-auth-v1-parity.md` (frontmatter `status: approved`).

Dependencies confirmed: TASK-002 catalog exists under `docs/migration/` (`HTTP_PARITY_MATRIX.md` §2 owns the eight `/v1/auth` rows; `D6_BREAKS.md` D6-01 owns password-hash sanitization). Soft dependency on TASK-004 remains for full profile surface; this plan ships only the minimal user-schema extensions approved in planning decision 4A.

## Current implementation

- Starter auth HTTP surface: `apps/api/src/controllers/auth.controller.ts` — `POST /auth/register|login|logout|refresh`, `GET /auth/me`. Response envelope `{ success, data }`. No `/v1/auth/*` routes exist under `apps/`.
- Composition: `apps/api/src/composition/auth-application.module.ts` wires `RegisterUseCase`, `LoginUseCase`, `LogoutUseCase`, `RefreshAuthSessionUseCase`, `GetCurrentUserUseCase`, `SessionCookieService`, `AuthModule.forRootAsync`.
- Use cases: `libs/application/src/use-cases/auth/{register,login,logout,refresh-auth-session,get-current-user}.usecase.ts`. Login is email-only; no change-password, admin login, phone login, or social login.
- Auth engine: `libs/infrastructure/src/auth/{auth.module.ts,jwt-auth-token.service.ts,redis-jwt-token-store.service.ts,session-auth-token.service.ts}`. `AUTH_DRIVER=jwt|session`. Refresh families live in Redis only (no PG `tokens` table) — matches NFR-01.
- `AuthGuard` (`apps/api/src/guards/auth.guard.ts`): Bearer first, else session cookie (`AUTH_SESSION_COOKIE_NAME`). No JWT access-cookie extractor.
- Cookies: `apps/api/src/auth/session-cookie.service.ts` sets session `sid` only when session driver returns `sessionId`. No JWT access/refresh cookie helper.
- CORS already `credentials: true` in `apps/api/src/main.ts`; origins from `CORS_ORIGINS`.
- User model: domain `libs/domain/src/entities/user.entity.ts` + Drizzle `libs/infrastructure/src/database/drizzle/schema/users.schema.ts` — `id`, `email`, `password_hash` NOT NULL, `roles` JSONB, `authVersion`. Missing phone, nullable password, `no_password`, profile stubs, `latest_logins`.
- Repository port `IUserRepository` (`libs/contracts/src/repositories/user.repository.ts`): `findById`, `findByEmail`, `insert`, `update`, `incrementAuthVersion` — no `findByPhone`, no admin-role finder.
- OpenAPI: `apps/api/src/openapi/create-openapi-document.ts` + drift test `apps/api/src/openapi/openapi-contract.spec.ts` cover `/auth/*` and bearer + session cookie schemes only.
- Rate limits: `RATE_LIMIT_AUTH_*` applied on starter auth routes via `RateLimiterGuard` / `@RateLimit`.
- Google OAuth: absent. Root `package.json` has `passport` / `passport-jwt` but not `@nestjs/passport` or `passport-google-oauth20`.
- Legacy reference (read-only): `OLD_BACKEND/src/v1/auth/{v1.auth.controller.ts,auth.service.ts,google.strategy.ts,jwt.strategy.ts}`.

## Architecture decision

1. **Single JWT engine + compatibility layer (D2):** Keep `AUTH_DRIVER=jwt` as the migration auth engine. Add a dedicated API compatibility controller under `/v1/auth` that reuses application use cases / `IAuthTokenService` and adds cookie transport + legacy request/response shapes. Do not add a third auth driver. Do not change `/auth/*` cookie behavior (decision 5C).

2. **Cookie transport:** New API-layer `JwtAuthCookieService` (sibling of `SessionCookieService`) sets/clears configurable `auth-cookie` / `refresh-cookie` (decision 1A) on `/v1/auth` login, admin login, Google redirect, refresh, and logout. Mode controlled by `AUTH_JWT_COOKIE_MODE=cookies|json|both` (default `both`, decision 2C): cookies always set on `/v1/auth` when mode is `cookies` or `both`; JSON token fields included when mode is `json` or `both` (for mobile). Refresh route remains cookie-primary per matrix (`GET /v1/auth/refresh`); when mode includes `json`, login responses may also expose tokens in body without changing refresh’s cookie contract.

3. **AuthGuard extraction order (decision 8A):** When `AUTH_DRIVER=jwt`, extract access token from configured access cookie first, then `Authorization: Bearer`. When `AUTH_DRIVER=session`, keep existing session-cookie path. Prefer extending the existing `AuthGuard` rather than a second guard so all JWT-protected routes (including future `/v1/*`) share one extractor.

4. **Google OAuth approach — choose Passport:** Add `@nestjs/passport` + `passport-google-oauth20` (+ `@types/passport-google-oauth20`). Implement `GoogleOAuthStrategy` (PassportStrategy) and Nest `AuthGuard('google')` on `GET /v1/auth/google` and `GET /v1/auth/google/redirect`, mirroring OLD.  
   **Why not raw `googleapis` / OAuth2 client:** Passport already matches the legacy controller shape, handles redirect/state/callback plumbing, and Nest Guard composition stays thin. A hand-rolled OAuth2 flow would reimplement CSRF state, callback parsing, and profile mapping with no architectural benefit for this parity slice. `passport` is already present in root dependencies.

5. **Minimal schema for auth parity (decision 4A):** One forward-only Drizzle migration alters `users` with fields required by FR-04/05 and the sanitized allowlist (decision 9A). TASK-004 owns remaining profile columns and `/v1/users` / `/v1/profile` routes.

6. **Dual error contracts (decision 7):** `/v1/auth/*` throws Nest `HttpException` (or thin adapters) with matrix status codes and Ukrainian messages where recorded. `/auth/*` continues to use domain errors → starter envelopes via `GlobalExceptionFilter`. Never Error-as-200.

7. **Password-change kill switch (decision 10A):** `ChangePasswordUseCase` updates hash, sets `noPassword=false`, calls `IUserRepository.incrementAuthVersion`, and revokes all refresh families for the user. Extend `IJwtTokenStore` / Redis store with a per-user family index (`auth:user-refresh-families:{userId}`) maintained on save/rotate/revoke so `revokeAllRefreshFamiliesForUser(userId)` is possible without scanning Redis.

8. **Sanitized presenter:** Shared `LegacyAuthUserPresenter` (API layer) maps domain user → allowlisted public object (`id`, `email`, `noPassword`, `photo`, `firstName`, `lastName`, `phone`, `role`, `status`, `verify`, …). `role` is a singular string derived from `roles[]` (`banned` > `admin` > `user`, lowercase to match OLD enum values). Never serialize `password` / `passwordHash` / tokens.

## Scope

- Env/config for JWT cookie names, cookie mode, Google OAuth, popup secret.
- Minimal `users` schema migration + domain/repo updates (decision 4A).
- JWT cookie helper + AuthGuard cookie-first access extraction (jwt driver).
- Application use cases: phone/email login adapter for v1, admin login + `latestLogins`, register extended fields for `/v1/auth/reg`, change-password with authVersion + family revoke, Google social login/register.
- API controller `V1AuthController` with all eight FR-04 routes, legacy bodies, rate limits, OpenAPI.
- Passport Google strategy + module wiring in API composition.
- OpenAPI schemes for access/refresh cookies; drift-test updates; both `/auth/*` and `/v1/auth/*` documented (decision 3A).
- Unit/module tests for new use cases, cookie helper, AuthGuard extractors, OpenAPI drift.
- Update `docs/migration/HTTP_PARITY_MATRIX.md` auth transport + §2 rows for target cookie names, D6 sanitization, and cookie mode (AC-06).
- `.env.example` documentation for new vars; document Google `postMessage` origin policy `'*'` and risk (decision 6A / FR-06).

## Out of scope

- Password restore, profile CRUD, `/v1/users`, `/v1/profile` (TASK-004).
- WebSocket handshake auth details (TASK-015) — cookie name freeze here is enough for later reuse.
- Changing `/auth/*` to set JWT cookies (decision 5C).
- Reintroducing PG `tokens` table (NFR-01); ETL skip of legacy `tokens` remains TASK-020.
- Session-driver cutover requirements (spec assumption: not required).
- Full profile field set beyond decision 4A stubs.
- Frontend rewrite.

## Files to create

- `apps/api/src/controllers/v1-auth.controller.ts` — `@Controller('v1/auth')`; eight FR-04 routes; rate limits; OpenAPI; cookie attach/clear; legacy status codes/messages.
- `apps/api/src/auth/jwt-auth-cookie.service.ts` — set/clear access + refresh httpOnly cookies; read refresh/access from request cookies; options from config (secure in production, sameSite, domain, path, maxAge from JWT TTLs).
- `apps/api/src/presenters/legacy-auth-user.presenter.ts` — D6-01 allowlist mapping (decision 9A).
- `apps/api/src/dto/v1-auth/v1-login.dto.ts` — `{ login: { email?: string; phone?: string }; password: string }`.
- `apps/api/src/dto/v1-auth/v1-admin-login.dto.ts` — `{ email, password, sessionObject }`.
- `apps/api/src/dto/v1-auth/v1-register.dto.ts` — `{ email, password, phone, photo?, firstName?, lastName? }`.
- `apps/api/src/dto/v1-auth/v1-change-password.dto.ts` — `{ currentPassword, newPassword }`.
- `apps/api/src/dto/v1-auth/v1-auth-response.dto.ts` — OpenAPI models for sanitized User, boolean refresh/logout, `"OK"` change-password, optional token fields when mode includes `json`.
- `apps/api/src/auth/google-oauth.strategy.ts` — Passport Google strategy reading config (not `process.env` directly inside validate beyond what Passport requires at construction via injected options).
- `apps/api/src/composition/google-oauth.module.ts` (or providers inside auth composition) — registers PassportModule + Google strategy when Google env configured.
- `libs/application/src/use-cases/auth/change-password.usecase.ts` (+ `.spec.ts`).
- `libs/application/src/use-cases/auth/admin-login.usecase.ts` (+ `.spec.ts`).
- `libs/application/src/use-cases/auth/social-login.usecase.ts` (+ `.spec.ts`).
- `libs/application/src/use-cases/auth/login-with-identifier.usecase.ts` (or extend login input) — email **or** phone (+ `.spec.ts`).
- Drizzle SQL migration under `libs/infrastructure/src/database/drizzle/migrations/` (next sequential file after existing `0004_*.sql`) — generated via `npm run db:generate` after schema edit.
- Unit/module specs: `apps/api/src/auth/jwt-auth-cookie.service.spec.ts`, `apps/api/src/guards/auth.guard.spec.ts` (cookie-first), extend `apps/api/src/openapi/openapi-contract.spec.ts`.

## Files to modify

- `libs/infrastructure/src/config/env.schema.ts` — add `AUTH_JWT_ACCESS_COOKIE_NAME` (default `auth-cookie`), `AUTH_JWT_REFRESH_COOKIE_NAME` (default `refresh-cookie`), `AUTH_JWT_COOKIE_MODE` (`cookies|json|both`, default `both`), reuse/extend cookie path/domain/sameSite for JWT cookies (either share session cookie path/domain/sameSite knobs or add `AUTH_JWT_COOKIE_*` mirrors — prefer sharing path/domain/sameSite with session knobs unless conflict; document choice in `.env.example`), `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_AUTH_CALLBACK_URI`, `POPUP_SECRET_KEY` (required when Google routes enabled, or validated when any Google env is set).
- `libs/infrastructure/src/config/infrastructure-config.module.ts` — map new env into config shape.
- `libs/infrastructure/src/config/app-config.service.ts` — expose jwt cookie + Google + popup config accessors.
- `.env.example` — document new variables and Google `postMessage` origin policy (`'*'`, risk note).
- `libs/domain/src/entities/user.entity.ts` — optional `phone`, nullable `passwordHash`, `noPassword`, profile stubs (`photo`, `firstName`, `lastName`), `status`, `verify`, `latestLogins`; factory updates for Google/`noPassword` users.
- `libs/infrastructure/src/database/drizzle/schema/users.schema.ts` — columns for decision 4A + allowlist stubs.
- `libs/infrastructure/src/mappers/user.mapper.ts` — map new columns.
- `libs/infrastructure/src/repositories/user-drizzle.repository.ts` — `findByPhone`, admin lookup (`roles` contains `admin`), `appendLatestLogin` / update helpers; support nullable password hash.
- `libs/contracts/src/repositories/user.repository.ts` — new methods: `findByPhone`, `findAdminByEmail` (or `findByEmail` + role check in use case), update signature notes for `latestLogins`.
- `libs/contracts/src/auth/jwt-token-store.service.ts` — `revokeAllRefreshFamiliesForUser(userId: string): Promise<void>`; ensure save/rotate maintain user→family index.
- `libs/infrastructure/src/auth/redis-jwt-token-store.service.ts` (+ `.spec.ts` if present / new) — implement user-family index + revoke-all.
- `libs/infrastructure/src/auth/jwt-auth-token.service.ts` (+ spec) — expose revoke-all via `IAuthTokenService` if needed (add `revokeAllSessionsForUser(userId)` on token service contract) for change-password.
- `libs/contracts/src/auth/auth-token.service.ts` — add `revokeAllSessionsForUser(userId: string): Promise<void>` (jwt: revoke all families; session: revoke user sessions if applicable, or no-op with documented jwt-only semantics for this task).
- `libs/application/src/use-cases/auth/register.usecase.ts` — accept optional phone/names/photo for v1 reg path (or add `RegisterLegacyUserUseCase` if keeping starter register DTO strict); keep Outbox welcome email.
- `apps/api/src/guards/auth.guard.ts` — cookie-first JWT access extraction (decision 8A).
- `apps/api/src/composition/auth-application.module.ts` — register new use cases, cookie service, Google module providers.
- `apps/api/src/api.module.ts` — register `V1AuthController`.
- `apps/api/src/openapi/create-openapi-document.ts` — add cookie auth schemes for access + refresh cookie names; document Bearer + cookies; include v1 DTO extraModels; update description to mention dual `/auth` and `/v1/auth` surfaces.
- `apps/api/src/main.ts` — pass access cookie name(s) into `createOpenApiDocument` as needed.
- `apps/api/src/openapi/openapi-contract.spec.ts` — assert all eight `/v1/auth` operations, cookie schemes, security on guarded routes, both `/auth/*` and `/v1/auth/*` present.
- `package.json` / `package-lock.json` — add `@nestjs/passport`, `passport-google-oauth20`, `@types/passport-google-oauth20` (intentional dependency change).
- `docs/migration/HTTP_PARITY_MATRIX.md` — freeze target cookie names; note `AUTH_JWT_COOKIE_MODE`; update §2 success shapes for D6-01 sanitized bodies and optional JSON tokens; document Google `postMessage` targetOrigin `'*'` + risk (AC-06).
- `docs/migration/README.md` — remove “target cookie names deferred to TASK-003” note; point to frozen names.
- `EXAMPLES.md` and/or `README.md` auth sections — brief `/v1/auth` + cookie mode notes (canonical docs aligned with OpenAPI; keep minimal).

## Files to delete

- None.

## Domain changes

- Extend `User` entity props for decision 4A fields; support `User.create` / social create with `passwordHash: null` + `noPassword: true`.
- Domain methods: `changePassword(newHash)`, `recordLatestLogin(sessionObject)` (cap at 5 entries like OLD), `clearNoPasswordOnPasswordSet`.
- Keep `roles: string[]` as source of truth; no singular `role` column in DB (presenter derives `role`).
- Do not put Nest/Passport types in domain.

## Application changes

- `LoginWithIdentifierUseCase` (or extended `LoginUseCase`): resolve by email or phone; compare password; reject missing password / `noPassword` users with legacy-compatible failure mapping at controller; create auth session via `IAuthTokenService`.
- `AdminLoginUseCase`: verify admin role + password; create session; append `sessionObject` to `latestLogins` (max 5).
- `RegisterUseCase` extension or `RegisterLegacyUserUseCase`: email+password+phone (+ optional names/photo); Outbox `UserRegisteredEvent`; return user for presenter (no auto-login cookies — match OLD `/reg`).
- `ChangePasswordUseCase`: verify current password; hash new; update user; `incrementAuthVersion`; `revokeAllSessionsForUser`.
- `SocialLoginUseCase`: find-by-email or register Google profile (`noPassword`); skip cookie issuance when role is `banned` (controller still returns sanitized postMessage payload); create auth session otherwise.
- Reuse `RefreshAuthSessionUseCase` + `LogoutUseCase` from v1 controller with cookie-sourced tokens.
- Controllers map application/domain failures to legacy HTTP errors for `/v1/auth` only.

## Contract and DI changes

- `IUserRepository`: `findByPhone`; keep `incrementAuthVersion`; ensure `update` persists new fields.
- `IJwtTokenStore`: user→family index + `revokeAllRefreshFamiliesForUser`.
- `IAuthTokenService`: `revokeAllSessionsForUser`.
- Tokens: continue using existing `TOKENS.*`; no new global tokens required unless Google options symbol is introduced (`GOOGLE_OAUTH_OPTIONS` optional).
- `AuthApplicationCompositionModule`: provider factories for new use cases; export what `V1AuthController` needs.
- Google: register only when Google env is complete; fail fast at bootstrap if routes are always registered but secrets missing — prefer **require Google env in non-test** when `V1AuthController` is mounted (document in `.env.example`). Local/dev must set placeholders or disable via explicit `GOOGLE_OAUTH_ENABLED=false` if such a flag is added; if no enable flag, require the four Google-related vars whenever API boots (simplest). **Plan default:** add `GOOGLE_OAUTH_ENABLED` boolean default `false`; when `true`, require client id/secret/callback/popup secret. Routes return 503/501 when disabled — **prefer always registering routes and returning 503 with clear message when disabled** so OpenAPI stays complete (AC-01). Human-approved default for this plan: `GOOGLE_OAUTH_ENABLED` default `false`; enabled in environments that need AC-04.

## Infrastructure changes

- Drizzle schema + generated migration for `users` alterations.
- `RedisJwtTokenStore` family index maintenance.
- `JwtAuthTokenService.revokeAllSessionsForUser` implementation.
- Config/env schema expansions listed above.
- Password hasher already supports bcrypt; Google users skip hash until password set.
- No Worker/Cron changes unless register Outbox path already covered (reuse existing).

## Interface and entrypoint changes

- `V1AuthController` routes (FR-04):
  - `POST /v1/auth/login` — public; rate limit `auth:v1:login`; set cookies; return sanitized User (± tokens per mode).
  - `POST /v1/auth/login/admin` — public; rate limit `auth:v1:login:admin`; cookies; sanitized admin User; record `latestLogins`.
  - `POST /v1/auth/reg` — public; rate limit `auth:v1:reg`; sanitized created User; Outbox welcome.
  - `GET /v1/auth/refresh` — public; rate limit `auth:v1:refresh`; read refresh cookie; rotate; set cookies; body `true`.
  - `POST /v1/auth/log-out` — `AuthGuard` + roles `user`|`admin`; clear cookies; revoke; body `true`; set `Authorization: null` response header for parity.
  - `POST /v1/auth/change-password` — `AuthGuard` + roles; body `{ currentPassword, newPassword }`; return `"OK"`.
  - `GET /v1/auth/google` — Google OAuth guard; 302.
  - `GET /v1/auth/google/redirect` — Google OAuth guard; set cookies unless banned; HTML script `postMessage({ source: POPUP_SECRET_KEY, …sanitizedUser, isSocialConnect: true }, '*')` then close (decision 6A); CSP/COOP headers as OLD.
- OpenAPI: `@ApiTags('Auth v1')` (or keep `Auth` with clear operation summaries); `@ApiCookieAuth` for access/refresh; `@ApiBearerAuth` on guarded routes; document both cookie and Bearer.
- Do not alter starter `/auth/*` response envelope or cookie behavior.

### OpenAPI / drift checklist (NFR-03, AC-01, AC-05)

| Route                           | Decorator / schema files                                                                       | Drift assertions                                                                                      |
| ------------------------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `POST /v1/auth/login`           | `v1-login.dto.ts`, `v1-auth-response.dto.ts`, controller `@ApiBody` / `@ApiOkResponse`         | path+method exists; 200 schema; Set-Cookie described; 404 error documented                            |
| `POST /v1/auth/login/admin`     | `v1-admin-login.dto.ts`, response DTO                                                          | same                                                                                                  |
| `POST /v1/auth/reg`             | `v1-register.dto.ts`, response DTO                                                             | 201/200 per implemented status (match matrix `Created User`); D6 no password field in schema          |
| `GET /v1/auth/refresh`          | boolean response; cookie auth                                                                  | 200 `true`; 401 Invalid refresh                                                                       |
| `POST /v1/auth/log-out`         | boolean; bearer+cookie security                                                                | 200 `true`; 404 cookies missing                                                                       |
| `POST /v1/auth/change-password` | `v1-change-password.dto.ts`                                                                    | 200 `"OK"`; 400/404 legacy messages                                                                   |
| `GET /v1/auth/google`           | operation only (302)                                                                           | documented                                                                                            |
| `GET /v1/auth/google/redirect`  | string/HTML response description; postMessage contract in description                          | documented; notes `targetOrigin: '*'` risk                                                            |
| Global                          | `create-openapi-document.ts` cookie schemes `authCookie` + `refreshCookie` (names from config) | `openapi-contract.spec.ts` includes all eight routes + schemes; `/auth/*` still present (decision 3A) |

## Database and migration changes

- Alter `users`:
  - `phone` `varchar` unique nullable
  - `password_hash` nullable
  - `no_password` boolean not null default `false`
  - `photo` varchar/text nullable
  - `first_name` varchar nullable
  - `last_name` varchar nullable
  - `status` varchar not null default `'active'`
  - `verify` boolean not null default `false`
  - `latest_logins` jsonb not null default `'[]'`
- Forward-only Drizzle migration; no TypeORM; no `tokens` table.
- Existing rows: `password_hash` remains populated; `no_password=false`.
- Rollback of schema in production is forward-fix only (see Rollback).

## Security and authorization changes

- D6-01: presenter allowlist; strip secrets from JSON and Google `postMessage` payload.
- Cookie flags: `httpOnly`, `secure` in production, `sameSite` from config (default `lax`), configurable domain/path.
- OAuth: Passport state; `GOOGLE_OAUTH_ENABLED` gate; document `postMessage(..., '*')` risk (FR-06 / decision 6A).
- Admin login: require `admin` role.
- Guarded routes: `AuthGuard` + `RolesGuard` with `user`/`admin`.
- Change-password: authVersion bump + revoke all refresh families (decision 10A); access tokens fail subsequent `verifyAccessToken` via `resolveAccessUser` authVersion mismatch.
- Rate limit all sensitive `/v1/auth` endpoints consistently with starter auth limits (`RATE_LIMIT_AUTH_*` defaults).
- Log auth failures without passwords/tokens.

## Observability changes

- Use existing `AppLogger` on v1 auth failures (no secrets).
- No new metrics backend required; optional structured fields: `route`, `reason` (`invalid_credentials`, `invalid_refresh`, `oauth_disabled`).

## Implementation phases

### Phase 1 — Config, schema, domain, repository

- **Paths:** `libs/infrastructure/src/config/env.schema.ts`, `infrastructure-config.module.ts`, `app-config.service.ts`, `.env.example`; `libs/infrastructure/src/database/drizzle/schema/users.schema.ts`; new migration SQL under `libs/infrastructure/src/database/drizzle/migrations/`; `libs/domain/src/entities/user.entity.ts`; `libs/infrastructure/src/mappers/user.mapper.ts`; `libs/infrastructure/src/repositories/user-drizzle.repository.ts`; `libs/contracts/src/repositories/user.repository.ts`.
- **Symbols:** new env keys (cookie names/mode, Google, popup, `GOOGLE_OAUTH_ENABLED`); `User` props/factories; `findByPhone`; persist `latestLogins` / profile stubs.
- **AC:** AC-02 (schema supports omission of secrets), AC-04 (Google user persistence), AC-05 (build/migrations compile).
- **Verify:** `npm run build:migrations` (or `npm run build` if required); unit tests for `User` create/social/password helpers; repository unit/module tests if patterns exist.

### Phase 2 — JWT store revoke-all + AuthGuard cookie-first + cookie service

- **Paths:** `libs/contracts/src/auth/jwt-token-store.service.ts`, `auth-token.service.ts`; `libs/infrastructure/src/auth/redis-jwt-token-store.service.ts`, `jwt-auth-token.service.ts` (+ specs); `apps/api/src/auth/jwt-auth-cookie.service.ts` (+ spec); `apps/api/src/guards/auth.guard.ts` (+ spec).
- **Symbols:** `revokeAllRefreshFamiliesForUser`, `revokeAllSessionsForUser`; `JwtAuthCookieService.attach|clear|getAccessToken|getRefreshToken`; `AuthGuard.extractTokenOrSessionId` cookie-first for jwt.
- **AC:** AC-03, AC-05.
- **Verify:** `npm run test:unit --` filtered to auth store/guard/cookie specs; `npm run build:api`.

### Phase 3 — Application use cases

- **Paths:** `libs/application/src/use-cases/auth/login-with-identifier.usecase.ts`, `admin-login.usecase.ts`, `social-login.usecase.ts`, `change-password.usecase.ts`, register extension or `register-legacy-user.usecase.ts` (+ all `*.spec.ts`); wire in `apps/api/src/composition/auth-application.module.ts`.
- **Symbols:** use cases listed; Outbox on reg; admin `latestLogins` cap 5; change-password kill switch.
- **AC:** AC-02, AC-04, AC-05.
- **Verify:** `npm run test:unit` for new/updated auth use-case specs.

### Phase 4 — `/v1/auth` HTTP + Google OAuth + OpenAPI

- **Paths:** `apps/api/src/controllers/v1-auth.controller.ts`; DTOs under `apps/api/src/dto/v1-auth/`; `apps/api/src/presenters/legacy-auth-user.presenter.ts`; `apps/api/src/auth/google-oauth.strategy.ts`; Google composition module; `apps/api/src/api.module.ts`; `apps/api/src/openapi/create-openapi-document.ts`; `apps/api/src/main.ts`; `apps/api/src/openapi/openapi-contract.spec.ts`; `package.json` / `package-lock.json`.
- **Symbols:** `V1AuthController` eight handlers; Passport `GoogleOAuthStrategy`; OpenAPI cookie schemes; legacy error mapping.
- **AC:** AC-01, AC-02, AC-03, AC-04, AC-05.
- **Verify:** `npm run test:module` (include OpenAPI drift); `npm run build:api`; `npm run lint`.

### Phase 5 — Parity docs + EXAMPLES/README notes

- **Paths:** `docs/migration/HTTP_PARITY_MATRIX.md` (auth transport + §2); `docs/migration/README.md`; minimal `EXAMPLES.md` / `README.md` auth notes for `/v1/auth` and cookie mode; ensure FR-06 origin policy documented next to Google redirect description.
- **Symbols:** documentation only — target cookie names frozen; D6 sanitized success examples; `AUTH_JWT_COOKIE_MODE`; `postMessage` `'*'` risk.
- **AC:** AC-06 (and documentation half of FR-06).
- **Verify:** manual inspection that §2 rows and transport section match implemented behavior; no stale “deferred to TASK-003” wording.

### Phase 6 — Full verification gate

- **Paths:** none new; run commands across changed entrypoints.
- **Symbols:** n/a.
- **AC:** AC-05 (full), confidence for AC-01…04 via tests.
- **Verify:** see Full verification below; record command/result/conclusion in implementer report.

## Dependency and compatibility impact

- **New npm deps:** `@nestjs/passport`, `passport-google-oauth20`, `@types/passport-google-oauth20` (dev). `passport` already present.
- **Backward compatible:** starter `/auth/*` unchanged in cookie behavior and error envelopes (decisions 3A, 5C, 7).
- **Breaking for consumers of raw User with `password`:** intentional D6-01.
- **Env:** new required vars when `GOOGLE_OAUTH_ENABLED=true`; cookie mode default `both` is additive.
- **DB:** nullable `password_hash` — ensure application never treats null hash as empty-string match.
- **FE:** legacy cookie names preserved; dual documentation of `/auth` and `/v1/auth`.

## Targeted verification

```bash
npm run build:api
npm run build:migrations
npm run test:unit -- --testPathPattern=auth
npm run test:module -- --testPathPattern=openapi-contract
npm run lint
```

Inspect OpenAPI JSON (docs enabled) for eight `/v1/auth` paths and cookie security schemes. Spot-check cookie Set-Cookie headers with a local API smoke if Redis/Postgres available (infrastructure absence ≠ code defect).

## Full verification

```bash
npm run build
npm run lint
npm run test:unit
npm run test:module
```

If Worker/Cron untouched, `build:worker` / `build:cron` optional but `npm run build` covers shared libs. Do not run production migrations. Record each command result in the implementer report.

## Acceptance criteria mapping

| AC    | Phase(s) | Verification                                                                                                                             |
| ----- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| AC-01 | 4, 6     | OpenAPI drift test lists all eight `/v1/auth` routes; controller inspection; `npm run test:module -- --testPathPattern=openapi-contract` |
| AC-02 | 1, 3, 4  | Presenter unit tests; response DTO schemas omit password; login/reg/google tests assert no `password`/`passwordHash`                     |
| AC-03 | 2, 4, 6  | Cookie service unit tests; CORS already credentials; smoke Set-Cookie when infra up; mode `both`/`cookies`                               |
| AC-04 | 1, 3, 4  | Social-login unit tests; Google strategy module test; enable OAuth in test config or mock Passport guard                                 |
| AC-05 | 1–4, 6   | `npm run build`, `lint`, `test:unit`, `test:module` (incl. OpenAPI drift)                                                                |
| AC-06 | 5        | Diff review of `docs/migration/HTTP_PARITY_MATRIX.md` + `README.md` auth transport updates                                               |

## Rollout strategy

1. Ship schema migration via `apps/migrations` one-shot job in staging first.
2. Deploy API with `AUTH_DRIVER=jwt`, cookie defaults `auth-cookie`/`refresh-cookie`, `AUTH_JWT_COOKIE_MODE=both`.
3. Enable Google only when `GOOGLE_OAUTH_ENABLED=true` and secrets configured; verify popup flow against staging FE.
4. Point FE at `/v1/auth` incrementally; keep `/auth/*` available.
5. Prefer completing this slice before production exposure of `/v1` (per spec).

## Rollback strategy

- Revert API deploy; `/v1/auth` disappears; `/auth/*` remains.
- Do not roll back Drizzle migration in place; if needed, deploy forward-fix migration neutralizing unused columns only with explicit human approval.
- No TypeORM hybrid; no dual write to legacy `tokens` table.
- Disable Google via `GOOGLE_OAUTH_ENABLED=false` without full rollback.

## Risks

- **Schema vs TASK-004 overlap:** minimal columns may need non-conflicting names/types when TASK-004 expands profile — coordinate column names with ENTITIES_ETL (`phone`, `latestLogins`, etc.).
- **`postMessage(..., '*')`:** intentional legacy risk (decision 6A); document clearly.
- **AuthGuard cookie-first globally:** may surprise Bearer+cookie clients of starter `/auth/me` if both are sent and cookies are stale — mitigate by only reading JWT access cookie when jwt driver is active and cookie present; document precedence.
- **Revoke-all family index:** older families created before deploy lack index entries; authVersion bump still invalidates refresh/access — treat index as best-effort complement, not sole kill switch.
- **Google disabled by default:** AC-04 needs either enabled staging secrets or mocked Passport in tests; call out in implementer report if live Google smoke skipped for missing secrets.
- **Legacy 404 credential failures:** unusual vs starter 400; required for FE parity on `/v1/auth` only.
- **Nullable password + bcrypt compare:** must short-circuit safely for social users.

## Open questions requiring human decision

All planning-gate items resolved on **2026-07-19** (human answered in planning chat):

1. **Cookie names** — **Resolved (A):** defaults `auth-cookie` / `refresh-cookie`, env-configurable.
2. **Refresh/access in JSON** — **Resolved (C):** `AUTH_JWT_COOKIE_MODE=cookies|json|both`, default `both`.
3. **Document `/auth/*` beside `/v1/auth/*`** — **Resolved (A):** both publicly documented in OpenAPI.
4. **Schema vs TASK-004** — **Resolved (A):** minimal TASK-003 migration (`phone`, nullable `password_hash`, `no_password`, profile stubs for sanitized responses, `latest_logins` JSONB); TASK-004 owns full profile later.
5. **Cookie enablement** — **Resolved (C):** always set JWT cookies on `/v1/auth`; do not change `/auth/*` cookie behavior.
6. **Google `postMessage` targetOrigin** — **Resolved (A):** keep `'*'`; document origin policy and risk (FR-06).
7. **Error contracts** — **Resolved (C semantics):** `/v1/auth/*` preserves legacy status/messages per matrix; `/auth/*` keeps starter envelopes; never Error-as-200.
8. **Access-token extraction order** — **Resolved (A):** cookie first, then Bearer when jwt driver active.
9. **Sanitized User allowlist** — **Resolved (A):** OLD matrix fields minus secrets; null/omit for fields beyond decision 4 stubs.
10. **Change-password side effects** — **Resolved (A):** bump `authVersion` and revoke refresh families (immediate session kill).

**Residual open items:** None blocking plan approval. Implementer may choose shared vs dedicated env knobs for JWT cookie path/domain/sameSite (called out under Files to modify) without further human gate if they reuse existing `AUTH_SESSION_COOKIE_PATH|DOMAIN|SAME_SITE` for JWT cookies and document that in `.env.example`.
