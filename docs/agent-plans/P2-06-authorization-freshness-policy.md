---
issue_id: P2-06
status: approved
owner: human-approval-required
---

# P2-06 — Do not authorize user based only on stale token/session claims

## Source issue

`docs/agent-backlog/NESTJS_STARTER_KIT_REQUIRED_FIXES.md` — section **P2-06. Не авторизовувати користувача лише за stale token/session claims**.

Related verification scenario: backlog **V-11** — “Role revoke/user disable/authVersion/session invalidation”.

**Investigation (2026-06-21, branch `main`):** defect confirmed — JWT access verification and refresh trust embedded claims; session driver stores full `CurrentUser` snapshot in Redis. User schema has no `authVersion`, `disabled`, or equivalent revocation field. Issue is **not stale**.

## Current behavior

### JWT driver (`AUTH_DRIVER=jwt`, default)

1. **`JwtAuthTokenService.verifyAccessToken`** verifies signature/expiry, checks `type === 'access'` and `jti`, checks Redis access-token blacklist, then returns `CurrentUser` built **only from JWT payload** (`id`, `email`, `roles`) — no DB lookup.

```87:103:libs/infrastructure/src/auth/jwt-auth-token.service.ts
  async verifyAccessToken(token: string): Promise<CurrentUser | null> {
    // ...
      const revoked = await this.tokenStore.isAccessTokenRevoked(payload.jti);
      if (revoked) {
        return null;
      }
      return this.toCurrentUser(payload);
```

2. **`JwtAuthTokenService.refreshAuthSession`** verifies refresh JWT, builds user via `toCurrentUser(refreshPayload)` (same stale claims/roles), issues new access+refresh pair embedding those values, and performs Redis rotation. Rotation works; authorization data is copied forward.

```124:126:libs/infrastructure/src/auth/jwt-auth-token.service.ts
    const user = this.toCurrentUser(payload);
    const nextPair = await this.issueTokenPair(user, payload.familyId);
```

3. **Login** is the only token-issuance path that reads DB today (`LoginUseCase` → `IUserRepository.findByEmail` → fresh roles).

### Session driver (`AUTH_DRIVER=session`)

1. **`RedisSessionStore.create`** stores full serialized `CurrentUser` JSON in Redis (`sessions:<sessionId>`).
2. **`SessionAuthTokenService.verifyAccessToken`** returns that snapshot as-is — no DB lookup, no version check.
3. PG table `sessions` exists in migrations but is **unused** by auth; Redis is the live session store.

### Guard / authorization chain

```text
HTTP request
  → AuthGuard.canActivate()
      → IAuthTokenService.verifyAccessToken(tokenOrSessionId)
      → request.user = CurrentUser from token/session snapshot
  → RolesGuard (if @Roles() applied)
      → request.user.roles.includes(requiredRole)   // token snapshot, not DB
  → Controller handler / @CurrentUser() decorator
```

`AuthGuard` is used on `GET /auth/me` only (no global guard). `RolesGuard` and `@Roles()` exist but **no controller currently applies them**.

### Split behavior on `/auth/me`

- `AuthGuard` authorizes using **stale token claims**.
- `GetCurrentUserUseCase` then loads **fresh roles from DB** for the response body.
- A revoked role still passes the guard until token/session expires.

### User model — no revocation primitives

```3:10:libs/infrastructure/src/database/drizzle/schema/users.schema.ts
export const users = pgTable('users', {
  id: uuid('id').primaryKey(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  passwordHash: varchar('password_hash', { length: 255 }).notNull(),
  roles: jsonb('roles').$type<string[]>().notNull().default(['user']),
  // no disabled, authVersion, tokenVersion
```

- `User` entity (`libs/domain/src/entities/user.entity.ts`) — same: no `disabled`, no `authVersion`.
- `IUserRepository.update()` exists but **no use case/API** changes roles, disables users, or bumps a version.
- Register/login/logout/refresh/get-current-user are the only auth use cases.

### What revocation exists today

| Mechanism                                                | Scope                                  | Freshness                                        |
| -------------------------------------------------------- | -------------------------------------- | ------------------------------------------------ |
| JWT access blacklist (`auth:revoked-access-token:<jti>`) | Explicit logout of specific access jti | Per-token, logout-triggered only                 |
| Refresh family revoke (`auth:refresh-family:<familyId>`) | Logout / replay detection              | Ends refresh chain, not stale roles within chain |
| Session delete                                           | Logout with sessionId                  | Single session only                              |
| Role/user state change                                   | **None**                               | N/A                                              |

