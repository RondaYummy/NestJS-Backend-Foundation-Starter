---
issue_id: P0-02
status: approved
owner: human-approval-required
---

# P0-02 — Не дозволяти Outbox повторно claim-ити подію під час активної публікації

## Source issue

`docs/agent-backlog/NESTJS_STARTER_KIT_REQUIRED_FIXES.md` — section **#2. Не дозволяти Outbox повторно claim-ити подію під час активної публікації** (`P0-02`).

Related verification scenario: backlog **V-04** (Outbox publish longer than lock TTL).

## Current behavior

1. `DrizzleOutboxProcessor.claimPendingBatch()` atomically claims rows with `status = 'pending'` or expired `status = 'processing'` (`lockedAt < now - lockTtlMs`).
2. On claim, `lockedAt` and `lockedBy` are set once inside a DB transaction; they are **not** refreshed during publication.
3. `processPending()` iterates claimed events and calls `publishEvent()` **outside** any DB transaction. `publishEvent()` delegates to `IDomainEventRouter.route()` with no time bound.
4. `markProcessed()` / `markFailed()` use conditional updates on `lockedBy`, but that only protects the final row transition — it does **not** prevent duplicate external side effects if another worker reclaims the row mid-flight.
5. `OutboxProcessorOptions` exposes `lockTtlMs` but no heartbeat interval or handler timeout.
6. README (§5.13) documents that handlers exceeding `lockTtlMs` may be reclaimed and recommends increasing TTL manually; no runtime lease renewal exists.

**Investigation (2026-06-18, `main`):** defect confirmed — `drizzle-outbox-processor.ts` has no `renewEventLease` or heartbeat around `publishEvent()`. Issue is **not stale**.

## Confirmed root cause

Outbox ownership is represented by a fixed `locked_at` timestamp without renewal. When `publishEvent()` (via `IDomainEventRouter.route()`) runs longer than `lockTtlMs`, a second worker treats the row as expired and reclaims it while the first worker is still publishing. `lockedBy` fencing applies only to the post-publish DB update, not to the already-started route/enqueue side effect.

## Dependency/runtime flow

```text
Cron OutboxSchedule (distributed lock)
  -> BullMQ OUTBOX queue job
       -> OutboxProcessor.process()
            -> IOutboxProcessor.processPending()  [DrizzleOutboxProcessor]
                 -> claimPendingBatch()           [TX: SELECT FOR UPDATE SKIP LOCKED + UPDATE lockedAt/lockedBy]
                 -> for each event:
                      publishEvent()              [IDomainEventRouter.route -> BullMQ enqueue / side effects]
                      markProcessed()             [conditional UPDATE on lockedBy]
                    on error:
                      markFailed()                [conditional UPDATE on lockedBy]

DI:
  WorkerModule / CronModule
    -> OutboxProcessorModule.forRootAsync({ useFactory: config.outbox })
    -> DrizzleOutboxProcessor (TOKENS.OutboxProcessor)
    -> TOKENS.OutboxProcessorOptions
    -> TOKENS.DomainEventRouter
    -> DRIZZLE_DB
```

Existing heartbeat precedents in the same codebase (reuse patterns, do not extract shared utility in this issue):

- `apps/worker/src/processors/email.processor.ts` — interval heartbeat + `ownershipLost` flag + `finally` cleanup (P0-01, implemented).
- `libs/infrastructure/src/locks/redis-distributed-lock.ts` — `extend()` + interval at `ttlMs / 3`.
- `libs/infrastructure/src/idempotency/job-execution.options.schema.ts` — cross-field validation (`heartbeat <= leaseTtl / 2`).

Recommended lease renewal SQL (from backlog):

```sql
UPDATE outbox_events
SET locked_at = now(), updated_at = now()
WHERE id = :id
  AND status = 'processing'
  AND locked_by = :workerId
```

## Goal

Prevent a second Outbox worker from reclaiming an event while the first worker is still actively publishing it, by renewing the DB lease during publication and detecting ownership loss before treating publication as successful.

## Scope

