# P1-02 — Independent verification

## Verdict

**approved**

## Scope checked

**In scope (per approved plan):**

| Path                                              | Status                                                                                                                                 |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/cron/src/schedules/outbox.schedule.ts`      | Modified — `tickRunning` / `shuttingDown` guards, `AppLogger` injection, `runTickSafely()` error boundary, lock-not-acquired debug log |
| `apps/cron/src/schedules/outbox.schedule.spec.ts` | Created — V-04 unit coverage (5 tests)                                                                                                 |

**Documentation artifacts (expected, non-production):**

| Path                                                          | Status                       |
| ------------------------------------------------------------- | ---------------------------- |
| `docs/agent-plans/P1-02-cron-error-boundary-overlap-guard.md` | Created — approved plan      |
| `docs/agent-reports/P1-02-implementation.md`                  | Created — implementer report |

**Not changed (as planned):** `CronModule` provider registrations, `IDistributedLock`, `RedisDistributedLock`, `IQueueGateway`, `BullQueueGateway`, contracts, or other Cron schedules.

No unrelated production refactors or behavior changes were introduced.

## Root-cause assessment

**Confirmed root cause:** `OutboxSchedule.onModuleInit()` registered `setInterval` with `void this.tick()` — no error boundary, no local single-flight guard, no shutdown suppression, and no structured logging at the schedule boundary. Rejections from `IDistributedLock.runWithLock()` or `IQueueGateway.add()` could surface as unhandled promise rejections; overlapping ticks could run concurrently in one process.

**Fix assessment:** The implementation addresses the root cause at the schedule boundary:

1. `runTickSafely()` wraps `tick()` in `try/catch/finally` with `AppLogger.error` on failure and `tickRunning` reset in `finally`.
2. Early return when `shuttingDown || tickRunning` prevents overlap and shutdown ticks.
3. `onModuleInit()` routes the interval through `void this.runTickSafely()`.
4. `onModuleDestroy()` sets `shuttingDown = true` before interval removal.
5. `tick()` inspects `runWithLock` return value and logs lock-not-acquired skips at `debug` without throwing.
6. Distributed lock key and enqueue path inside `tick()` are unchanged.

This is a boundary-level fix, not a symptom suppressor in downstream adapters.

## Acceptance criteria matrix

| #   | Criterion                                                                                   | Result                   | Evidence                                                                                                                                                                                         |
| --- | ------------------------------------------------------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Rejected lock/queue calls do not produce unhandled rejections at the `setInterval` boundary | **passed**               | `runTickSafely()` catches errors; interval calls `runTickSafely`; unit test asserts no throw, `logger.error` called, `tickRunning` reset                                                         |
| 2   | Cron process remains alive after transient tick failures; next interval tick still executes | **passed**               | Error swallowed (no rethrow); second `runTickSafely()` proceeds and re-enqueues in unit test                                                                                                     |
| 3   | At most one `tick()` runs concurrently within a single Cron process                         | **passed**               | `tickRunning` guard; overlap test asserts single `queues.add` while first tick in-flight                                                                                                         |
| 4   | Multi-instance protection continues via `IDistributedLock.runWithLock('cron:outbox', ...)`  | **passed**               | Same lock key, TTL, and handler/enqueue path in `tick()`; no contract or adapter changes                                                                                                         |
| 5   | Lock-not-acquired logged at `debug` without throwing                                        | **passed**               | `result === null` branch with `logger.debug`; lock-skip unit test                                                                                                                                |
| 6   | `onModuleDestroy()` prevents new ticks while clearing interval                              | **passed**               | `shuttingDown = true` before `deleteInterval`; shutdown guard unit test                                                                                                                          |
| 7   | `npm run lint`, `npm run build`, targeted unit tests pass                                   | **passed** (P1-02 scope) | `npm run build` exit 0; `npm run build:cron` exit 0; targeted spec 5/5 pass; P1-02 files lint clean. Full `npm run lint` fails on pre-existing outbox unused-var errors unrelated to this change |
| 8   | V-04 scenarios covered by `outbox.schedule.spec.ts`                                         | **passed**               | Five tests: error boundary, overlap guard, shutdown guard, lock skip, interval wiring                                                                                                            |

## Dependency and DI verification

```text
CronModule
  imports: LoggerModule (exports AppLogger)
  providers: OutboxSchedule
       constructor: AppLogger (new), TOKENS.QueueGateway, TOKENS.DistributedLock,
                      TOKENS.OutboxProcessorOptions, SchedulerRegistry

