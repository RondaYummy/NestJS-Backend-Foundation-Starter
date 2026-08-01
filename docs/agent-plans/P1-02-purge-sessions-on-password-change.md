---
issue_id: P1-02
status: approved
owner: human-approval-required
---

# P1-02 — Purge Redis sessions and JWT refresh families on password change/reset

## Source issue

- Backlog index: `docs/agent-backlog/INDEX.md` — **P1-02** (High / Confirmed defect)
- Full definition: `docs/agent-backlog/NESTJS_STARTER_KIT_REQUIRED_FIXES.md` § P1-02
- Review evidence: `docs/agent-reports/full-review-2026-07-28.md` (password change/reset without Redis purge)
- Branch at planning time: `main` (unrelated staged work for P1-01 / P1-03 / P1-04 / TASK docs; **no production code changes for P1-02 yet**)

## Current behavior

Confirmed on the current branch:

1. `User.changePassword` in `libs/domain/src/entities/user.entity.ts` replaces the password hash and bumps `authVersion`.
2. `ChangePasswordUseCase` (`libs/application/src/use-cases/auth/change-password.usecase.ts`) and `ResetPasswordUseCase` (`libs/application/src/use-cases/auth/reset-password.usecase.ts`) persist the updated user, then call only `IAuthTokenService.createAuthSession` with the new `authVersion`. Neither use case revokes prior Redis sessions or JWT refresh families.
3. Composition wiring in `apps/api/src/composition/auth-application.module.ts` injects only `UserRepository`, `PasswordHasher`, and `AuthTokenService` (plus reset-token store for reset). No purge collaborator is wired.
4. Session driver already has `ISessionManagementService.revokeAll(userId)` → `RedisSessionManagementService` → `ISessionStore.listByUserId` + `delete`, but password flows never call it.
5. JWT driver has per-family revoke only: `IJwtTokenStore.revokeRefreshTokenFamily(familyId)`. There is **no** user→family index and **no** “revoke all families for user” API. `RedisJwtTokenStore.saveRefreshToken` / `rotateRefreshToken` write only `auth:refresh-token:{jti}` and `auth:refresh-family:{familyId}`.
6. `RedisSessionManagementService.listForUser` returns every indexed session for the user with **no** `authVersion` filter, so stale-authVersion records that remain indexed still appear in `GET /v1/sessions`.
7. Verification still rejects stale credentials when `resolveAccessUser` / `resolveSessionUser` and refresh `authVersion` checks are wired; portable JWT consumers that omit `resolveAccessUser` keep accepting old access JWTs until expiry. Refresh rotation is rejected on `authVersion` mismatch in `RefreshAuthSessionUseCase`, but family/token Redis keys still linger until TTL.
8. Docs over-claim cleanup-by-freshness alone:
   - OpenAPI `@ApiOperation` on change-password / reset-password (`apps/api/src/controllers/auth.controller.ts`) says bumping `authVersion` makes prior credentials stale (true for verification when resolvers are wired) but does not mention store purge.
   - `EXAMPLES.md` §5.2 states prior JWT/session credentials become invalid after change-password (verification semantics), without stating eager Redis cleanup.

Existing unit specs (`change-password.usecase.spec.ts`, `reset-password.usecase.spec.ts`) assert bump + re-issue only; they do not assert purge.

## Confirmed root cause

Password-credential rotation relies solely on `authVersion` freshness checks and does **not** eagerly revoke stored session / refresh artifacts. Session listing and bulk-revoke completeness therefore diverge from the product expectation that “all prior credentials are dead” after password change/reset. JWT lacks a user-scoped family index, so “revoke all families for this user” is currently unimplemented even if a caller wanted it.

## Dependency/runtime flow

```text
POST /v1/auth/change-password | POST /v1/auth/reset-password
  → ChangePasswordUseCase | ResetPasswordUseCase
    → User.changePassword (authVersion++)
    → IUserRepository.update
    → (missing today) revoke all prior auth artifacts for userId
    → IAuthTokenService.createAuthSession  // new session / new JWT family

Session list (AUTH_DRIVER=session):
  SessionsController.list
    → ListSessionsUseCase
      → ISessionManagementService.listForUser
        → ISessionStore.listByUserId  // no authVersion filter today

JWT refresh artifacts (AUTH_DRIVER=jwt):
  JwtAuthTokenService.createAuthSession / rotateAuthSession
    → IJwtTokenStore.saveRefreshToken | rotateRefreshToken
      → Redis keys: auth:refresh-token:{jti}, auth:refresh-family:{familyId}
      → (missing today) auth:refresh-families:user:{userId} index
```