1. Add configurable `lockHeartbeatIntervalMs` and `handlerTimeoutMs` to `OutboxProcessorOptions`.
2. Implement per-event lease renewal (`renewEventLease`) in `DrizzleOutboxProcessor`.
3. Wrap `publishEvent()` with a heartbeat lifecycle and optional handler timeout; abort successful completion when ownership is lost.
4. Wire new options through env schema, defaults, and `InfrastructureConfigModule` mapping.
5. Add unit tests for lease renewal and heartbeat behavior.
6. Add PostgreSQL integration test aligned with backlog **V-04**.
7. Document new env vars in `.env.example` and minimally update README Outbox tuning notes (heartbeat + remaining at-least-once semantics).

## Out of scope

- P0-01 (email idempotency heartbeat — already implemented).
- P2-01 (Outbox BullMQ concurrency read from `process.env` in decorator metadata).
- P3-02 / broad documentation rewrite for at-least-once guarantees across the repo (only Outbox-specific note required by this issue).
- Schema migration or new DB columns (`locked_at` / `locked_by` are sufficient).
- Changing `IOutboxProcessor` public contract (`processPending()` signature stays the same).
- Extracting a shared heartbeat helper across email processor, distributed lock, and outbox processor.
- Crash window where external side effect succeeds but process dies before `markProcessed()` — documented as residual at-least-once behavior, not eliminated here.
- Worker/Cron composition root changes beyond existing `forRootAsync` config wiring.

## Files to create

| Path                                                                  | Responsibility                                                                                        |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `libs/infrastructure/src/outbox/drizzle-outbox-processor.int-spec.ts` | Integration test (V-04): two processor instances, short lock TTL, slow router, `route()` called once. |

## Files to modify

| Path                                                                     | Symbol / responsibility                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `libs/infrastructure/src/outbox/drizzle-outbox-processor.ts`             | `DrizzleOutboxProcessor` — add `renewEventLease()`; wrap publication in heartbeat + timeout (`publishEventWithLease` or equivalent); stop heartbeat in `finally`; treat heartbeat failure / timeout as publication failure without masking ownership loss as success. |
| `libs/contracts/src/outbox/outbox-processor.options.ts`                  | `OutboxProcessorOptions` — add `lockHeartbeatIntervalMs`, `handlerTimeoutMs`.                                                                                                                                                                                         |
| `libs/infrastructure/src/outbox/outbox-processor.options.schema.ts`      | Zod env fields `OUTBOX_LOCK_HEARTBEAT_INTERVAL_MS`, `OUTBOX_HANDLER_TIMEOUT_MS` (optional; computed defaults in `mapOutboxEnvToOptions` when omitted); cross-field validation (`heartbeat <= lockTtlMs / 2`, `handlerTimeoutMs >= lockTtlMs`); map into options.      |
| `libs/infrastructure/src/outbox/outbox-processor.defaults.ts`            | `OUTBOX_PROCESSOR_DEFAULT_OPTIONS` — include new fields with computed defaults from `lockTtlMs`; keep `resolveOutboxOptionsFromEnv()` compatible.                                                                                                                     |
| `libs/infrastructure/src/config/env.schema.ts`                           | Add new OUTBOX env vars and cross-field validation (mirror outbox options schema).                                                                                                                                                                                    |
| `libs/infrastructure/src/config/infrastructure-config.module.ts`         | Pass new env fields into `mapOutboxEnvToOptions()`.                                                                                                                                                                                                                   |
| `libs/infrastructure/src/outbox/drizzle-outbox-processor.spec.ts`        | Unit tests: `renewEventLease` conditional update; heartbeat invoked during slow publish; publication aborted when renewal returns false.                                                                                                                              |
| `libs/infrastructure/src/outbox/outbox-processor.options.schema.spec.ts` | Validation cases for new env vars and cross-field rules.                                                                                                                                                                                                              |
| `.env.example`                                                           | Document `OUTBOX_LOCK_HEARTBEAT_INTERVAL_MS`, `OUTBOX_HANDLER_TIMEOUT_MS` with defaults.                                                                                                                                                                              |
| `README.md`                                                              | Outbox runtime configuration section (§5.13) — document heartbeat/timeout; update `lockTtlMs` bullet to state lease is renewed during active publication; note handlers must still be idempotent (at-least-once).                                                     |

## Files to delete

None.

