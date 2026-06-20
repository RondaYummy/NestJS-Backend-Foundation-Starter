---
issue_id: P1-02
status: approved
owner: human-approval-required
---

# P1-02 — Add error boundary and overlap guard for Cron tick

## Source issue

`docs/agent-backlog/NESTJS_STARTER_KIT_REQUIRED_FIXES.md` — section **P1-02. Додати error boundary та overlap guard для Cron tick**.

Related verification scenario: backlog **V-04** (Cron transient Redis/BullMQ failure, no unhandled rejection, no local overlap).

## Current behavior

1. `OutboxSchedule.onModuleInit()` registers a `setInterval` callback that calls `void this.tick()` every `options.pollIntervalMs` (default `60_000` ms from `OUTBOX_PROCESSOR_DEFAULT_OPTIONS` / `AppConfigService.outbox()`).
2. `OutboxSchedule.tick()` awaits `IDistributedLock.runWithLock('cron:outbox', options.cronLockTtlMs, handler)` where the handler calls `IQueueGateway.add(QUEUES.OUTBOX, 'process-pending-outbox-events', ...)`.
3. The interval callback intentionally discards the returned promise (`void`) with no `.catch()` or `try/catch` wrapper.
4. `OutboxSchedule` does not inject `AppLogger`; failures are not logged at the schedule boundary.
5. `onModuleDestroy()` deletes the interval via `SchedulerRegistry.deleteInterval()` but does not set a shutdown flag; an in-flight interval callback may still start a new tick during teardown.
6. There is no local single-flight guard; if a tick outlasts `pollIntervalMs`, the next interval callback starts another concurrent `tick()` in the same process.
7. When `RedisDistributedLock.runWithLock()` cannot acquire the lock, it returns `null` without throwing; `tick()` ignores the return value and emits no skip log.
8. When `RedisDistributedLock.runWithLock()` rejects (Redis I/O failure on `acquire`/`release`/`extend`) or the handler rejects (`BullQueueGateway.add`), the rejection propagates to the discarded promise → potential unhandled rejection.
9. No unit tests exist for `OutboxSchedule` (no `apps/**/*.spec.ts` files in the repository).

**Investigation (2026-06-20, branch `main`, clean working tree):** defect confirmed — `apps/cron/src/schedules/outbox.schedule.ts` lines 22–24 still use `void this.tick()` without an error boundary or overlap guard. Issue is **not stale**.

## Confirmed root cause

The Cron schedule treats `tick()` as fire-and-forget. Transient failures in `IDistributedLock` or `IQueueGateway` surface as unhandled promise rejections because the `setInterval` callback neither catches errors nor routes them through structured logging. Separately, `setInterval` is time-based, not completion-based, so overlapping ticks can run concurrently within one process; the distributed lock reduces duplicate enqueue across replicas but does not replace local single-flight protection and still wastes concurrent lock/enqueue attempts.

## Dependency/runtime flow

```text
apps/cron/src/main.ts
  -> NestFactory.createApplicationContext(CronModule)
       -> CronModule
            imports: ScheduleModule.forRoot(), LoggerModule, LocksModule,
                     InfrastructureBullMqModule, OutboxProcessorModule.forRootAsync(...)
            providers: OutboxSchedule

OutboxSchedule.onModuleInit()
  -> setInterval(pollIntervalMs)
       -> void tick()                    // no catch — defect
            -> IDistributedLock.runWithLock('cron:outbox', cronLockTtlMs, handler)
                 TOKENS.DistributedLock -> RedisDistributedLock (LocksModule)
                   acquire / heartbeat extend / release (Redis via REDIS_CLIENT)
                   returns null when lock not acquired (no throw)
                   throws when handler throws or lock lost during execution
                 handler:
                   IQueueGateway.add(QUEUES.OUTBOX, 'process-pending-outbox-events', ...)
                     TOKENS.QueueGateway -> BullQueueGateway (InfrastructureBullMqModule)
                       BullMQ Queue.add() — can reject on Redis/BullMQ errors
```

**Symbols on the failure path:**