**Maximum revocation delay today (JWT):** up to `JWT_EXPIRES_IN` (default **15m**) for access tokens; up to `JWT_REFRESH_EXPIRES_IN` (default **7d**) if client keeps refreshing with stale refresh claims.

**Session driver:** up to `AUTH_SESSION_TTL_SECONDS` (default **604800s / 7d**).

## Confirmed root cause

Authorization identity (`id`, `email`, `roles`) is **embedded at login** into JWT claims or Redis session JSON and **trusted on every subsequent request** without re-validating against the user record.

Refresh **propagates** stale claims into new tokens instead of reloading from `IUserRepository`.

There is no `authVersion`/`tokenVersion`/`disabled` field to invalidate outstanding credentials when roles or account state change.

## Dependency/runtime flow

```text
Login (fresh)
  Client → LoginUseCase.findByEmail → IUserRepository
  → IAuthTokenService.createAuthSession(CurrentUser)
  → JwtAuthTokenService.issueTokenPair / RedisSessionStore.create

Protected request (stale)
  Client → AuthGuard → IAuthTokenService.verifyAccessToken
  → Redis blacklist / session get
  → CurrentUser from claims/snapshot
  (no DB call)

Refresh (stale propagated)
  Client → RefreshAuthSessionUseCase → IAuthTokenService.refreshAuthSession
  → JwtAuthTokenService.toCurrentUser(refreshPayload)
  → issueTokenPair with same stale roles
  (RefreshAuthSessionUseCase injects only IAuthTokenService — no repository)
```

### DI wiring (relevant)

| Symbol                    | Provider                                           | Module                                                      |
| ------------------------- | -------------------------------------------------- | ----------------------------------------------------------- |
| `TOKENS.AuthTokenService` | `JwtAuthTokenService` or `SessionAuthTokenService` | `AuthModule` (`buildAsyncDriverProviders`)                  |
| `TOKENS.JwtTokenStore`    | `RedisJwtTokenStore`                               | JWT branch only                                             |
| `TOKENS.SessionStore`     | `RedisSessionStore`                                | Session branch only                                         |
| `TOKENS.UserRepository`   | `UserDrizzleRepository`                            | `RepositoriesModule` via `AuthApplicationCompositionModule` |

`RefreshAuthSessionUseCase` factory in `apps/api/src/composition/auth-application.module.ts` injects **only** `TOKENS.AuthTokenService`. `JwtAuthTokenService` constructor has no user repository port.

## Goal

Define and implement an **authorization freshness policy** so role removal, user disable/delete, or security reset takes effect within documented bounds — not only at token/session natural expiration.

**Minimum (per backlog):** reload current user/roles from repository during refresh; add `authVersion` (or equivalent); align session storage; document maximum revocation delay.

## Scope

1. Add `auth_version` column to `users` table (migration) and thread through domain, mapper, repository, and `CurrentUser`.
2. Embed `authVersion` in JWT access and refresh claims at issuance.
3. **Refresh path (required):** reload user from `IUserRepository`, reject stale/missing/disabled users, issue tokens with fresh `email` and `roles`.
4. **Session driver parity:** stop trusting long-lived role snapshot; validate session against current user state (see implementation steps).
5. Add repository helper to increment `authVersion` for downstream consumers (document contract; no admin API required).
6. **Optional access-time freshness** for high-risk endpoints (mechanism per human decision — see open questions).
7. Document **maximum revocation delay** in README §16.1.
8. Unit tests covering **V-11** scenarios (refresh rejects stale roles/version; session rejects stale version).

## Out of scope

- Admin API or use case for role changes / user disable (unless human expands scope).
- Global `AuthGuard` on all routes.
- PG `sessions` table integration (unused today).
- Revoking all Redis refresh families for a user on `authVersion` bump (needs new token-store API keyed by `userId` — defer unless human approves).
- Exactly-once or synchronous invalidation of every outstanding access token on role change (would require per-request DB check or token store scan).
- Changing JWT rotation/blacklist mechanics (already correct for replay/logout).

## Files to create