setInterval callback
  -> void runTickSafely()
       -> tick()
            -> IDistributedLock.runWithLock('cron:outbox', cronLockTtlMs, handler)
                 -> IQueueGateway.add(QUEUES.OUTBOX, 'process-pending-outbox-events', ...)
```

- `AppLogger` injected via constructor; `LoggerModule` already imported and exports `AppLogger` — no `CronModule` edits required (matches plan).
- No token, contract, or infrastructure adapter changes.
- `AppLogger.error('Outbox cron tick failed', error)` matches `AppLogger.error(message, errorOrTrace?, context?)` signature.

## Commands executed

| Command                                                                                                                  | Result                                                                                       | Conclusion                                                       |
| ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `npm run test:unit -- apps/cron/src/schedules/outbox.schedule.spec.ts`                                                   | Exit 0 — 5 passed                                                                            | V-04 scenarios confirmed at runtime                              |
| `npm run build:cron`                                                                                                     | Exit 0                                                                                       | Cron entrypoint compiles with new `AppLogger` DI                 |
| `npm run build`                                                                                                          | Exit 0                                                                                       | All entrypoints compile                                          |
| `npx eslint apps/cron/src/schedules/outbox.schedule.ts apps/cron/src/schedules/outbox.schedule.spec.ts --max-warnings=0` | Exit 0                                                                                       | P1-02 changed files lint clean                                   |
| `npm run lint`                                                                                                           | Exit 1 — 4 errors in `outbox-processor.defaults.ts` and `outbox-processor.options.schema.ts` | Pre-existing; no P1-02 files involved                            |
| `npm run test:unit`                                                                                                      | Exit 1 — 37 passed, 1 failed (`outbox-processor.options.schema.spec.ts`)                     | Pre-existing outbox failure; all 5 `OutboxSchedule` tests passed |

## Findings

1. **Implementation matches approved plan.** All eight implementation steps completed with no documented deviations.
2. **Error boundary covers both queue and lock rejections.** `runTickSafely()` wraps the full `await this.tick()` call; rejections from `runWithLock` (Redis I/O) or the handler (`queues.add`) propagate to the same `catch` block. Unit test covers the queue rejection path per plan; lock rejection follows the same code path by inspection.
3. **Logging aligns with codebase conventions.** Plan explicitly chose `AppLogger.error(message, error)` over the backlog pseudocode argument order.
4. **Pre-existing suite noise.** Full lint and full unit suite are not green due to outbox issues predating P1-02; these do not block approval of this fix.

## Documentation alignment

- Approved plan acceptance criteria and source issue requirements are satisfied by the diff.
- README §15 Cron example still shows `@Cron()` decorator pattern — explicitly out of scope per plan (defer to P3-02).
- Backlog resynchronization in `docs/agent-backlog/` is not part of P1-02 production scope.

## Remaining risks

- A tick that hangs indefinitely still blocks all future in-process ticks (pre-existing; out of scope per plan).
- `debug` lock-skip logs may be noisy in multi-replica deployments (accepted per plan).
- Narrow race window if an interval callback fires after `deleteInterval` but before `shuttingDown` is checked (mitigated by entry guard in `runTickSafely()`).

## Unverified areas

- Optional runtime V-04 scenario (`npm run start:cron` with Redis disconnect) not executed — infrastructure not required for plan sign-off; unit tests are primary evidence per approved plan.
- Lock rejection (`runWithLock` throws) not covered by a dedicated unit test; behavior follows the same `runTickSafely()` catch path as queue rejection (static inspection only).