Composition roots involved:

- `apps/api/src/composition/auth-application.module.ts` — use-case factories for change/reset password (and list sessions if signature changes).
- `libs/infrastructure/src/auth/auth.module.ts` — registers `JwtAuthTokenService` / `SessionAuthTokenService` and default Redis stores; custom `TOKENS.JwtTokenStore` mocks must gain any new port methods.

## Goal

After a successful password change or reset:

1. Eagerly revoke **all** prior session records (session driver) or **all** refresh-token families (JWT driver) for that user **before** issuing the new auth artifacts from the same response.
2. Keep the `authVersion` bump (defense in depth; do not replace it with purge-only).
3. Ensure `GET /v1/sessions` does not list sessions whose stored `authVersion` is stale relative to the authenticated user.
4. Align EXAMPLES / OpenAPI wording with actual store cleanup + `authVersion` behavior.
5. Cover both use cases with unit tests for purge-then-reissue.

## Scope

- Add a driver-agnostic revoke-all-for-user capability on `IAuthTokenService` (recommended) so application use cases stay driver-neutral.
- Extend `IJwtTokenStore` with user-scoped family revoke, backed by a Redis SET user→family index maintained on save/rotate (and pruned on single-family revoke / revoke-all).
- Call revoke-all **after** persisting the bumped user and **before** `createAuthSession` in both change-password and reset-password use cases.
- Filter session list results by current `authVersion` (pass through from authenticated user / use case).
- Update unit tests, OpenAPI operation descriptions, `EXAMPLES.md`, and README Redis-key docs as needed.
- Update composition factories and any in-repo `IJwtTokenStore` / `IAuthTokenService` test doubles for new methods.

## Out of scope

- P1-01 (session user-index TTL overwrite) — already separately planned/implemented; orphan sessions outside the index remain a P1-01 concern. This plan’s `revokeAllForUser` uses `listByUserId` and therefore only deletes **indexed** sessions (same completeness as today’s `revokeAll`).
- P1-03 (idempotency lock loss) and P1-04 (atomic single-family revoke) — do not implement those here. If P1-04 is not yet merged, P1-02 may still call existing `revokeRefreshTokenFamily` per family; note residual race under concurrent rotate as a known P1-04 risk, not a blocker for planning P1-02.
- Building a user→access-`jti` denylist index / denylisting every outstanding access token on password change (issue marks this optional). Rely on `authVersion` + `resolveAccessUser` (when wired) for access rejection; document that portable JWT deployments without `resolveAccessUser` still accept old access JWTs until expiry even after family purge.
- Changing HTTP request/response schemas, status codes, or cookie names for change-password / reset-password.
- Role-change / `bumpAuthVersion` call sites outside password change/reset (unless a shared helper is extracted without expanding product behavior).
- Live Redis integration tests (optional; unit/mocks suffice for AC).
- Marking the backlog issue resolved.

## Files to create

| Path                                                                 | Responsibility                                                                                                                                                               |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `libs/infrastructure/src/auth/redis-jwt-token-store.service.spec.ts` | Unit tests for user→family index maintenance and `revokeAllRefreshTokenFamilies` (create if absent; if P1-04 already added this file, **extend** it instead of duplicating). |

## Files to modify

