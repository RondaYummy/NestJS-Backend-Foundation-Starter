# P0-01 — Implementation report

## Verdict

implemented

## Approved plan

`docs/agent-plans/P0-01-atomic-email-idempotency.md` — `status: approved`

## Changed files

| Path                                                                    | Change                                                                                                 |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `libs/contracts/src/idempotency/job-execution-store.ts`                 | Replaced `isCompleted` / `markCompleted` with `acquire` / `complete` / `release`                       |
| `libs/infrastructure/src/idempotency/redis-job-execution.store.ts`      | Atomic Redis claim via `SET NX EX`, ownership-safe `complete` (Lua) and `release` (`compareAndDelete`) |
| `apps/worker/src/processors/email.processor.ts`                         | Acquire-before-send, complete-on-success, release-on-failure flow with TTL constants                   |
| `libs/infrastructure/src/idempotency/redis-job-execution.store.spec.ts` | New unit tests (6 cases)                                                                               |
| `README.md`                                                             | Job execution store subsection under §5.17 with failure model                                          |
| `EXAMPLES.md`                                                           | Templated email idempotency subsection under §9                                                        |

## Completed steps

1. Updated `IJobExecutionStore` contract (`acquire`, `complete`, `release`).
2. Rewrote `RedisJobExecutionStore` with `randomUUID()` + `setIfNotExists`, Lua `complete`, `compareAndDelete` `release`.
3. Updated `EmailProcessor` — `EXECUTION_TTL_SECONDS = 300`, `COMPLETED_RETENTION_TTL_SECONDS = 30 days`, try/catch with release on error.
4. Added `redis-job-execution.store.spec.ts` with acquire/complete/release and duplicate-acquire cases.
5. Documented failure model in `README.md` and `EXAMPLES.md`.
6. Grep confirmed `EmailProcessor` is the only consumer of `IJobExecutionStore`; no further call-site updates required.

## Deviations

- `email.processor.spec.ts` not added (optional per plan; `redis-job-execution.store.spec.ts` deemed sufficient).
- `/// <reference types="jest" />` added to the new spec file so ts-jest resolves Jest globals without changing `jest.unit.config.ts` (out of plan scope).
- No `RedisService` helper added; Lua script kept local to `RedisJobExecutionStore` per plan preference.

## Commands executed

| Command                                                  | Result                                                                                                     |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `git status && git diff && git diff --staged`            | Clean tree except untracked plan file; no conflicting user changes                                         |
| `npm run build:worker`                                   | Exit 0 — worker compiles after contract/adapter/processor changes                                          |
| `rg "isCompleted\|markCompleted" --glob "*.ts"`          | No matches in TypeScript sources                                                                           |
| `npm run test:unit -- redis-job-execution.store.spec.ts` | Exit 0 — 6 tests passed                                                                                    |
| `npm run build`                                          | Exit 0 — api, worker, cron, migrations build                                                               |
| `npm run lint`                                           | Exit 1 — pre-existing error in `libs/infrastructure/src/mail/null-mail.adapter.ts` (unchanged by this fix) |
| `npm run test:unit`                                      | Exit 0 — 1 suite, 6 tests passed                                                                           |
| `npm run start:worker`                                   | Exit 0 with `Error spawn EPERM` — bootstrap not confirmed in this environment                              |

## Command results

### `npm run build:worker`

```
> nest build worker
(exit 0)
```

### `npm run build`

```
> nest build api && nest build worker && nest build cron && nest build migrations
(exit 0)
```

### `npm run lint`

```
E:\Projects\NestJS-Backend-Foundation-Starter\libs\infrastructure\src\mail\null-mail.adapter.ts
  9:3  error  Async method 'send' has no 'await' expression  @typescript-eslint/require-await

✖ 1 problem (1 error, 0 warnings)
(exit 1)
```

File not modified by P0-01. Changed files have no linter diagnostics.

### `npm run test:unit`

```
Test Suites: 1 passed, 1 total
Tests:       6 passed, 6 total
(exit 0)
```

### `npm run start:worker`

```
> nest start worker
 Error  spawn EPERM
(exit 0 from npm script wrapper; runtime bootstrap unconfirmed)
```

## Acceptance criteria self-check

| Criterion                                                                                          | Status                      | Evidence                                                                                       |
| -------------------------------------------------------------------------------------------------- | --------------------------- | ---------------------------------------------------------------------------------------------- |
| Two parallel workers cannot both execute email side effect for same `idempotencyKey`               | Implemented (static)        | `acquire` uses `SET NX`; second acquire returns `null`; processor exits before `mail.send`     |
| Worker without ownership token cannot `complete()` or `release()` another claim                    | Implemented (static + unit) | Lua ownership check in `complete`; `compareAndDelete` in `release`; unit tests for wrong token |
| Retry after failure possible (`release` on error; subsequent `acquire` succeeds)                   | Implemented (static)        | `EmailProcessor` catch block calls `release` before rethrow                                    |
| Completed execution not re-run during retention (`complete` sets long TTL; `acquire` returns null) | Implemented (static)        | `complete` sets `completed` with 30-day TTL; `acquire` NX fails on existing key                |
| Failure model documented in `README.md` and `EXAMPLES.md`                                          | Done                        | New subsections added                                                                          |
| Runtime concurrency check (two workers, one SMTP send)                                             | Not verified                | Requires Redis + worker infra and manual/scripted test                                         |

## Remaining risks

- At-least-once semantics: crash after SMTP success but before `complete()` can cause duplicate email when execution TTL expires (documented).
- `complete()` returning `false` after successful send is not logged or surfaced to BullMQ (open question #5 in plan; no logging added).
- `executionTtlSeconds = 300` without heartbeat — slow SMTP/render could lose claim before complete (documented; tuning possible).

## Unverified areas

- `npm run lint` full-repo pass blocked by pre-existing `null-mail.adapter.ts` violation.
- `npm run start:worker` bootstrap — `spawn EPERM` in current environment; Redis/SMTP availability not tested.
- Manual concurrency test with two worker replicas and duplicate `idempotencyKey` enqueue not executed.
- `complete()` failure after successful send not exercised at runtime.

## Backlog status

Source backlog item **not** marked resolved. Awaiting independent verification and human acceptance.
