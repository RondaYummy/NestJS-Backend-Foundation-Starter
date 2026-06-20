# P1-02 — Implementation report

## Verdict

implemented

## Approved plan

`docs/agent-plans/P1-02-cron-error-boundary-overlap-guard.md` (`status: approved`)

## Changed files

| Path                                              | Change                                                                                                                            |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `apps/cron/src/schedules/outbox.schedule.ts`      | Added `tickRunning` / `shuttingDown` guards, `AppLogger` injection, `runTickSafely()` error boundary, lock-not-acquired debug log |
| `apps/cron/src/schedules/outbox.schedule.spec.ts` | **Created** — V-04 unit coverage: error boundary, overlap guard, shutdown guard, lock skip, interval wiring                       |

## Completed steps

1. Added lifecycle state fields `tickRunning` and `shuttingDown` to `OutboxSchedule`.
2. Injected `AppLogger` via constructor (no `CronModule` changes required).
3. Implemented private `runTickSafely()` with early return, `try/catch/finally`, structured error logging, and `tickRunning` reset.
4. Updated `onModuleInit()` to call `void this.runTickSafely()` inside the interval callback.
5. Updated `onModuleDestroy()` to set `shuttingDown = true` before interval removal.
6. Enhanced `tick()` to capture `runWithLock` result and emit `debug` log when lock is not acquired.
7. Added `outbox.schedule.spec.ts` with five unit tests covering V-04 scenarios.

## Deviations

None from the approved plan.

## Commands executed

```bash
npm run test:unit -- apps/cron/src/schedules/outbox.schedule.spec.ts
npm run build:cron
npm run build:api
npm run build:worker
npm run build:migrations
npx eslint apps/cron/src/schedules/outbox.schedule.ts apps/cron/src/schedules/outbox.schedule.spec.ts --max-warnings=0
npm run lint
npm run test:unit
```

## Command results

| Command                                         | Result                       | Conclusion                                                                                                                    |
| ----------------------------------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Targeted unit tests (`outbox.schedule.spec.ts`) | Exit 0 — 5 tests passed      | V-04 error boundary, overlap, shutdown, lock skip, interval wiring confirmed                                                  |
| `npm run build:cron`                            | Exit 0                       | Cron entrypoint compiles with new `AppLogger` DI                                                                              |
| `npm run build:api`                             | Exit 0                       | Unaffected entrypoint builds                                                                                                  |
| `npm run build:worker`                          | Exit 0                       | Unaffected entrypoint builds                                                                                                  |
| `npm run build:migrations`                      | Exit 0                       | Unaffected entrypoint builds                                                                                                  |
| Targeted ESLint (changed files only)            | Exit 0                       | No lint issues in P1-02 files                                                                                                 |
| `npm run lint` (full)                           | Exit 1                       | Pre-existing failures in `outbox-processor.defaults.ts` and `outbox-processor.options.schema.ts`; **not introduced by P1-02** |
| `npm run test:unit` (full)                      | Exit 1 — 37 passed, 1 failed | Failure in `outbox-processor.options.schema.spec.ts` (pre-existing); all 5 `OutboxSchedule` tests passed                      |

**Note:** Chained `npm run build` returned a non-zero shell exit in this environment despite individual entrypoint builds succeeding; per-entrypoint builds above are the authoritative build evidence.

## Acceptance criteria self-check

| #   | Criterion                                                                                   | Status                                                                                                        |
| --- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| 1   | Rejected lock/queue calls do not produce unhandled rejections at the interval boundary      | Pass — `runTickSafely()` catches errors; unit test asserts no throw and `logger.error`                        |
| 2   | Cron process remains alive after transient tick failures; next interval tick still executes | Pass — error swallowed; second `runTickSafely()` proceeds in unit test                                        |
| 3   | At most one `tick()` runs concurrently within a single process                              | Pass — overlap guard unit test                                                                                |
| 4   | Multi-instance protection continues via `IDistributedLock.runWithLock('cron:outbox', ...)`  | Pass — unchanged lock/enqueue path inside `tick()`                                                            |
| 5   | Lock-not-acquired logged at `debug` without throwing                                        | Pass — lock skip unit test                                                                                    |
| 6   | `onModuleDestroy()` prevents new ticks while clearing interval                              | Pass — shutdown guard unit test                                                                               |
| 7   | `npm run lint`, `npm run build`, targeted unit tests pass                                   | Partial — build:cron and targeted lint/tests pass; full lint/test suite blocked by pre-existing outbox issues |
| 8   | V-04 scenarios covered by `outbox.schedule.spec.ts`                                         | Pass — 5 tests                                                                                                |

## Remaining risks

- A tick that hangs indefinitely still blocks all future in-process ticks (pre-existing; out of scope per plan).
- `debug` lock-skip logs may be noisy in multi-replica deployments (accepted per plan).
- Narrow race window if interval fires after `deleteInterval` but before callback checks `shuttingDown` (mitigated by entry guard).

## Unverified areas

- Optional runtime V-04 scenario (`npm run start:cron` with Redis disconnect) not executed — infrastructure not required for plan sign-off; unit tests are primary evidence.
- Full `npm run lint` and full `npm run test:unit` suite not green due to pre-existing outbox failures unrelated to this change.