| Path                                                                          | Responsibility                                                   |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `libs/infrastructure/src/database/drizzle/migrations/0004_<slug>.sql`         | Add `auth_version integer NOT NULL DEFAULT 0` to `users`         |
| `libs/infrastructure/src/database/drizzle/migrations/meta/0004_snapshot.json` | Drizzle migration metadata (via `npm run db:generate`)           |
| `libs/infrastructure/src/auth/jwt-auth-token.service.spec.ts`                 | Unit tests: claim embedding, refresh rejects stale `authVersion` |
| `libs/infrastructure/src/auth/session-auth-token.service.spec.ts`             | Unit tests: session verify rejects stale version / missing user  |
| `libs/application/src/use-cases/auth/refresh-auth-session.usecase.spec.ts`    | Unit tests: orchestration reloads user from repository           |

## Files to modify

| Path                                                                  | Symbol(s)                                                                                                | Change                                                                                |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `libs/infrastructure/src/database/drizzle/schema/users.schema.ts`     | `users`                                                                                                  | Add `authVersion` column                                                              |
| `libs/domain/src/entities/user.entity.ts`                             | `User`, `UserProps`                                                                                      | Add `authVersion` getter; optional `incrementAuthVersion()` domain method             |
| `libs/infrastructure/src/mappers/user.mapper.ts`                      | `UserMapper.toDomain`, `toPersistence`                                                                   | Map `authVersion`                                                                     |
| `libs/infrastructure/src/repositories/user-drizzle.repository.ts`     | `UserDrizzleRepository`                                                                                  | Read/write `authVersion`; add `incrementAuthVersion(userId)` if on repository port    |
| `libs/contracts/src/auth/current-user.ts`                             | `CurrentUser`                                                                                            | Add `authVersion: number`                                                             |
| `libs/contracts/src/repositories/user.repository.ts`                  | `IUserRepository`                                                                                        | Add `incrementAuthVersion(userId, trx?)` (or document via `update` only)              |
| `libs/contracts/src/auth/auth-token.service.ts`                       | `IAuthTokenService`                                                                                      | Extend with refresh-parse/rotate split (see Contract changes)                         |
| `libs/infrastructure/src/auth/jwt-auth-token.service.ts`              | `AccessTokenPayload`, `RefreshTokenPayload`, `issueTokenPair`, `refreshAuthSession`, `verifyAccessToken` | Embed/check `authVersion`; split refresh into parse + rotate                          |
| `libs/infrastructure/src/auth/session-auth-token.service.ts`          | `verifyAccessToken`, `createAuthSession`                                                                 | Resolve user from DB or validate version                                              |
| `libs/infrastructure/src/auth/redis-session-store.service.ts`         | `create`, `get`                                                                                          | Store `{ userId, authVersion }` instead of full role snapshot (or add resolver layer) |
| `libs/contracts/src/auth/session-store.service.ts`                    | `ISessionStore`                                                                                          | Adjust stored record type if session payload shape changes                            |
| `libs/application/src/use-cases/auth/refresh-auth-session.usecase.ts` | `RefreshAuthSessionUseCase`                                                                              | Inject `IUserRepository`; orchestrate fresh user load before rotation                 |
| `libs/application/src/use-cases/auth/login.usecase.ts`                | `LoginUseCase.execute`                                                                                   | Include `authVersion` in `createAuthSession` input                                    |
| `apps/api/src/composition/auth-application.module.ts`                 | `RefreshAuthSessionUseCase` factory                                                                      | Add `TOKENS.UserRepository` to inject array                                           |
| `apps/api/src/guards/roles.guard.ts`                                  | `RolesGuard.canActivate`                                                                                 | Optional: DB freshness check when human approves high-risk policy                     |
| `README.md`                                                           | §16.1                                                                                                    | Document freshness policy and maximum revocation delay                                |

## Files to delete

None.

## Contract and DI changes

### Recommended approach: application-layer refresh orchestration (preserves `AuthModule` portability)

Do **not** inject `IUserRepository` into `AuthModule` / `JwtAuthTokenService`. Keep `AuthModule` DB-agnostic.

Extend `IAuthTokenService` with a two-step refresh contract:

