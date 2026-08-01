# P1-01 — Independent verification

## Verdict

approved

## Scope checked

- Backlog index still lists **P1-01** (High / Confirmed defect): Fix Redis session user-index TTL overwrite.
- Source issue: `docs/agent-backlog/NESTJS_STARTER_KIT_REQUIRED_FIXES.md` § P1-01.
- Plan: `docs/agent-plans/P1-01-redis-session-user-index-ttl-overwrite.md` with `status: approved`.
- Implementation report: `docs/agent-reports/P1-01-implementation.md` (consulted; not trusted alone).

**P1-01 production/docs diff (in scope):**

| Path                                                               | Change                                                                                |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| `libs/infrastructure/src/auth/redis-session-store.service.ts`      | `create` uses `ttl` + `max(currentIndexTtl, ttlSeconds)`; negative TTL → `ttlSeconds` |
| `libs/infrastructure/src/auth/redis-session-store.service.spec.ts` | Fresh-index, mixed shorter TTL, longer extend, list-after-mixed-create                |
| `libs/contracts/src/auth/session-store.service.ts`                 | Doc comment only (no signature change)                                                |
| `README.md`                                                        | One-line Redis key-layout clarification for `sessions:user:{userId}`                  |
| `docs/agent-plans/INDEX.md`                                        | Plan row status `approved`                                                            |

**Out of P1-01 scope (present in working tree, ignored for this verdict):** staged/unrelated backlog and task docs, `P1-03`/`P1-04` plan drafts, `full-review` report, TASK-001/002 specs. No P1-02/P1-03/P1-04 production code in the P1-01 store/spec/contract/README diff.

- `get` / `delete` / `listByUserId` bodies unchanged aside from the `create` TTL logic.
- No composition-root, token, HTTP, or OpenAPI changes.
- No unrelated refactor in the store implementation.

## Root-cause assessment

**Original root cause:** After `sadd`, `RedisSessionStore.create` always called `expire(userIndexKey, ttlSeconds)` with the newest session TTL, which could expire `sessions:user:{userId}` while longer-lived `sessions:{sessionId}` keys remained (index orphans).

**Fix addresses root cause:** After `sadd`, the store reads `ttl(userIndexKey)` and sets expiry to:

- `ttlSeconds` when `currentIndexTtl < 0` (Redis `-1` no expiry / `-2` missing);
- else `Math.max(currentIndexTtl, ttlSeconds)`.

This matches the approved plan strategy (`max(currentIndexTtl, newTtl)` on SET). Blind overwrite is gone. Session payload write + `sadd` unchanged.

## Acceptance criteria matrix

| AC    | Criterion                                                                                                                       | Result     | Evidence                                                                                                                                                                                         |
| ----- | ------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| AC-01 | Creating a second session with a shorter TTL does not remove longer-lived sessions from `listByUserId` before their keys expire | **passed** | Unit test asserts second create calls `expire(..., 3000)` not `60` when remaining index TTL is 3000; plan accepts this as AC-01 proof                                                            |
| AC-02 | `revokeAll(userId)` deletes every still-valid session key when previously indexed                                               | **passed** | Index no longer truncated under mixed TTLs; store test keeps both ids visible to `listByUserId`; existing `RedisSessionManagementService.revokeAll` deletes every listed id (unchanged DI chain) |
| AC-03 | Unit coverage for mixed-TTL index behavior                                                                                      | **passed** | Specs: shorter-TTL does not shorten; longer TTL extends; list-after-mixed-create                                                                                                                 |
| AC-04 | No public HTTP contract change unless documented                                                                                | **passed** | Diff has no controller/OpenAPI/HTTP changes                                                                                                                                                      |

## Dependency and DI verification

```text
SessionAuthTokenService.createAuthSession
  → TOKENS.SessionStore (ISessionStore)
    → RedisSessionStore.create  [FIXED]

SessionsController / use cases
  → TOKENS.SessionManagementService
    → RedisSessionManagementService (AUTH_DRIVER=session)
      → ISessionStore.listByUserId / delete
        → RedisSessionStore.listByUserId / delete  [unchanged]
```