| File                                                      | Symbol                                                | Failure behavior                                      |
| --------------------------------------------------------- | ----------------------------------------------------- | ----------------------------------------------------- |
| `apps/cron/src/schedules/outbox.schedule.ts`              | `onModuleInit()`, `tick()`                            | Unhandled rejection at interval boundary              |
| `libs/infrastructure/src/locks/redis-distributed-lock.ts` | `runWithLock()`, `acquire()`, `release()`, `extend()` | Redis errors reject; lock-not-acquired returns `null` |
| `libs/infrastructure/src/bullmq/queue.gateway.ts`         | `add()`                                               | BullMQ/Redis errors reject                            |
| `libs/contracts/src/locks/distributed-lock.ts`            | `IDistributedLock.runWithLock()`                      | Contract: `Promise<T \| null>`                        |
| `libs/contracts/src/queues/queue-gateway.ts`              | `IQueueGateway.add()`                                 | Contract: `Promise<string>`                           |

## Goal

Wrap each Cron tick in a local error boundary and single-flight guard so transient Redis/BullMQ failures are logged and do not terminate the Cron process, overlapping ticks do not run concurrently in one process, shutdown suppresses new ticks, and distributed-lock skip is logged as a normal event — while preserving multi-instance protection via `IDistributedLock`.

## Scope

1. Add `runTickSafely()` wrapper with `try/catch/finally`, structured `AppLogger.error` on failure, and `tickRunning` reset in `finally`.
2. Add local `tickRunning` single-flight guard so at most one tick executes per process at a time.
3. Add `shuttingDown` flag set in `onModuleDestroy()` before interval removal; guard new ticks during shutdown.
4. Route interval callback through `void this.runTickSafely()` instead of `void this.tick()`.
5. In `tick()`, inspect `runWithLock` return value; when `null`, emit a low-noise skip log (distributed lock not acquired).
6. Inject `AppLogger` into `OutboxSchedule` (LoggerModule already imported by `CronModule`).
7. Add unit tests for error boundary, overlap guard, shutdown guard, and lock-skip logging (**V-04**).

## Out of scope

- Changes to `IDistributedLock`, `RedisDistributedLock`, `IQueueGateway`, or `BullQueueGateway` implementations.
- Changes to `CronModule` provider registrations (unless DI resolution fails without module edits — not expected).
- New Cron schedules beyond `OutboxSchedule`.
- Replacing `setInterval` with `@Cron()` decorator or external scheduler.
- BullMQ graceful shutdown (**V-15**) or Outbox processor lease/heartbeat behavior (**P0-02 / R-02**).
- Integration tests requiring live Redis/BullMQ (optional manual **V-04** runtime scenario; unit tests are primary evidence).
- README or backlog index updates (unless human requests doc sync).

## Files to create

| Path                                              | Responsibility                                                                                                                           |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/cron/src/schedules/outbox.schedule.spec.ts` | Unit tests: unhandled-rejection prevention, overlap guard, shutdown guard, lock-not-acquired skip log, post-failure recovery (**V-04**). |

## Files to modify

| Path                                         | Symbol / responsibility                                                                                                                                                                                                                                                                                     |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/cron/src/schedules/outbox.schedule.ts` | `OutboxSchedule` — add private fields `tickRunning`, `shuttingDown`; inject `AppLogger`; add private `runTickSafely()`; update `onModuleInit()` to call `runTickSafely`; update `onModuleDestroy()` to set `shuttingDown`; update `tick()` to log lock-not-acquired skip when `runWithLock` returns `null`. |

## Files to delete

None.

## Contract and DI changes

### Contracts (unchanged)

```ts
// libs/contracts/src/locks/distributed-lock.ts
runWithLock<T>(key: string, ttlMs: number, handler: () => Promise<T>): Promise<T | null>;

// libs/contracts/src/queues/queue-gateway.ts
add(...): Promise<string>;

// libs/contracts/src/outbox/outbox-processor.options.ts
pollIntervalMs: number;
cronLockTtlMs: number;
```

No token changes. `TOKENS.DistributedLock`, `TOKENS.QueueGateway`, `TOKENS.OutboxProcessorOptions` registrations remain in `LocksModule`, `InfrastructureBullMqModule`, and `OutboxProcessorModule` respectively.