```typescript
// libs/contracts/src/auth/auth-token.service.ts (illustrative)

export interface ParsedRefreshToken {
  userId: string;
  familyId: string;
  tokenId: string; // refresh jti
  authVersion: number;
}

export interface IAuthTokenService {
  // existing methods unchanged except refreshAuthSession may become internal/deprecated
  parseRefreshToken(refreshToken: string): Promise<ParsedRefreshToken>;
  rotateAuthSession(parsed: ParsedRefreshToken, freshUser: CurrentUser): Promise<AuthTokens>;
  // verifyAccessToken, createAuthSession, revoke — extended for authVersion
}
```

**Alternative (simpler wiring, couples Auth to DB):** inject `IUserRepository` into `JwtAuthTokenService` via extended `AuthModule` factory. **Not recommended** for starter-kit portability per `.cursor/rules/20-module-portability.mdc`.

### `CurrentUser` extension

```typescript
export interface CurrentUser {
  id: string;
  email: string;
  roles: string[];
  authVersion: number;
}
```

### JWT payloads

Add `authVersion` to access and refresh JWT bodies in `JwtAuthTokenService.issueTokenPair`.

On `verifyAccessToken`, compare token `authVersion` against DB **only if** human approves per-request check (see open questions). Default plan: **no DB call on access verify** unless optional high-risk path enabled.

### Session driver

Change Redis session value from full `CurrentUser` JSON to `{ userId: string; authVersion: number }` (or equivalent `SessionRecord` type on `ISessionStore`).

`SessionAuthTokenService.verifyAccessToken` loads user via injected resolver — either:

- **Option S1:** extend `SessionAuthTokenService` factory in composition root with `TOKENS.UserRepository` callback (same portability pattern as refresh), or
- **Option S2:** add `IUserResolver` port to contracts consumed only by session verify path.

Existing Redis sessions become invalid on deploy (acceptable breaking change with documented TTL overlap).

### DI updates

| Factory                                                    | Current inject            | Add                                                      |
| ---------------------------------------------------------- | ------------------------- | -------------------------------------------------------- |
| `RefreshAuthSessionUseCase` (`auth-application.module.ts`) | `TOKENS.AuthTokenService` | `TOKENS.UserRepository`                                  |
| Session verify resolver (if S1)                            | —                         | `TOKENS.UserRepository` in composition, not `AuthModule` |

Both `JwtAuthTokenService` and `SessionAuthTokenService` must implement any new `IAuthTokenService` methods.

## Implementation steps

### Step 1 — Data model foundation

1. Add `auth_version integer NOT NULL DEFAULT 0` to `users` via Drizzle migration (`npm run db:generate` after schema change).
2. Extend `User` entity with `authVersion` (default `0` on create).
3. Update `UserMapper`, `UserDrizzleRepository`, and `users.schema.ts`.
4. Add `IUserRepository.incrementAuthVersion(userId)` (or equivalent documented `update` pattern).
5. Extend `CurrentUser` with `authVersion`.

### Step 2 — JWT issuance embeds version

1. Update `JwtAuthTokenService.issueTokenPair` to include `authVersion` in access and refresh JWT payloads.
2. Update `JwtAuthTokenService.toCurrentUser` to map `authVersion`.
3. Update `LoginUseCase` (and register response mapping if applicable) to pass `user.authVersion`.

**Legacy tokens:** treat missing `authVersion` claim as `0` during rollout (document in README); reject only when DB version is higher.

### Step 3 — Refresh freshness (required)

1. Add `parseRefreshToken(refreshToken)` to `JwtAuthTokenService`:
   - verify refresh JWT signature/expiry;
   - validate `type`, `jti`, `familyId`;
   - return `{ userId, familyId, tokenId, authVersion }` without issuing new tokens.
2. Add `rotateAuthSession(parsed, freshUser)` to `JwtAuthTokenService`:
   - call existing rotation logic with `freshUser` (not `toCurrentUser(refreshPayload)`).
3. Refactor `RefreshAuthSessionUseCase.execute`:
   - `parsed = await authTokenService.parseRefreshToken(refreshToken)`;
   - `user = await userRepository.findById(parsed.userId)`;
   - reject if user missing, disabled (if added), or `user.authVersion !== parsed.authVersion` → `AuthenticationError`;
   - build fresh `CurrentUser` from DB (`id`, `email`, `roles`, `authVersion`);
   - `return authTokenService.rotateAuthSession(parsed, freshCurrentUser)`.
4. Update `auth-application.module.ts` factory inject array.

### Step 4 — Session driver parity