## Contract and DI changes

### Contract extension (options only)

```ts
export interface OutboxProcessorOptions {
  batchSize: number;
  maxAttempts: number;
  lockTtlMs: number;
  lockHeartbeatIntervalMs: number;
  handlerTimeoutMs: number;
  pollIntervalMs: number;
  cronLockTtlMs: number;
  concurrency: number;
  retryDelaySeconds: (attempt: number) => number;
}
```

`IOutboxProcessor` interface unchanged.

### DI

No new tokens. Existing `TOKENS.OutboxProcessorOptions` payload grows; `OutboxProcessorModule.forRoot` / `forRootAsync` consumers automatically receive extended options via `AppConfigService.outbox()` once env mapping is updated.

### Proposed defaults

| Field                     | Env var                             | Default                                              |
| ------------------------- | ----------------------------------- | ---------------------------------------------------- |
| `lockHeartbeatIntervalMs` | `OUTBOX_LOCK_HEARTBEAT_INTERVAL_MS` | `Math.max(Math.floor(OUTBOX_LOCK_TTL_MS / 3), 1000)` |
| `handlerTimeoutMs`        | `OUTBOX_HANDLER_TIMEOUT_MS`         | `OUTBOX_LOCK_TTL_MS`                                 |

Validation (consistent with P0-01 job execution options):

- `lockHeartbeatIntervalMs >= 1000`
- `lockHeartbeatIntervalMs <= Math.floor(lockTtlMs / 2)`
- `handlerTimeoutMs >= lockTtlMs` (timeout must not fire before lease expiry when heartbeat is healthy; allows bounded handler duration)

Compute defaults in `mapOutboxEnvToOptions()` when env vars are omitted, mirroring how derived values are handled elsewhere rather than hardcoding in Zod `.default()`.

## Implementation steps

1. **Extend options contract and env mapping**
   - Add fields to `OutboxProcessorOptions`.
   - Add optional Zod fields, computed defaults, and cross-field validation in `outbox-processor.options.schema.ts`.
   - Mirror env vars in `env.schema.ts` and `infrastructure-config.module.ts`.
   - Update `OUTBOX_PROCESSOR_DEFAULT_OPTIONS` with computed heartbeat/timeout from `lockTtlMs`.

2. **Implement lease renewal**
   - Add private `renewEventLease(eventId: string, workerId: string): Promise<boolean>` in `DrizzleOutboxProcessor`.
   - Use conditional Drizzle update: `status = 'processing'`, `locked_by = workerId`, set `locked_at = now()`, `updated_at = now()`.
   - Return `true` when exactly one row updated.

3. **Wrap publication with heartbeat and timeout**
   - Replace direct `publishEvent(event)` call with a lease-aware wrapper per claimed event.
   - Start `setInterval` at `lockHeartbeatIntervalMs` before awaiting router; call `renewEventLease`; on `false` or DB error set `ownershipLost = true` (mirror email processor / distributed lock flag pattern).
   - Use `heartbeat.unref()` so intervals do not block process exit.
   - Clear interval in `finally`.
   - Wrap `domainEventRouter.route()` in `Promise.race` against `handlerTimeoutMs`; on timeout throw a distinguishable error (e.g. `Outbox handler timeout exceeded`).
   - After publication resolves, if `ownershipLost`, throw before `markProcessed()` so existing ownership-loss handling runs (`markProcessed` failure → audit `outbox.ownershipLost`).

4. **Preserve existing failure semantics**
   - Do not change `claimPendingBatch`, `markProcessed`, or `markFailed` conditional-update logic except as needed for imports/types.
   - Ownership loss after successful route but before `markProcessed` remains the documented crash window; do not report `processed` when `markProcessed` returns false.

5. **Tests**
   - Unit: mock DB update for `renewEventLease`; verify heartbeat calls during delayed `route()`; verify publication aborts when renewal returns false.
   - Integration (`drizzle-outbox-processor.int-spec.ts`):
     - Skip gracefully if PostgreSQL unavailable (same pattern as `email.processor.int-spec.ts` with Redis).
     - Insert one `pending` outbox row.
     - Configure `lockTtlMs = 2000`, `lockHeartbeatIntervalMs = 500`, slow `route()` (~5000 ms).
     - Start `processPending()` on processor A; after ~2500 ms invoke processor B.
     - Assert `route` called **once**; row ends `processed` (not double-published / double-processed).