### DI (constructor injection only)

`OutboxSchedule` constructor gains `private readonly logger: AppLogger`. `LoggerModule` is already imported in `apps/cron/src/cron.module.ts`; no module provider changes expected.

### Logging API alignment

Use existing `AppLogger` signature (not the backlog pseudocode order):

```ts
this.logger.error('Outbox cron tick failed', error);
this.logger.debug('Outbox cron tick skipped; distributed lock not acquired', {
  lockKey: 'cron:outbox',
});
```

Match patterns from `DrizzleOutboxProcessor` (`error(message, error, context)`) and `EmailProcessor` (`warn(message, context)`).

## Implementation steps

1. **Add lifecycle state fields to `OutboxSchedule`**
   - `private tickRunning = false;`
   - `private shuttingDown = false;`

2. **Inject `AppLogger`**
   - Add `private readonly logger: AppLogger` to constructor.
   - No `CronModule` edits unless Nest DI resolution fails at implementation time.

3. **Implement `runTickSafely()`**
   - Early return when `this.shuttingDown || this.tickRunning`.
   - Set `tickRunning = true` before `await this.tick()`.
   - `try/catch`: on error, `this.logger.error('Outbox cron tick failed', error)` — do not rethrow.
   - `finally`: `tickRunning = false`.
   - Return type `Promise<void>`.

4. **Update `onModuleInit()`**
   - Replace `void this.tick()` with `void this.runTickSafely()` inside `setInterval` callback.
   - Keep `schedulerRegistry.addInterval(OUTBOX_SCHEDULE_INTERVAL_NAME, interval)`.

5. **Update `onModuleDestroy()`**
   - Set `this.shuttingDown = true` before `schedulerRegistry.deleteInterval(OUTBOX_SCHEDULE_INTERVAL_NAME)`.

6. **Enhance `tick()` lock-skip observability**
   - Capture result: `const result = await this.lock.runWithLock(...)`.
   - When `result === null`, log `this.logger.debug('Outbox cron tick skipped; distributed lock not acquired', { lockKey: 'cron:outbox' })`.
   - Do not throw on lock miss (preserves current non-fatal behavior).

7. **Add unit tests (`outbox.schedule.spec.ts`)**
   - Construct `OutboxSchedule` with mocked `IQueueGateway`, `IDistributedLock`, `OutboxProcessorOptions`, `SchedulerRegistry`, and `AppLogger` (mirror `drizzle-outbox-processor.spec.ts` direct-instantiation style).
   - Access `runTickSafely` in tests via typed private access helper (e.g. `(schedule as unknown as { runTickSafely(): Promise<void> }).runTickSafely()`).
   - **Error boundary:** mock `tick` path so `queues.add` rejects; assert `logger.error` called, `tickRunning` false after settle, no thrown error from `runTickSafely`, second `runTickSafely` call proceeds.
   - **Overlap guard:** start slow `tick` (deferred promise), invoke second `runTickSafely` while first in-flight; assert handler/`queues.add` invoked once.
   - **Shutdown guard:** set `shuttingDown` true (via `onModuleDestroy` or direct field); assert `runTickSafely` does not call `tick`/enqueue.
   - **Lock skip:** mock `runWithLock` resolving `null`; assert `logger.debug` called and no `queues.add`.
   - **Interval wiring (optional):** `jest.useFakeTimers()`, call `onModuleInit`, advance timers, assert `runTickSafely` path exercised via spies.

8. **Keep `tick()` public**
   - Preserve `tick()` as the lock/enqueue unit under test; do not narrow visibility unless tests require it.

## Migration and rollout concerns

- **No DB migration.**
- **No env migration.**
- **Behavior change (intended):** Cron process survives transient Redis/BullMQ tick failures instead of risking process exit via unhandled rejection.
- **Behavior change (intended):** Local overlap suppressed — if a tick is still running when the next interval fires, the new callback returns immediately (may slightly delay enqueue until the following interval).
- **Observability:** New `debug` log on lock miss may increase log volume in multi-replica deployments; severity is intentionally low.
- **Multi-instance:** Distributed lock remains authoritative for cross-replica exclusion; local guard is additive.
- **Default timing:** `pollIntervalMs` (60s) vs `cronLockTtlMs` (55s) — local guard prevents same-process overlap; replicas still coordinate via Redis lock.

