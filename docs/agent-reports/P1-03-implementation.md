# P1-03 — Implementation report

## Verdict

implemented

## Approved plan

- Plan: `docs/agent-plans/P1-03-harden-idempotency-lock-loss.md` (frontmatter `status: approved`, `issue_id: P1-03`)
- Source issue: `docs/agent-backlog/INDEX.md` → **P1-03** (High / Confirmed defect), definition in `docs/agent-backlog/NESTJS_STARTER_KIT_REQUIRED_FIXES.md` § P1-03
- Branch state before implementation: staged plan-only change under `docs/agent-plans/P1-03-harden-idempotency-lock-loss.md`; no P1-03 production code existed yet. Plan’s current-behavior section matched `RedisIdempotencyService.execute` / `RedisService.completeIdempotency`.
- Backlog issue status and plan status were **not** modified.
- Open-question recommendations followed: introduce `IDEMPOTENCY_OUTCOME_UNKNOWN` (409 via `ConflictError`); keep `lockTtlSeconds` out of the TypeScript port; fence value = `requestHash`.

## Changed files

### Created

| Path                                                                  | Purpose                                                                                          |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `libs/infrastructure/src/idempotency/idempotency.service.spec.ts`     | Unit coverage: happy replay, lock-loss best-effort, fence blocks re-entry, hash reuse, fail-closed |
| `docs/agent-reports/P1-03-implementation.md`                          | This implementation report                                                                       |

### Modified

| Path                                                         | Change                                                                                                                                 |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| `libs/infrastructure/src/redis/redis.service.ts`             | `acquireIdempotencyLockWithFence`, `persistIdempotencyResultBestEffort`, `deleteIdempotencyFence`; `completeIdempotency` optional fence `DEL` |
| `libs/infrastructure/src/idempotency/idempotency.service.ts` | Fence before handler; best-effort persist on lock loss; refuse fence-without-result; `IDEMPOTENCY_OUTCOME_UNKNOWN`; wait-path update   |
| `libs/infrastructure/src/redis/redis.service.spec.ts`        | Lua helper coverage for lock+fence, best-effort persist, complete-with-fence                                                           |
| `libs/infrastructure/src/redis/redis-key-builder.spec.ts`    | Example row for `idem:…:fence`                                                                                                         |
| `EXAMPLES.md`                                                | §7 client retry contract table                                                                                                         |
| `README.md`                                                  | §5.17 three-key layout + unknown-outcome note                                                                                          |

`package-lock.json`, DI modules, and `IIdempotencyService` signature were not changed.

## Completed steps

1. **Reserve/fence semantics** — Atomic Lua lock+fence acquire (`acquireIdempotencyLockWithFence`); fence TTL = result `ttlSeconds`, value = `requestHash`. Handler failure clears lock (token-safe) and fence. Handler success leaves fence until result is stored.
2. **Post-success completion** — Owned `completeIdempotency` SET result + DEL lock + DEL fence. On `lockLost` / complete false: `persistIdempotencyResultBestEffort`; on Redis persist failure → `IDEMPOTENCY_OUTCOME_UNKNOWN` with fence retained.
3. **Re-entry / wait path** — Fence without result blocks new handler (`IDEMPOTENCY_OUTCOME_UNKNOWN` or `IDEMPOTENCY_KEY_REUSED` on hash mismatch). Waiters that see lock gone + fence without result until timeout get the same unknown outcome (not blind `IDEMPOTENCY_REQUEST_IN_PROGRESS` that invites re-execution).
4. **TTL / heartbeat hygiene** — Named constants `LOCK_TTL_SECONDS = 30`, `HEARTBEAT_INTERVAL_MS = 10_000` shared by acquire/heartbeat.
5. **Fail-closed** — Redis get/acquire errors still propagate before `handler`.
6. **Documentation** — `EXAMPLES.md` §7 retry contract; `README.md` §5.17 fence key + semantics.
7. **Tests** — New idempotency service specs + Redis helper / key-builder coverage.

## Deviations

None material. Open questions resolved per plan recommendations (no plan file edits).

## Commands executed

| Command | Purpose |
| --- | --- |
| `npx jest --config jest.unit.config.ts libs/infrastructure/src/idempotency/idempotency.service.spec.ts libs/infrastructure/src/redis/redis.service.spec.ts libs/infrastructure/src/redis/redis-key-builder.spec.ts` | Targeted unit coverage |
| `npm run build` | Full workspace compile |
| `npm run lint` | ESLint gate (after fixing require-await in new spec) |
| `npm run test:unit` | Fast unit gate |
| `npm run test:module` | Module/bootstrap specs |
| `npm run test:release` | Release-policy specs |
| `npm run test:all` | Attempted chained gate (see results) |

## Command results

| Command | Result | Conclusion |
| --- | --- | --- |
| Targeted idempotency/redis Jest | **pass** — 3 suites, 33 tests | AC-03 unit coverage green |
| `npm run build` | **pass** | Shared infra + all entrypoints compile |
| `npm run lint` | **pass** (after spec lint fix) | No lint debt in changed files |
| `npm run test:unit` | **pass** — 40 suites, 248 tests | Unit gate including new specs |
| `npm run test:release` | **pass** — 1 suite, 12 tests | Release policy unaffected |
| `npm run test:module` | **fail** — `apps/cron/src/cron.module.spec.ts`: `ioredis_1.default is not a constructor` (BullMQ RedisConnection) | Pre-existing / environment module-mock issue; **unrelated to P1-03** (no cron/BullMQ changes). 13 other module suites passed |
| `npm run test:all` | **fail** — first attempt aborted with Windows Node wrapper `SyntaxError` / exit `-4048`; subsequent component runs as above | Chained script unreliable on this host; run components individually |

API bootstrap was not required (logic covered by mocked Redis unit tests).

## Acceptance criteria self-check

| Criterion | Status | Evidence |
| --- | --- | --- |
| **AC-01** | Met (self) | Lock-loss after success with persist failure leaves fence; second `execute` does not call `handler`; throws `IDEMPOTENCY_OUTCOME_UNKNOWN` |
| **AC-02** | Met (self) | Happy-path complete + second call replays stored body with `handler` call count = 1 |
| **AC-03** | Met (self) | `idempotency.service.spec.ts` covers lock-loss-after-success and happy-path replay (plus hash collision / fail-closed) |
| **AC-04** | Met (self) | `EXAMPLES.md` §7 client retry contract; `README.md` §5.17 fence + unknown-outcome note |

## Remaining risks

- Residual crash window if the process dies after external side effects but before the fence write completes (fence is written in the same Lua as lock acquire, before handler — minimizes but does not eliminate process-kill windows after handler start).
- Fence TTL expiry can eventually allow re-execution; Redis idempotency remains best-effort, not financial exactly-once.
- Clients that treated `IDEMPOTENCY_LOCK_LOST` as “retry freely as never executed” must follow the new `IDEMPOTENCY_OUTCOME_UNKNOWN` contract (`IDEMPOTENCY_LOCK_LOST` is no longer emitted on the post-success path).
- `npm run test:module` / `test:all` not fully green on this host due to unrelated CronModule BullMQ/ioredis mock failure.

## Unverified areas

- Live Redis / API bootstrap with real lock expiry under load (unit-mocked only).
- Independent verification agent review of the diff.
- End-to-end HTTP 409 mapping for `IDEMPOTENCY_OUTCOME_UNKNOWN` (relies on existing `ConflictError` → 409 filter; not re-tested via HTTP).