1. Define `SessionRecord = { userId: string; authVersion: number }` in contracts.
2. Change `ISessionStore.create` / `RedisSessionStore` to persist `SessionRecord` instead of full `CurrentUser`.
3. Implement session verify resolution in composition layer (recommended):
   - new use case `ResolveSessionUserUseCase` **or** extend `SessionAuthTokenService` via factory callback `resolveUser(userId): Promise<CurrentUser | null>` passed through `AuthModuleOptions`.
4. On verify: load session record → load user from DB → reject if missing or `user.authVersion !== record.authVersion` → return fresh `CurrentUser`.

### Step 5 — Optional high-risk endpoint freshness (human-gated)

Implement **only if approved** in open questions:

| Option | Mechanism                                                              | Files                                                         |
| ------ | ---------------------------------------------------------------------- | ------------------------------------------------------------- |
| A      | `authVersion` check inside `verifyAccessToken` (DB read every request) | `jwt-auth-token.service.ts` + user repo injection or callback |
| B      | `@FreshUser()` decorator + guard that re-loads user after `AuthGuard`  | new decorator/guard in `apps/api/src/`                        |
| C      | Extend `RolesGuard` to hit DB when `@Roles()` present                  | `roles.guard.ts` + repo injection                             |

Default recommendation if human wants optional path: **Option C** — DB cost only on role-gated routes.

### Step 6 — Documentation

Update README §16.1 with:

| Driver      | Event                          | Maximum delay (after fix)                                       |
| ----------- | ------------------------------ | --------------------------------------------------------------- |
| JWT access  | Role change / authVersion bump | `JWT_EXPIRES_IN` (default 15m) unless access-time check enabled |
| JWT refresh | Role change / authVersion bump | **Immediate** on next refresh attempt (after Step 3)            |
| Session     | Role change / authVersion bump | **Immediate** on next request (after Step 4)                    |
| Any         | User disable (if added)        | Per disable policy                                              |

Document consumer contract: downstream apps **must** call `incrementAuthVersion` (or equivalent) on password change, role change, and security reset.

### Step 7 — Tests (V-11)

1. **Refresh stale roles:** login with `admin` role → mutate DB (remove role, bump `authVersion`) → refresh fails with auth error → new tokens not issued.
2. **Refresh fresh user:** login → refresh without mutation → succeeds with same roles/version.
3. **Session stale version:** create session → bump `authVersion` in DB → `verifyAccessToken` returns null / 401.
4. **Legacy claim handling:** token with missing `authVersion` treated as `0` when DB is `0`.
5. **Access token window:** document/optionally assert that stale access token still works until expiry when per-request check disabled.

## Migration and rollout concerns

1. Run migration adding `auth_version DEFAULT 0` — existing users get version `0`; outstanding tokens without claim treated as `0`.
2. **Session format change** invalidates existing Redis sessions immediately on deploy (users must re-login). Document in README changelog note.
3. **JWT access tokens** issued before deploy remain valid until expiry unless access-time version check enabled.
4. No production migration without known safe target DB.
5. Generate migration via `npm run db:generate`; apply locally with `npm run db:migrate` only against known dev DB.

## Targeted verification

```bash
# Unit: JWT claim embedding and refresh rejection
npm run test:unit -- jwt-auth-token

# Unit: refresh orchestration
npm run test:unit -- refresh-auth-session

# Unit: session verify rejects stale authVersion
npm run test:unit -- session-auth-token
```

**V-11 manual scenario (JWT):**

```text
1. POST /auth/login → receive tokens with roles including admin
2. Direct DB: UPDATE users SET roles = '["user"]', auth_version = auth_version + 1 WHERE id = <userId>
3. POST /auth/refresh with refreshToken
   Expected after fix: 401 / AuthenticationError; no new tokens
4. GET /auth/me with old accessToken (before expiry)
   Expected (default policy): 200 with stale guard auth OR fresh body mismatch documented
5. Wait JWT_EXPIRES_IN / use expired access → 401
```

**V-11 manual scenario (session):**

```text
1. Login with AUTH_DRIVER=session → session cookie set
2. Bump auth_version in DB
3. GET /auth/me with session cookie
   Expected after fix: 401 Unauthorized
```

## Full verification

```bash
npm run build              # contracts + migration + all libs
npm run build:api
npm run build:migrations
npm run lint
npm run test:unit
npm run test:int           # if auth integration tests added
```