## Targeted verification

During implementation:

```bash
npm run test:unit -- apps/cron/src/schedules/outbox.schedule.spec.ts
npm run build:cron
```

## Full verification

Before marking implementation complete:

```bash
npm run build
npm run lint
npm run test:unit
```

Cron entrypoint change → `npm run build:cron` minimum; full `npm run build` required per project rules for shared-infrastructure-adjacent verification.

**Optional runtime check (infrastructure permitting):**

```bash
npm run start:cron
```

Simulate Redis disconnect during tick; confirm process stays alive and structured error log appears. Record as **V-04** verification report if executed.

**V-04 verification report (post-implementation):**

| Field            | Value                                                                                                                              |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Issue ID         | V-04                                                                                                                               |
| Command/scenario | `npm run test:unit -- apps/cron/src/schedules/outbox.schedule.spec.ts` — rejection swallowed, overlap blocked, shutdown suppressed |
| Expected result  | No unhandled rejection; `logger.error` on failure; single in-flight tick per process; `logger.debug` on lock miss                  |
| Evidence         | Jest output + test names                                                                                                           |

## Acceptance criteria

1. Rejected lock/queue calls inside a tick do not produce unhandled promise rejections at the `setInterval` boundary.
2. Cron process remains alive after transient tick failures; the next interval tick still executes.
3. At most one `tick()` runs concurrently within a single Cron process (`tickRunning` guard).
4. Multi-instance protection continues to rely on `IDistributedLock.runWithLock('cron:outbox', ...)`.
5. Lock-not-acquired (`runWithLock` returns `null`) is logged as a normal skip at `debug` level without throwing.
6. `onModuleDestroy()` prevents new ticks from starting (`shuttingDown` guard) while clearing the registered interval.
7. `npm run lint`, `npm run build` (or `npm run build:cron`), and targeted unit tests pass.
8. **V-04** scenarios are covered by `outbox.schedule.spec.ts`.

## Risks

| Risk                                                                          | Mitigation                                                                                                           |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Local guard skips interval callbacks while a slow tick runs, delaying enqueue | Acceptable trade-off per issue; distributed lock still prevents duplicate cross-replica work; next interval retries. |
| `debug` lock-skip logs too noisy with many replicas                           | Use `debug` not `warn`/`error`; human may tune log level in production.                                              |
| Tick hangs indefinitely blocks all future ticks in-process                    | Pre-existing risk; out of scope — would need timeout/cancellation (not in P1-02).                                    |
| `shuttingDown` set after interval fires but before callback runs              | Narrow race window; `shuttingDown` checked at `runTickSafely` entry minimizes stray ticks during shutdown.           |
| Private-method unit testing coupling                                          | Acceptable for schedule boundary tests; keep assertions on observable side effects (logger, queue calls).            |
| AppLogger `error` signature mismatch with backlog pseudocode                  | Follow `AppLogger.error(message, error, context?)` per existing codebase.                                            |

## Rollback strategy

Revert the commit touching `outbox.schedule.ts` and delete `outbox.schedule.spec.ts`. Cron returns to fire-and-forget `void this.tick()` behavior (re-opens unhandled-rejection and overlap risk). No migration rollback needed.

## Open questions requiring human decision

1. **Lock-skip log level:** Confirm `debug` vs `info` for `distributed lock not acquired` in multi-replica deployments.
2. **Lock-skip log message/key:** Use static `lockKey: 'cron:outbox'` or include `cronLockTtlMs` / `pollIntervalMs` for operability?
3. **Unit test private access:** Approve testing `runTickSafely` via typed private accessor vs. only interval/fake-timer integration-style tests?
4. **Optional V-04 runtime evidence:** Is live Redis failure simulation required for verification sign-off, or are unit tests sufficient?
5. **README sync:** Update README §15 Cron example (still shows `@Cron()` decorator pattern) in this fix or defer to **P3-02**?
