# P1-02 — Implementation report

## Verdict

implemented

## Approved plan

- Plan: `docs/agent-plans/P1-02-purge-sessions-on-password-change.md` (frontmatter `status: approved`, `issue_id: P1-02`)
- Source issue: `docs/agent-backlog/INDEX.md` → **P1-02** (High / Confirmed defect), definition in `docs/agent-backlog/NESTJS_STARTER_KIT_REQUIRED_FIXES.md` § P1-02
- Branch state before implementation: clean tree except the untracked plan file; `HEAD = 8fe2114 (P1-01)`. No P1-02 production code existed yet, so the plan's "current behavior" section still matched the branch.
- Backlog issue status and plan status were **not** modified.

## Changed files

### Created

| Path                                                                 | Purpose                                                                                                                                              |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `libs/infrastructure/src/auth/redis-jwt-token-store.service.spec.ts` | New unit spec: user→family index writes on save/rotate, index TTL-max script shape, `revokeRefreshTokenFamily` SREM, `revokeAllRefreshTokenFamilies` |

### Modified — contracts

| Path                                                    | Change                                                                                                                                                              |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `libs/contracts/src/auth/auth-token.service.ts`         | Added `revokeAllForUser(userId: string): Promise<void>` to `IAuthTokenService` with purge-before-reissue ordering documented                                        |
| `libs/contracts/src/auth/jwt-token-store.service.ts`    | Added `revokeAllRefreshTokenFamilies(userId: string): Promise<void>`; documented the `auth:refresh-families:user:{userId}` index contract on save / rotate / revoke |
| `libs/contracts/src/auth/session-management.service.ts` | `listForUser` now takes `currentAuthVersion: number`; documented stale-`authVersion` omission                                                                       |

### Modified — infrastructure

| Path                                                                     | Change                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `libs/infrastructure/src/auth/redis-jwt-token-store.service.ts`          | `saveRefreshToken` / `rotateRefreshToken` Lua now `SADD` the family onto `auth:refresh-families:user:{userId}` and refresh the index TTL with max semantics; new `revokeAllRefreshTokenFamilies`; `revokeRefreshTokenFamily` best-effort `SREM`s the family using `userId` read from the refresh-token record |
| `libs/infrastructure/src/auth/session-auth-token.service.ts`             | Implemented `revokeAllForUser` via `listByUserId` + `delete`                                                                                                                                                                                                                                                  |
| `libs/infrastructure/src/auth/jwt-auth-token.service.ts`                 | Implemented `revokeAllForUser` delegating to `revokeAllRefreshTokenFamilies`, with the access-token caveat documented in code                                                                                                                                                                                 |
| `libs/infrastructure/src/auth/redis-session-management.service.ts`       | `listForUser` filters out entries whose `record.authVersion !== currentAuthVersion` (filter-only, no eager delete)                                                                                                                                                                                            |
| `libs/infrastructure/src/auth/unsupported-session-management.service.ts` | Signature aligned; still rejects with `SESSION_DRIVER_REQUIRED`                                                                                                                                                                                                                                               |

### Modified — application

| Path                                                             | Change                                                                                                                                              |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `libs/application/src/use-cases/auth/change-password.usecase.ts` | `revokeAllForUser(updatedUser.id)` after `userRepository.update`, before `createAuthSession`; stale comment about authVersion-only cleanup replaced |
| `libs/application/src/use-cases/auth/reset-password.usecase.ts`  | Same purge-then-reissue ordering                                                                                                                    |
| `libs/application/src/use-cases/auth/list-sessions.usecase.ts`   | Forwards `currentAuthVersion`                                                                                                                       |

### Modified — API