| Path                                                                     | Symbol / responsibility                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `libs/contracts/src/auth/auth-token.service.ts`                          | Add `revokeAllForUser(userId: string): Promise<void>` to `IAuthTokenService`.                                                                                                                                                                                                     |
| `libs/contracts/src/auth/jwt-token-store.service.ts`                     | Add `revokeAllRefreshTokenFamilies(userId: string): Promise<void>`; document user→family index contract on save/rotate/revoke.                                                                                                                                                    |
| `libs/contracts/src/auth/session-management.service.ts`                  | Extend `listForUser` to accept `currentAuthVersion: number` (or equivalent) and document that stale-`authVersion` sessions are omitted.                                                                                                                                           |
| `libs/infrastructure/src/auth/session-auth-token.service.ts`             | Implement `revokeAllForUser` via `ISessionStore.listByUserId` + `delete` for each entry.                                                                                                                                                                                          |
| `libs/infrastructure/src/auth/jwt-auth-token.service.ts`                 | Implement `revokeAllForUser` by delegating to `IJwtTokenStore.revokeAllRefreshTokenFamilies`.                                                                                                                                                                                     |
| `libs/infrastructure/src/auth/redis-jwt-token-store.service.ts`          | Maintain `auth:refresh-families:user:{userId}` SET on save/rotate (TTL = max remaining index TTL, new refresh TTL — same sentinel rules as session index / P1-01); implement `revokeAllRefreshTokenFamilies`; SREM family from user index on single-family revoke when practical. |
| `libs/infrastructure/src/auth/redis-session-management.service.ts`       | Filter `listForUser` to exclude entries where `record.authVersion !== currentAuthVersion`.                                                                                                                                                                                        |
| `libs/infrastructure/src/auth/unsupported-session-management.service.ts` | Match updated `listForUser` signature (still throw `SESSION_DRIVER_REQUIRED`).                                                                                                                                                                                                    |
| `libs/application/src/use-cases/auth/change-password.usecase.ts`         | After `userRepository.update`, call `authTokenService.revokeAllForUser(updatedUser.id)` then `createAuthSession`.                                                                                                                                                                 |
| `libs/application/src/use-cases/auth/reset-password.usecase.ts`          | Same purge-then-reissue ordering.                                                                                                                                                                                                                                                 |
| `libs/application/src/use-cases/auth/list-sessions.usecase.ts`           | Forward `currentAuthVersion` into `listForUser`.                                                                                                                                                                                                                                  |
| `apps/api/src/types/request-user.type.ts`                                | Add `authVersion: number` so the guard’s `CurrentUser` is accurately typed for list filtering.                                                                                                                                                                                    |
| `apps/api/src/controllers/sessions.controller.ts`                        | Pass `user.authVersion` into `ListSessionsUseCase`.                                                                                                                                                                                                                               |
| `apps/api/src/controllers/auth.controller.ts`                            | Update change-password / reset-password `@ApiOperation` descriptions to state eager Redis session/family purge **and** `authVersion` bump.                                                                                                                                        |
| `apps/api/src/composition/auth-application.module.ts`                    | No new tokens expected if purge stays on `IAuthTokenService`; update list-sessions factory only if constructor arity changes.                                                                                                                                                     |
| `libs/application/src/use-cases/auth/change-password.usecase.spec.ts`    | Assert `revokeAllForUser` called before `createAuthSession`; failure paths do not purge.                                                                                                                                                                                          |
| `libs/application/src/use-cases/auth/reset-password.usecase.spec.ts`     | Same.                                                                                                                                                                                                                                                                             |
| `libs/application/src/use-cases/auth/list-sessions.usecase.spec.ts`      | Assert `authVersion` is forwarded.                                                                                                                                                                                                                                                |
| `libs/infrastructure/src/auth/session-auth-token.service.spec.ts`        | Cover `revokeAllForUser`.                                                                                                                                                                                                                                                         |
| `libs/infrastructure/src/auth/jwt-auth-token.service.spec.ts`            | Cover `revokeAllForUser` delegation; extend store mock.                                                                                                                                                                                                                           |
| `libs/infrastructure/src/auth/redis-session-management.service.spec.ts`  | Cover stale-`authVersion` omission from list.                                                                                                                                                                                                                                     |
| `libs/infrastructure/src/auth/auth.module.spec.ts`                       | Extend custom `IJwtTokenStore` stub with new method.                                                                                                                                                                                                                              |
| `libs/infrastructure/src/redis/redis-key-builder.spec.ts`                | Add convention case for `auth:refresh-families:user:…` physical key.                                                                                                                                                                                                              |
| `EXAMPLES.md`                                                            | §5.2 change-password (and reset if needed): state eager store purge + `authVersion` bump; note JWT access without `resolveAccessUser`.                                                                                                                                            |
| `README.md`                                                              | Document new Redis key `auth:refresh-families:user:<userId>` under Redis state; clarify password-change cleanup vs freshness checks under Authorization freshness / Auth sections as needed.                                                                                      |

## Files to delete

None.

## Contract and DI changes