6. **Documentation**
   - Add env vars to `.env.example`.
   - Update README Outbox tuning bullets: heartbeat renews lease during publication; handlers must remain idempotent because at-least-once delivery persists for crash/retry windows.

## Migration and rollout concerns

- **No DB migration.** Uses existing `locked_at` / `locked_by` columns.
- **Backward compatible defaults.** Deployments without new env vars get computed defaults derived from existing `OUTBOX_LOCK_TTL_MS`.
- **Operational tuning.** Teams with handlers slower than 5 minutes should increase `OUTBOX_LOCK_TTL_MS` and/or lower `OUTBOX_LOCK_HEARTBEAT_INTERVAL_MS`; heartbeat prevents reclaim but does not remove need for reasonable TTL sizing.
- **Concurrency.** Multiple BullMQ outbox workers remain supported; heartbeat prevents duplicate reclaim of the same row, not parallel processing of different rows.

## Targeted verification

During implementation:

```bash
npm run test:unit -- libs/infrastructure/src/outbox/drizzle-outbox-processor.spec.ts
npm run test:unit -- libs/infrastructure/src/outbox/outbox-processor.options.schema.spec.ts
npm run test:int -- libs/infrastructure/src/outbox/drizzle-outbox-processor.int-spec.ts
```

Requires PostgreSQL for integration test (skip acceptable with warning when unavailable).

## Full verification

Before marking implementation complete:

```bash
npm run build
npm run lint
npm run test:unit
npm run test:int
```

Shared infrastructure / options contract touched → full `npm run build` required.

## Acceptance criteria

1. While worker A is actively publishing a claimed event, worker B cannot reclaim that event before A finishes or loses ownership, even when publication duration exceeds `lockTtlMs`.
2. `renewEventLease` uses conditional update on `id`, `status = 'processing'`, and `locked_by`.
3. Heartbeat interval and handler timeout are configurable via typed `OutboxProcessorOptions` and env vars.
4. Ownership loss during publication is not reported as successful processing (`processed` count must not increment; existing `outbox.ownershipLost` audit path remains reachable).
5. V-04 integration scenario passes when PostgreSQL is available: two processors, lock TTL 2 s, handler latency 5 s → `route()` invoked exactly once.
6. `.env.example` and README Outbox section document new settings and at-least-once semantics for downstream handlers.
7. No changes to `IOutboxProcessor` method signatures or Outbox DB schema.

## Risks

| Risk                                                                 | Mitigation                                                                                        |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Heartbeat DB load under high concurrency                             | Default interval `lockTtlMs / 3`; document tuning; batch size unchanged.                          |
| Clock skew between app and PostgreSQL                                | Same as existing `lockedAt` expiry logic; use DB `now()` in renewal UPDATE.                       |
| Handler timeout fires while route is still running                   | Timeout error triggers `markFailed` retry path; downstream handlers must be idempotent.           |
| Residual crash window after successful route, before `markProcessed` | Document as at-least-once; out of scope for this fix.                                             |
| Integration test flakiness on slow CI                                | Use generous timeouts; skip when PG unavailable; keep lock TTL / latency ratio fixed (2 s / 5 s). |

## Rollback strategy

Revert the commit. No migration rollback needed. Removing heartbeat restores prior behavior (fixed lease, duplicate reclaim possible for slow handlers).

## Open questions requiring human decision

1. **Handler timeout default:** Plan proposes `handlerTimeoutMs = lockTtlMs`. Alternative: `0` = disabled timeout, relying only on heartbeat. Confirm preferred default before implementation.
2. **Integration test database setup:** Use `DATABASE_URL` from env (like production) vs. dedicated test DB URL. Plan follows existing int-spec pattern (env-based, skip if unavailable); confirm CI provides PostgreSQL for `test:int`.
3. **README scope:** Minimal Outbox-section update only, or also add a short note to `MODULES_OVERVIEW_NON_TECH.md`? Plan keeps scope to `.env.example` + README unless human requests broader docs.