Bootstrap (if PostgreSQL + Redis available):

```bash
npm run db:migrate         # local dev DB only
npm run start:api
# execute V-11 manual scenarios
```

## Acceptance criteria

| #     | Criterion                                                                                                           | Verification                      |
| ----- | ------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| AC-1  | Authorization freshness policy documented in README §16.1 with maximum revocation delay per driver                  | README review                     |
| AC-2  | `users.auth_version` column exists; domain/mapper/repository/`CurrentUser` aligned                                  | Migration + build                 |
| AC-3  | JWT access and refresh tokens embed `authVersion` at login/refresh issuance                                         | Unit test + JWT decode            |
| AC-4  | Refresh reloads user/roles from `IUserRepository`; rejects missing user or `authVersion` mismatch                   | Unit test + V-11                  |
| AC-5  | Refresh issues tokens with **fresh** `email` and `roles` from DB, not stale refresh payload                         | Unit test                         |
| AC-6  | Session driver does not authorize from long-lived role snapshot; validates against current user/version             | Unit test + V-11 session scenario |
| AC-7  | `incrementAuthVersion` (or documented equivalent) available for downstream security events                          | Repository contract + README      |
| AC-8  | Optional high-risk endpoint check implemented **only if** human approves mechanism in open questions                | Conditional                       |
| AC-9  | `npm run build`, `npm run lint`, `npm run test:unit` pass                                                           | Command evidence                  |
| AC-10 | No coupling of `AuthModule` to Drizzle/`IUserRepository` (refresh/session resolution in application or composition) | Architecture review               |

## Risks

| Risk                                                        | Impact                                    | Mitigation                                              |
| ----------------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------- |
| Per-request DB lookup on access verify                      | Latency/load                              | Default to refresh-only freshness; opt-in for high-risk |
| Session format change                                       | Forces re-login on deploy                 | Document breaking change; short TTL overlap if needed   |
| `authVersion` without bump callers in repo                  | Field unused until apps wire it           | Document contract; provide repository helper            |
| Refresh-only fix leaves access stale up to `JWT_EXPIRES_IN` | 15m window by default                     | Document explicitly; optional access-time check         |
| Legacy JWTs without `authVersion` claim                     | Reject-all vs treat-as-0                  | Treat missing as `0` during rollout                     |
| `IAuthTokenService` contract extension                      | Both drivers must implement               | Update JWT + session services together                  |
| No `@Roles()` usage yet                                     | Stale-role bug latent on unguarded routes | Document; optional RolesGuard DB check                  |

## Rollback strategy

1. Revert application code; redeploy previous image.
2. Migration column `auth_version` is additive with default — rollback migration optional (column harmless if unused).
3. Session format revert requires users to re-login again — prefer forward fix over rollback if sessions already migrated.
4. JWT tokens issued with new claims remain valid until natural expiry unless blacklist/version check rejects them.

## Open questions requiring human decision

1. **`authVersion` only vs also `disabledAt` / `isDisabled`?** Backlog mentions user disable/delete; schema has neither. Recommend: **`authVersion` only in this fix**; disable as follow-up unless required for AC.
2. **Access token policy:** refresh-only freshness (max stale window = `JWT_EXPIRES_IN`, default 15m) **vs** `authVersion` DB check on every `verifyAccessToken`? **Recommend: refresh-only default** per backlog “minimum during refresh”.
3. **High-risk endpoint mechanism:** env flag, `@FreshUser()` decorator, or extend `RolesGuard` to hit DB? **Recommend: Option C (RolesGuard)** if any optional path is wanted; otherwise defer AC-8.
4. **Session storage shape:** `{ userId, authVersion }` only **vs** snapshot + version check? **Recommend: `{ userId, authVersion }` only**.
5. **Family-wide invalidation on `authVersion` bump:** revoke all Redis refresh families for user (needs `IJwtTokenStore` API keyed by `userId`)? **Recommend: out of scope** unless strict immediate refresh revocation required.
6. **Who increments `authVersion` in this repo:** document contract only **vs** add exemplar (e.g. comment on `IUserRepository.incrementAuthVersion` + README)? **Recommend: repository helper + README contract, no admin API**.
7. **Legacy JWT handling:** reject tokens missing `authVersion` **vs** treat missing as `0`? **Recommend: treat missing as `0`** for backward compatibility during rollout.