| Contract / token                        | Change                                                                                                                                                                          |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `IAuthTokenService`                     | **Additive** method `revokeAllForUser(userId: string): Promise<void>`. Both driver implementations required.                                                                    |
| `IJwtTokenStore`                        | **Additive** method `revokeAllRefreshTokenFamilies(userId: string): Promise<void>`. Custom store providers (tests / portable apps) must implement it.                           |
| `ISessionManagementService.listForUser` | **Signature extension** with `currentAuthVersion: number`. Breaking for external implementers of this port; in-repo stub + Redis impl + use case + controller updated together. |
| `TOKENS.*`                              | No new tokens. Continue using `TOKENS.AuthTokenService` / `TOKENS.JwtTokenStore` / `TOKENS.SessionManagementService`.                                                           |
| HTTP API                                | No request/response schema change. OpenAPI **descriptions** only (AC-05).                                                                                                       |

Recommended application ordering (must be preserved in implementation):

```text
1. validate inputs / consume reset token
2. user.changePassword → repository.update   // authVersion bumped in DB
3. authTokenService.revokeAllForUser(userId) // purge prior Redis artifacts
4. authTokenService.createAuthSession(...)   // issue fresh artifacts only
```

Calling revoke-all **after** create would delete the newly issued session/family — do not invert steps 3 and 4.

## Implementation steps

1. **Contracts**
   - Add `revokeAllForUser` to `IAuthTokenService`.
   - Add `revokeAllRefreshTokenFamilies` to `IJwtTokenStore` with JSDoc describing logical keys:
     - `auth:refresh-families:user:{userId}` — SET of `familyId` members; TTL must cover the longest remaining indexed refresh family (`max(currentIndexTtl, newRefreshTtl)`; Redis TTL `-1`/`-2` → set finite new TTL), mirroring session-index rules from P1-01.
   - Extend `ISessionManagementService.listForUser(userId, currentSessionId, currentAuthVersion)`.

2. **JWT store index + revoke-all**
   - Update `RedisJwtTokenStore.saveRefreshToken` / `rotateRefreshToken` Lua (or post-script Redis ops if Lua KEYS limits force a second atomic step — prefer single script when feasible) to `SADD` `familyId` onto the user SET and refresh index TTL with max semantics.
   - Implement `revokeAllRefreshTokenFamilies(userId)`: `SMEMBERS` user SET → for each `familyId` call `revokeRefreshTokenFamily` (or one Lua that deletes family+token and clears the SET) → delete/empty the user index key.
   - On `revokeRefreshTokenFamily`, best-effort `SREM` the family from the user SET when `userId` is available from the token record; if not available without an extra GET, rely on revoke-all / list prune of missing family keys.
   - Add/extend unit tests with mocked `RedisService` asserting index writes, TTL max behavior, and revoke-all membership cleanup.

3. **Auth token services**
   - `SessionAuthTokenService.revokeAllForUser`: list + delete all sessions for `userId` (same semantics as management `revokeAll`).
   - `JwtAuthTokenService.revokeAllForUser`: `tokenStore.revokeAllRefreshTokenFamilies(userId)`.
   - Update specs and `auth.module.spec.ts` store stub.

4. **Session list freshness filter**
   - `RedisSessionManagementService.listForUser`: after `listByUserId`, omit entries where `entry.record.authVersion !== currentAuthVersion`.
   - Update `UnsupportedSessionManagementService` signature.
   - Thread `authVersion` from `RequestUser` through controller → `ListSessionsUseCase` → management service.
   - Extend `RequestUser` with `authVersion` (guard already assigns full `CurrentUser`).

5. **Password use cases**
   - Inject no new ports if using `IAuthTokenService.revokeAllForUser`.
   - After successful `update`, await `revokeAllForUser`, then `createAuthSession`.
   - Update comments that currently claim authVersion alone is sufficient for cleanup.

6. **Docs / OpenAPI**
   - Align `auth.controller.ts` operation text, `EXAMPLES.md` §5.2, and `README.md` Redis key list + password-change freshness wording with purge + bump semantics.
   - Explicitly note optional gap: without `resolveAccessUser`, JWT access tokens remain usable until expiry even after family purge.

7. **Verification**
   - Run targeted unit tests, then full build/lint/unit gate listed below.

## Migration and rollout concerns

- **Additive Redis keys:** Existing refresh tokens issued before deploy have **no** user→family index membership. After deploy, `revokeAllRefreshTokenFamilies` only removes families that were indexed (i.e. issued/rotated post-deploy). Pre-deploy families still die via `authVersion` mismatch on refresh and via TTL. Document this transition window; do **not** introduce `KEYS`/`SCAN` of all refresh keys in production paths.
- **No DB migration.**
- **Port implementers:** Any external `IJwtTokenStore` / `IAuthTokenService` / `ISessionManagementService` must be updated (compile break) — acceptable for a starter-kit contract fix; call out in plan acceptance.
- **Order relative to P1-04:** Prefer merging atomic single-family revoke (P1-04) before or with P1-02 for safer multi-family purge under concurrency; not a hard blocker for implementing the index + use-case call sites.
- **Backward compatible HTTP:** Clients see same envelopes; only server-side Redis cleanup and list filtering change.