| Path                                              | Change                                                                                                                                                                   |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/api/src/types/request-user.type.ts`         | Added `authVersion: number` (the guard already assigns the full `CurrentUser`)                                                                                           |
| `apps/api/src/controllers/sessions.controller.ts` | Passes `user.authVersion` into `ListSessionsUseCase`                                                                                                                     |
| `apps/api/src/controllers/auth.controller.ts`     | `@ApiOperation` descriptions for change-password / reset-password now state eager Redis purge, the `authVersion` bump, and the access-token / `resolveAccessUser` caveat |

`apps/api/src/composition/auth-application.module.ts` was **not** changed: no constructor arity changed (only `ListSessionsUseCase.execute`), and the purge stays on the existing `TOKENS.AuthTokenService`.

### Modified — tests

`change-password.usecase.spec.ts`, `reset-password.usecase.spec.ts`, `list-sessions.usecase.spec.ts`, `session-auth-token.service.spec.ts`, `jwt-auth-token.service.spec.ts`, `redis-session-management.service.spec.ts`, `auth.module.spec.ts`, `redis-key-builder.spec.ts`.

### Modified — docs

`EXAMPLES.md` (§5.2 change-password + reset-password), `README.md` (Redis key list + new "Зміна пароля: очищення сховища + freshness" subsection under Authorization freshness).

`package-lock.json` and dependencies were not touched.

## Completed steps

1. **Contracts** — `revokeAllForUser`, `revokeAllRefreshTokenFamilies`, `listForUser(..., currentAuthVersion)` with the index/TTL contract documented in JSDoc.
2. **JWT store index + revoke-all** — single Lua script per operation (save: 3 keys, rotate: 4 keys) performing `SADD` + TTL-max `EXPIRE` on the user index; `revokeAllRefreshTokenFamilies` reads `SMEMBERS`, revokes each family, then deletes the index key; `revokeRefreshTokenFamily` reads the refresh-token record to `SREM` the family from its owner's index.
3. **Auth token services** — session driver lists + deletes indexed sessions; JWT driver delegates to the store. Specs and the `auth.module.spec.ts` custom store stub extended.
4. **Session list freshness filter** — Redis implementation filters stale `authVersion`; unsupported stub aligned; `authVersion` threaded controller → use case → management service; `RequestUser` extended.
5. **Password use cases** — purge inserted between persistence and re-issue in both flows; misleading comments corrected.
6. **Docs / OpenAPI** — operation descriptions, `EXAMPLES.md` §5.2, README Redis keys and freshness section aligned with purge + bump semantics, including the pre-deploy transition window and the access-token caveat.
7. **Verification** — targeted run, then build / lint / unit gate (below).

## Deviations

1. **`revokeRefreshTokenFamily` performs one extra `GET`** on the refresh-token key to recover `userId` for the `SREM`. The plan allowed either behavior ("best-effort `SREM` … when `userId` is available from the token record; if not available without an extra GET, rely on revoke-all"). The extra read was chosen so the per-user index does not accumulate dead families after ordinary logout / replay revocation. Cost: one additional Redis round trip on logout and replay-detection paths.
2. **Open question 2 resolved as the planner's recommendation** — filter-only in `listForUser`; stale rows are not eagerly deleted. The new spec asserts `sessionStore.delete` is not called during listing.
3. **Open question 1 resolved as recommended** — no access-token denylist added; documented instead.
4. **`apps/api/src/composition/auth-application.module.ts` unchanged** — the plan already anticipated this ("update list-sessions factory only if constructor arity changes"; it did not).
5. **`--testPathPattern` renamed** — the plan's verification command uses `--testPathPattern`, which Jest 30 rejects. Ran the same selection via `--testPathPatterns`.

No unplanned breaking change, dependency, migration or new module was required; P1-04 was **not** implemented here (single-family revoke is still non-atomic).

## Commands executed

```bash
git status --porcelain=v1 ; git diff --stat ; git log --oneline -5
npx tsc -p tsconfig.json --noEmit
npm run test:unit -- --testPathPatterns="change-password.usecase|reset-password.usecase|list-sessions.usecase|session-auth-token.service|jwt-auth-token.service|redis-jwt-token-store|redis-session-management|redis-key-builder"
npm run build
npm run lint
npm run test:unit
npm run test:module
npm run test:module -- --testPathPatterns="auth-application.module"
```

## Command results

| Command                                          | Result                                                                                                                                                           | Conclusion                                                                                                                                                                                                             |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `git status` / `git diff` / `git log` (pre-work) | Clean tree, only untracked `docs/agent-plans/P1-02-…md`; `HEAD = 8fe2114`                                                                                        | No conflicting user changes; safe to implement                                                                                                                                                                         |
| `npx tsc --noEmit` (mid-implementation)          | Failed with the expected consumer breaks (specs + `listForUser` arity) plus pre-existing root-config noise (`supertest` types, `jest.*.config.ts` `.ts` imports) | Used to enumerate every consumer of the changed contracts                                                                                                                                                              |
| Targeted `test:unit` selection                   | **pass** — 8 suites, 66 tests                                                                                                                                    | Purge ordering, JWT index, session filter and key convention behave as specified                                                                                                                                       |
| `npm run build`                                  | **pass** — api, worker, cron, migrations                                                                                                                         | All four entrypoints compile with the changed contracts                                                                                                                                                                |
| `npm run lint`                                   | **pass** (0 errors, 0 warnings) after replacing two `async` mock arrows with promise-returning ones                                                              | No rule was disabled, no `any` / `@ts-ignore` introduced                                                                                                                                                               |
| `npm run test:unit`                              | **pass** — 39 suites, 237 tests                                                                                                                                  | No regression in the unit gate (the `ExceptionsHandler` stack traces are expected negative-path logging from `openapi-contract.spec.ts`)                                                                               |
| `npm run test:module`                            | **fail** — 13 suites pass, `apps/cron/src/cron.module.spec.ts` fails with `ioredis_1.default is not a constructor` during BullMQ queue init                      | **Pre-existing and unrelated**: documented in `docs/agent-reports/full-review-2026-07-28.md` (incomplete `ioredis` mock finding) and reported identically for P1-01. Cron composition imports nothing changed by P1-02 |
| `npm run test:module -- auth-application.module` | **pass** — 1 suite, 1 test                                                                                                                                       | The API auth composition root still resolves every use case after the contract changes                                                                                                                                 |

Not executed: `npm run test:int` and `start:api` bootstrap (require PostgreSQL/Redis, which are unavailable in this environment; the plan marks both as not required to prove AC).

## Acceptance criteria self-check

| AC        | Status           | Evidence                                                                                                                                                                                                                                                                                                                                                 |
| --------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC-01** | met (unit-level) | `SessionAuthTokenService.revokeAllForUser` deletes every indexed session (`session-auth-token.service.spec.ts`); `RedisSessionManagementService.listForUser` omits stale-`authVersion` rows (`redis-session-management.service.spec.ts`). Verification of deleted sessions already fails through the existing `resolveSessionUser` + `authVersion` check |
| **AC-02** | met (unit-level) | `JwtAuthTokenService.revokeAllForUser` delegates to `revokeAllRefreshTokenFamilies` (`jwt-auth-token.service.spec.ts`); the store revokes every indexed family and clears the index (`redis-jwt-token-store.service.spec.ts`). `RefreshAuthSessionUseCase` still rejects `authVersion` mismatch (unchanged)                                              |
| **AC-03** | met              | Both use-case specs assert the call order `revokeAllForUser` → `createAuthSession`, so the artifacts returned in the same response are issued after the purge                                                                                                                                                                                            |
| **AC-04** | met              | New/updated specs for change-password, reset-password, list-sessions, both auth token services, the Redis JWT store, the session management filter, the auth module stub and the key builder                                                                                                                                                             |
| **AC-05** | met              | `@ApiOperation` descriptions, `EXAMPLES.md` §5.2 and README now state eager Redis purge **and** the `authVersion` bump, plus the explicit caveat that JWT access tokens survive until expiry without `resolveAccessUser`, and that families issued before the index existed are not purged eagerly                                                       |

## Remaining risks

1. **Lua semantics are asserted structurally, not executed.** Unit tests mock `RedisService`, so the `SADD` + TTL-max `EXPIRE` behavior is verified by script shape and argument wiring, not by a running Redis. A wrong TTL comparison would weaken revoke-all completeness the same way P1-01 did.
2. **Pre-deploy families are unindexed.** Refresh families issued before this change carry no `auth:refresh-families:user:*` membership and are therefore not purged eagerly; they die via `authVersion` mismatch on refresh and via TTL. No `KEYS`/`SCAN` was introduced.
3. **Concurrent rotate vs multi-family purge (P1-04 still open).** `revokeRefreshTokenFamily` is still non-atomic, so a rotation racing the purge can leave an orphaned refresh token. `authVersion` still rejects it on refresh.
4. **Access JWTs are not denylisted on password change.** Deployments without `resolveAccessUser` keep accepting them until expiry — documented, not fixed.
5. **Orphan sessions (P1-01 class).** `revokeAllForUser` only reaches sessions present in `sessions:user:{userId}`; unindexed sessions still fail verification via `authVersion` and never appear in the list.
6. **Extra Redis round trip on logout / replay revocation** from the record `GET` added for the index `SREM`.
7. **Redis Cluster.** The save/rotate scripts now pass 3–4 keys that hash to different slots. This was already true for the previous 2-key scripts, so the constraint is unchanged, but the new index key adds one more cross-slot key to any future cluster work.

## Unverified areas

- No runtime execution against real Redis: `npm run test:int` and `start:api` were not run (no PostgreSQL/Redis available). The optional two-device smoke test from the plan (login twice → change password → old cookie/refresh rejected, `GET /v1/sessions` shows one session) was **not** performed.
- End-to-end HTTP behavior of `GET /v1/sessions` filtering was not exercised through the guard; only the controller wiring and the service filter were checked statically and by unit test.
- `npm run test:all` was not run as a whole; `test:release` was not executed. `test:module` fails only on the pre-existing unrelated `CronModule` suite.
- Whether external consumers of `ISessionManagementService` outside this repository break on the `listForUser` signature change (accepted per plan open question 4; all in-repo implementers were updated).