- `AuthModule` still registers `{ provide: TOKENS.SessionStore, useExisting: RedisSessionStore }` (and async factory).
- `auth-application.module.ts` still wires `RedisSessionManagementService(sessionStore)` for session driver.
- `ISessionStore` method signatures and `TOKENS.SessionStore` unchanged.
- `RedisService.ttl` / `expire` already existed; no new Redis API required.
- No DI rewiring required or performed.

## Commands executed

Command:
`node node_modules/jest/bin/jest.js libs/infrastructure/src/auth/redis-session-store.service.spec.ts --runInBand`
Result:
Failed — Babel parse error (`import type` without project Jest config).
Conclusion:
Invalid invocation without `jest.unit.config.ts`; not a project defect. Re-ran via npm script.

Command:
`npm run test:unit -- --runInBand libs/infrastructure/src/auth/redis-session-store.service.spec.ts`
Result:
Pass — 1 suite, 8/8 tests.
Conclusion:
Targeted mixed-TTL / create / list coverage green.

Command:
`npm run build`
Result:
Pass — `nest build api/worker/cron/migrations`.
Conclusion:
Contracts + infrastructure compile across entrypoints.

Command:
`npm run lint`
Result:
Pass — `eslint . --max-warnings=0`.
Conclusion:
Lint gate clean for the change set.

Command:
`npm run test:unit` (first attempt)
Result:
Exit `-1073741819` (Windows access violation), empty output (~93 ms).
Conclusion:
Intermittent Windows runner crash (known P2-08/P2-11 class); not a P1-01 code failure. Retried via direct Jest.

Command:
`node node_modules/jest/bin/jest.js --config jest.unit.config.ts --runInBand`
Result:
Pass — 38 suites, 219 tests.
Conclusion:
Full fast unit gate green for P1-01 and broader suite.

Command:
`npm run test:all`
Result:
Fail — `test:unit` 38/38, 219 passed; `test:module` failed on `apps/cron/src/cron.module.spec.ts` (`ioredis_1.default is not a constructor` during BullMQ Queue init / CronModule bootstrap).
Conclusion:
Failure is **unrelated to P1-01** (no cron/BullMQ/ioredis changes in this fix). Separate module-test / environment defect. Does not invalidate AC evidence.

Command:
`npm run test:release`
Result:
Pass — 1 suite, 12/12 tests.
Conclusion:
Release-policy suite green when run independently after `test:all` module failure.

## Findings

1. Implementation matches the approved plan exactly: `max(remaining, new)` with negative-TTL handling; SET index preserved; prune-on-read unchanged.
2. Unit tests cover the defect scenario and the optional longer-TTL extend path.
3. Docs (`ISessionStore` comment + README key layout) align with corrected semantics.
4. Workspace contains unrelated dirty/untracked docs (other plans/tasks); they do not affect the P1-01 code verdict.
5. `npm run test:all` remains red due to CronModule/ioredis module-spec failure outside this issue’s scope.

## Documentation alignment

- Contract comment now states index TTL must cover the longest remaining indexed session.
- README session Redis key layout updated to describe `max remaining / new session TTL`.
- No OpenAPI/HTTP docs required (AC-04).
- Backlog issue correctly left unresolved pending human acceptance after verification.

## Remaining risks

- Non-atomic `TTL` then `EXPIRE` under concurrent `create` (accepted by approved plan; Lua optional hardening not required).
- Index key may outlive expired members until its own TTL elapses (`listByUserId` already prunes).
- Sessions already orphaned in deployed Redis before this deploy are not repaired (explicitly out of scope).
- Merge-level `test:all` / CronModule module-spec failure remains an independent gate risk.

## Unverified areas

- Live Redis smoke (mixed TTLs + `GET /v1/sessions`) — optional per plan; not run.
- `npm run test:int` — not required by plan for AC proof; not run.
- Runtime `start:api` bootstrap — not required by plan; not run.