## Targeted verification

```bash
npm run test:unit -- --testPathPattern="change-password.usecase|reset-password.usecase|list-sessions.usecase|session-auth-token.service|jwt-auth-token.service|redis-jwt-token-store|redis-session-management|auth.module.spec|redis-key-builder"
npm run build
```

Optional if OpenAPI description-only drift tests assert exact operation text:

```bash
npm run test:unit -- --testPathPattern="openapi-contract"
```

## Full verification

```bash
npm run build
npm run lint
npm run test:unit
```

If composition module specs cover change/reset factories:

```bash
npm run test:module -- --testPathPattern="auth-application.module"
```

Runtime bootstrap (`start:api`) and `test:int` are **not required** to prove AC when unit tests mock stores correctly. Optional smoke with Redis: login on two devices → change-password → confirm old session cookie / old refresh fail and `GET /v1/sessions` shows only the new session. Separate infrastructure unavailability from code failure.

## Acceptance criteria

- **AC-01:** After change-password (session driver), prior session IDs fail verification and do not appear as active in session list (indexed sessions deleted via `revokeAllForUser`; any lingering indexed stale-`authVersion` rows are filtered from list).
- **AC-02:** After change-password / reset-password (JWT driver), prior refresh tokens cannot rotate (`revokeAllRefreshTokenFamilies` removes indexed families; refresh path also continues to reject `authVersion` mismatch).
- **AC-03:** Newly issued auth artifacts from the same successful response remain valid (purge runs before re-issue).
- **AC-04:** Unit tests cover purge + re-issue for change-password and reset-password (and store/service coverage for JWT user index / session list filter).
- **AC-05:** Docs/OpenAPI describe both eager Redis cleanup and `authVersion` bump; they do not claim store cleanup the code does not perform, and they do not omit the portable JWT-without-`resolveAccessUser` access-token caveat.

## Risks

- **Pre-deploy JWT families unindexed:** Password change immediately after upgrade may leave old family keys until TTL; refresh still fails on `authVersion`. Mitigate by documenting the transition window; do not SCAN Redis.
- **User-index TTL bugs on the new JWT SET:** Reuse P1-01 max-TTL rules carefully; incorrect `EXPIRE` could drop the family index early and weaken revoke-all completeness (same class of bug as P1-01).
- **Concurrent rotate vs multi-family revoke:** Without P1-04 atomic single-family revoke, a race can orphan a rotated refresh token during purge; track as residual P1-04 risk.
- **Orphan sessions (P1-01):** `revokeAllForUser` cannot delete sessions missing from the user SET; verification still fails them via `authVersion`, and they do not appear in list (not indexed). AC-01 “no longer appear as active” holds; “fail verification” holds when `resolveSessionUser` is wired (default starter).
- **Access JWT without denylist / without `resolveAccessUser`:** Known residual risk called out in AC-05 / open questions; not silently “fixed” by family purge alone.

## Rollback strategy

- Revert the commit(s) that add `revokeAllForUser`, JWT user index, use-case calls, and list filter.
- Leftover `auth:refresh-families:user:*` keys expire via TTL; harmless if code reverts.
- No DB rollback required.

## Open questions requiring human decision

1. **Access-token denylist on password change:** Confirm **out of scope** (recommended): do not add a user→access-`jti` index in this issue; document the `resolveAccessUser` / expiry caveat instead.
2. **Stale session rows on list:** Prefer **filter-only** (recommended) vs also eager-deleting mismatched `authVersion` rows during `listForUser`. Filter-only satisfies AC-01 listing; eager delete is a small extra and optional hardening.
3. **P1-04 sequencing:** Prefer implement/merge P1-04 before P1-02 for safer family deletes under concurrency? Planner recommendation: **not a hard gate**, but note residual race if P1-04 is still open.
4. **External port break:** Confirm additive `IAuthTokenService` / `IJwtTokenStore` methods and `listForUser` signature change are accepted for this starter kit (no versioned contracts package).
