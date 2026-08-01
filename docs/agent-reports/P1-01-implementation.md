# P1-01 — Implementation report

## Verdict

implemented

## Approved plan

`docs/agent-plans/P1-01-redis-session-user-index-ttl-overwrite.md` (`status: approved`)

## Changed files

- `libs/infrastructure/src/auth/redis-session-store.service.ts` — `create` uses `ttl` + `max(currentIndexTtl, ttlSeconds)` (negative TTL → set `ttlSeconds`)
- `libs/infrastructure/src/auth/redis-session-store.service.spec.ts` — fresh-index, mixed shorter TTL, longer TTL extend, and list-after-mixed-create coverage
- `libs/contracts/src/auth/session-store.service.ts` — doc comment on index TTL semantics (no signature change)
- `README.md` — one-line Redis key-layout clarification for `sessions:user:{userId}`
- `docs/agent-plans/INDEX.md` — P1-01 row status synced to `approved`
- `docs/agent-reports/P1-01-implementation.md` — this report

## Completed steps

1. Revalidated plan against branch: defect still present; `RedisService.ttl` / `expire` available; no conflicting edits on store files.
2. Replaced blind `expire(userIndexKey, ttlSeconds)` with `max(remaining, new)` and negative-TTL handling.
3. Left `get` / `delete` / `listByUserId` unchanged.
4. Updated unit tests for AC-01 / AC-02 / AC-03.
5. Aligned `ISessionStore` comment and README key layout.
6. Did not change backlog issue status.

## Deviations

- None vs approved implementation strategy (`max(currentIndexTtl, newTtl)` on SET; non-atomic `TTL` + `EXPIRE`).
- Open questions resolved by approved plan defaults: no Lua, include optional README line, no orphan backfill.
- `docs/agent-plans/INDEX.md` status updated from `proposed` → `approved` to match plan frontmatter (plan already human-approved).

## Commands executed

| Command                                                                                             | Result                                                                                                                                             |
| --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run test:unit -- --runInBand libs/infrastructure/src/auth/redis-session-store.service.spec.ts` | pass — 8/8                                                                                                                                         |
| `npm run build`                                                                                     | pass                                                                                                                                               |
| `npm run lint`                                                                                      | pass                                                                                                                                               |
| `npm run test:unit`                                                                                 | pass — 38 suites, 219 tests                                                                                                                        |
| `npm run test:all`                                                                                  | **fail** — `test:unit` + `test:release` OK; `test:module` failed on `apps/cron/src/cron.module.spec.ts` (`ioredis_1.default is not a constructor`) |
| `npm run test:release`                                                                              | pass — 12/12 (re-run after `test:all` failure)                                                                                                     |

## Command results

- Targeted store spec and full unit suite green after the fix.
- Full monorepo build and lint green.
- `test:all` failed in **module** suite only; failure is BullMQ/ioredis constructor during CronModule bootstrap — **unrelated to P1-01** (no cron/BullMQ/ioredis changes in this diff). Separate infrastructure/test-env defect from this bugfix.

## Acceptance criteria self-check

| AC    | Status | Evidence                                                                                                    |
| ----- | ------ | ----------------------------------------------------------------------------------------------------------- |
| AC-01 | met    | Unit test asserts second shorter create calls `expire(..., 3000)` not `60`                                  |
| AC-02 | met    | Unit test asserts `listByUserId` returns both ids after mixed-TTL creates (revoke-all path depends on list) |
| AC-03 | met    | Mixed-TTL + extend-TTL tests added                                                                          |
| AC-04 | met    | No HTTP/OpenAPI/controller changes                                                                          |

## Remaining risks

- Non-atomic `ttl` then `expire` under concurrent creates (accepted by plan).
- Index key may outlive members until its TTL elapses (`listByUserId` already prunes).
- Sessions already orphaned in deployed Redis before this fix are not repaired.
- `npm run test:all` / CronModule module spec failure remains a separate gate risk.

## Unverified areas

- Live Redis smoke (create mixed TTLs, confirm `GET /v1/sessions`) — optional per plan; not run.
- `npm run test:int` — not required by plan for AC proof.
- Runtime `start:api` bootstrap — not required by plan.
