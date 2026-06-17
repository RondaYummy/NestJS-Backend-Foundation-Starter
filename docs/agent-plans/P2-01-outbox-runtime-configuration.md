---
issue_id: P2-01
status: approved
owner: human-approval-required
---

# P2-01 — Move Outbox runtime constants to typed configuration

## Source issue

Backlog section: `docs/agent-backlog/NESTJS_STARTER_KIT_REQUIRED_FIXES.md` → `## 9. Винести Outbox runtime constants у typed configuration` (indexed as `P2-01` in `docs/agent-backlog/INDEX.md`).

**Classification:** Production risk (P2 / Medium).

## Current behavior

### Hardcoded processor policy (`DrizzleOutboxProcessor`)

| Constant / formula | Value                                        | Lines                                                            | Usage                                                                                                                       |
| ------------------ | -------------------------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `MAX_ATTEMPTS`     | `10`                                         | `libs/infrastructure/src/outbox/drizzle-outbox-processor.ts:16`  | Claim filter (`attempts <= MAX_ATTEMPTS - 1`, line 121); permanent failure threshold (`attempts >= MAX_ATTEMPTS`, line 205) |
| `BATCH_SIZE`       | `50`                                         | `libs/infrastructure/src/outbox/drizzle-outbox-processor.ts:17`  | `.limit(BATCH_SIZE)` in `claimPendingBatch()` (line 137)                                                                    |
| `LOCK_TTL_MS`      | `5 * 60 * 1000` (300_000 ms)                 | `libs/infrastructure/src/outbox/drizzle-outbox-processor.ts:18`  | Expired-lock reclaim window (`expiredLockAt`, lines 112–129)                                                                |
| Retry backoff      | `Math.min(2 ** attempts * 30, 3600)` seconds | `libs/infrastructure/src/outbox/drizzle-outbox-processor.ts:203` | `availableAt` delay in `markFailed()` (line 215)                                                                            |

No other magic numbers exist in this file (error message truncation at 5000 chars is a storage limit, not a runtime policy).

### Hardcoded scheduling policy (`OutboxSchedule`)

| Constant             | Value                                                    | Lines                                           | Usage                                            |
| -------------------- | -------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------ |
| Cron expression      | `CronExpression.EVERY_MINUTE` (~60_000 ms poll interval) | `apps/cron/src/schedules/outbox.schedule.ts:15` | Enqueue cadence                                  |
| Distributed lock TTL | `55_000` ms                                              | `apps/cron/src/schedules/outbox.schedule.ts:16` | `IDistributedLock.runWithLock('cron:outbox', …)` |

### Hardcoded / implicit worker policy (`OutboxProcessor`)

| Policy                | Current value                               | Location                                                                                                 |
| --------------------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| BullMQ concurrency    | `1` (framework default; not set explicitly) | `apps/worker/src/processors/outbox.processor.ts:9` — `@Processor(QUEUES.OUTBOX)` with no second argument |
| Handler / job timeout | Not configured                              | No BullMQ `timeout` on outbox job enqueue (`apps/cron/src/schedules/outbox.schedule.ts:17–25`)           |

### Module wiring today

| File                                                        | Role                                                                                                  |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `libs/infrastructure/src/outbox/outbox-processor.module.ts` | Static `@Module`; registers `DrizzleOutboxProcessor` → `TOKENS.OutboxProcessor`; no options           |
| `apps/worker/src/worker.module.ts`                          | Composition root: imports static `OutboxProcessorModule`, registers `OutboxProcessor` BullMQ consumer |
| `apps/cron/src/cron.module.ts`                              | Composition root: registers `OutboxSchedule`; does **not** import `OutboxProcessorModule`             |
| `apps/api/src/composition/auth-application.module.ts`       | Imports `OutboxWriterModule` only (write path); no processor                                          |
| `libs/infrastructure/src/infrastructure.module.ts`          | Barrel import/export of static `OutboxProcessorModule` (not used by entrypoint apps)                  |

### Existing config patterns (alignment targets)

| Pattern                    | Location                                                               | Relevance                                                                                   |
| -------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Zod env validation         | `libs/infrastructure/src/config/env.schema.ts`                         | All env-backed policy (e.g. `BULLMQ_DEFAULT_ATTEMPTS`, `RATE_LIMIT_TTL`)                    |
| Typed config accessor      | `libs/infrastructure/src/config/app-config.service.ts`                 | `bullmq()`, `rateLimit()`, etc.                                                             |
| Config bootstrap           | `libs/infrastructure/src/config/infrastructure-config.module.ts`       | Maps validated env → nested config object                                                   |
| DI tokens                  | `libs/contracts/src/tokens.ts`                                         | Provider-neutral symbols (`TOKENS.OutboxProcessor` exists; no options token yet)            |
| `forRoot` / `forRootAsync` | Only `ConfigModule`, `BullModule`, `ScheduleModule`, `JwtModule` today | P1-01 backlog item not yet implemented; P2-01 can pilot typed module config for Outbox only |

### Search: `OUTBOX_PROCESSOR_OPTIONS`

**Not present** in the codebase. Grep finds the symbol only in the backlog document. `libs/contracts/src/outbox/outbox-processor.ts` defines only `IOutboxProcessor` and `ProcessOutboxResult`.

### Tests

No unit or integration tests exist for outbox processor behavior (`drizzle-outbox-processor`, `outbox.processor`, `outbox.schedule`).

## Confirmed root cause

Outbox runtime policy (batch size, retry limits, lock lease, backoff, poll cadence, worker concurrency) is embedded as module-level constants or implicit framework defaults. Consumers cannot tune behavior at the composition root without editing infrastructure internals. This violates the starter kit portability rule (` .cursor/rules/20-module-portability.mdc`: TTLs, retry policies, concurrency must be configurable).

**Issue status:** **Still valid** on current branch (clean working tree at planning time). Constants remain at `drizzle-outbox-processor.ts:16–18` and `drizzle-outbox-processor.ts:203`; no `OutboxProcessorOptions` contract or env vars exist.

## Dependency/runtime flow

```text
API (OutboxWriter only)
  RegisterUseCase
    -> IOutboxWriter.append() in same DB transaction
      -> outbox_events row (status=pending)

Cron (OutboxSchedule)                         Worker (OutboxProcessor)
  EVERY_MINUTE + lock 55s                         @Processor(QUEUES.OUTBOX) concurrency=1
    -> IQueueGateway.add(OUTBOX, ...)               -> IOutboxProcessor.processPending()
                                                          -> DrizzleOutboxProcessor
                                                            -> claimPendingBatch (BATCH_SIZE, LOCK_TTL_MS, MAX_ATTEMPTS)
                                                            -> IDomainEventRouter.route() per event
                                                            -> markProcessed / markFailed (backoff, MAX_ATTEMPTS)
```

Lock TTL in the processor governs reclaim of stuck `processing` rows. Cron lock TTL governs single-cron-leader enqueueing. Worker concurrency governs how many BullMQ outbox jobs run in parallel (each job processes one batch of up to `batchSize` events sequentially).

## Goal

Expose all outbox runtime policy through a typed, validated options contract injected at composition roots, with safe defaults matching current behavior, and document how batch size, concurrency, handler duration, and lock TTL interact.

## Scope

1. Add `OutboxProcessorOptions` contract and `TOKENS.OutboxProcessorOptions` in `libs/contracts`.
2. Add env-backed defaults + Zod validation in infrastructure config (`env.schema`, `infrastructure-config.module`, `app-config.service`).
3. Convert `OutboxProcessorModule` to a dynamic module (`forRoot` / `forRootAsync`) that provides `TOKENS.OutboxProcessorOptions`.
4. Inject options into `DrizzleOutboxProcessor`; remove file-level constants.
5. Inject options into `OutboxSchedule` for poll interval and cron lock TTL.
6. Wire worker concurrency from the same options source.
7. Document tuning guidance in `README.md` (relationship between batch size, concurrency, handler timeout, lock TTL).
8. Update `.env.example` with new variables.
9. Add targeted unit tests for options validation and processor option usage (recommended).

## Out of scope

- P1-01 generic `forRoot` rollout for Redis, Drizzle, Mail, Auth, etc.
- Outbox writer changes (`DrizzleOutboxWriter`, `OutboxWriterModule`).
- BullMQ job-level timeout configuration (no timeout exists today; document relationship only unless human approves adding `timeout` to enqueue options).
- PostgreSQL schema / migration changes.
- `InfrastructureModule` barrel refactor (unused by entrypoints).
- `MODULES_OVERVIEW_NON_TECH.md` / `EXAMPLES.md` alignment (unless human expands scope; README is explicitly required by acceptance criteria).

## Files to create

| Path                                                                     | Purpose                                                                                                                          |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| `libs/contracts/src/outbox/outbox-processor.options.ts`                  | `OutboxProcessorOptions` interface; export `defaultRetryDelaySeconds(attempt: number)` helper signature or document factory type |
| `libs/infrastructure/src/outbox/outbox-processor.defaults.ts`            | Canonical safe defaults matching current behavior; default `retryDelaySeconds` implementation                                    |
| `libs/infrastructure/src/outbox/outbox-processor.options.schema.ts`      | Zod schema for env → options mapping and cross-field sanity checks                                                               |
| `libs/infrastructure/src/outbox/drizzle-outbox-processor.spec.ts`        | Unit tests: options injected into claim/fail paths (mock DB + router)                                                            |
| `libs/infrastructure/src/outbox/outbox-processor.options.schema.spec.ts` | Unit tests: validation rejects invalid combinations                                                                              |

## Files to modify

| Path                                                             | Symbol / responsibility                                                                                                                                                        |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `libs/contracts/src/tokens.ts`                                   | Add `OutboxProcessorOptions: Symbol('OutboxProcessorOptions')`                                                                                                                 |
| `libs/infrastructure/src/outbox/drizzle-outbox-processor.ts`     | Inject `TOKENS.OutboxProcessorOptions`; replace `MAX_ATTEMPTS`, `BATCH_SIZE`, `LOCK_TTL_MS`, inline backoff                                                                    |
| `libs/infrastructure/src/outbox/outbox-processor.module.ts`      | `ConfigurableModuleBuilder` → `forRoot` / `forRootAsync`; provide `TOKENS.OutboxProcessorOptions` + existing `TOKENS.OutboxProcessor`                                          |
| `libs/infrastructure/src/config/env.schema.ts`                   | Add `OUTBOX_*` env keys with defaults                                                                                                                                          |
| `libs/infrastructure/src/config/infrastructure-config.module.ts` | Map `outbox` section from validated env                                                                                                                                        |
| `libs/infrastructure/src/config/app-config.service.ts`           | Add `outbox(): OutboxProcessorOptions` (or mapped shape) to `ConfigShape`                                                                                                      |
| `apps/worker/src/worker.module.ts`                               | `OutboxProcessorModule.forRootAsync({ inject: [AppConfigService], useFactory: (c) => c.outbox() })`; import `InfrastructureConfigModule` if not already transitively available |
| `apps/worker/src/processors/outbox.processor.ts`                 | Pass `concurrency` from options (see Contract and DI changes)                                                                                                                  |
| `apps/cron/src/schedules/outbox.schedule.ts`                     | Replace hardcoded cron/lock with injected options; dynamic scheduling if decorator cannot read DI                                                                              |
| `apps/cron/src/cron.module.ts`                                   | Import `OutboxProcessorModule.forRootAsync(...)` **or** lightweight options-only provider shared with worker                                                                   |
| `libs/infrastructure/src/infrastructure.module.ts`               | Replace static `OutboxProcessorModule` import with `OutboxProcessorModule.forRoot()` using defaults (keeps barrel functional)                                                  |
| `.env.example`                                                   | Document new `OUTBOX_*` variables                                                                                                                                              |
| `README.md`                                                      | New subsection under Outbox Module: tuning `batchSize`, `concurrency`, handler duration, `lockTtlMs`, `pollIntervalMs`, cron lock                                              |

## Files to delete

None.

## Contract and DI changes

### New contract (`libs/contracts/src/outbox/outbox-processor.options.ts`)

Proposed interface (aligned with backlog, slightly extended for cron lock):

```ts
export interface OutboxProcessorOptions {
  batchSize: number;
  maxAttempts: number;
  lockTtlMs: number;
  pollIntervalMs: number;
  cronLockTtlMs: number;
  concurrency: number;
  retryDelaySeconds: (attempt: number) => number;
}
```

Add to `libs/contracts/src/tokens.ts`:

```ts
OutboxProcessorOptions: Symbol('OutboxProcessorOptions'),
```

`IOutboxProcessor` interface remains unchanged.

### Module registration

```ts
OutboxProcessorModule.forRoot(options?: OutboxProcessorOptions)
OutboxProcessorModule.forRootAsync({
  imports?: [...],
  inject?: [...],
  useFactory: (...args) => OutboxProcessorOptions,
})
```

Default path (`forRoot()` with no args) must resolve to the same values as today.

### Composition roots

| Entrypoint                                         | Registration                                                                                                                      |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `apps/worker/src/worker.module.ts`                 | `OutboxProcessorModule.forRootAsync` from `AppConfigService.outbox()`                                                             |
| `apps/cron/src/cron.module.ts`                     | Same options factory (cron needs `pollIntervalMs`, `cronLockTtlMs`; worker needs `concurrency`; processor needs batch/lock/retry) |
| `libs/infrastructure/src/infrastructure.module.ts` | `OutboxProcessorModule.forRoot()` with defaults                                                                                   |

### Concurrency wiring (requires human choice)

`@Processor(QUEUES.OUTBOX)` decorator metadata is evaluated at class definition time; it cannot read Nest DI directly.

**Recommended default approach:** export `buildOutboxProcessorDecoratorOptions()` from `libs/infrastructure/src/outbox/outbox-processor.defaults.ts` that reads the same validated env defaults used by `forRootAsync`, and use:

```ts
@Processor(QUEUES.OUTBOX, buildOutboxProcessorDecoratorOptions())
```

Composition root remains env + `forRootAsync` for injectable services; decorator path shares the same default source. Document that changing concurrency at runtime via custom `forRoot` overrides requires also aligning the decorator helper (or adopt programmatic worker registration — see open questions).

### Cron interval wiring

Replace `@Cron(CronExpression.EVERY_MINUTE)` with either:

- `@Interval(pollIntervalMs)` backed by a static helper mirroring env defaults (same decorator limitation), **or**
- `OnModuleInit` + `SchedulerRegistry` + `CronJob` using injected `TOKENS.OutboxProcessorOptions` (fully DI-driven; preferred for consistency).

## Implementation steps

1. **Contracts** — Add `outbox-processor.options.ts` and `TOKENS.OutboxProcessorOptions`.
2. **Defaults + schema** — Implement `outbox-processor.defaults.ts` and `outbox-processor.options.schema.ts` with defaults: `batchSize=50`, `maxAttempts=10`, `lockTtlMs=300000`, `pollIntervalMs=60000`, `cronLockTtlMs=55000`, `concurrency=1`, `retryDelaySeconds(attempt) => Math.min(2 ** attempt * 30, 3600)`.
3. **Env integration** — Add env keys; extend `env.schema`, `infrastructure-config.module`, `app-config.service` with `outbox()` accessor. Add `superRefine` rules, e.g. `cronLockTtlMs < pollIntervalMs`, `batchSize >= 1`, `maxAttempts >= 1`, `lockTtlMs >= 1000`.
4. **Dynamic module** — Refactor `OutboxProcessorModule` with `ConfigurableModuleBuilder`; export `forRoot` / `forRootAsync`.
5. **Processor adapter** — Update `DrizzleOutboxProcessor` to inject options; remove constants at lines 16–18 and 203.
6. **Worker composition** — Update `worker.module.ts` to `forRootAsync`; wire `@Processor` concurrency per chosen approach.
7. **Cron composition** — Update `cron.module.ts` and `outbox.schedule.ts` to use injected `pollIntervalMs` and `cronLockTtlMs`.
8. **Barrel module** — Update `infrastructure.module.ts` to `OutboxProcessorModule.forRoot()`.
9. **Documentation** — README subsection on tuning relationships; `.env.example` entries.
10. **Tests** — Add schema and processor unit tests.

## Migration and rollout concerns

- **Backward compatible defaults:** Existing deployments behave identically when new env vars are omitted.
- **No DB migration.**
- **Cron scheduling change:** Switching from `@Cron(EVERY_MINUTE)` to `@Interval` or dynamic `SchedulerRegistry` must preserve ~60s cadence by default; verify cron entrypoint after change.
- **Dual composition roots:** Worker and Cron must use the same options factory to avoid worker/cron policy drift.

## Targeted verification

```bash
npm run build
npx jest libs/infrastructure/src/outbox/outbox-processor.options.schema.spec.ts --config jest.unit.config.ts
npx jest libs/infrastructure/src/outbox/drizzle-outbox-processor.spec.ts --config jest.unit.config.ts
```

## Full verification

```bash
npm run build
npm run build:worker
npm run build:cron
npm run lint
npm run test:unit
```

Runtime (when PostgreSQL + Redis available):

```bash
npm run start:worker   # confirm BullMQ outbox consumer starts with configured concurrency
npm run start:cron     # confirm outbox schedule enqueues on configured interval
```

Record: command, result, conclusion.

## Acceptance criteria

| Criterion                                                          | Verification                                                                                                     |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| All runtime policy values set by composition root                  | `worker.module.ts` and `cron.module.ts` use `forRootAsync`; no policy constants in `drizzle-outbox-processor.ts` |
| Safe defaults exist                                                | `forRoot()` without args + env schema defaults match pre-change behavior                                         |
| Values validated                                                   | Zod schema rejects invalid env; unit tests cover edge cases                                                      |
| README explains batch size, concurrency, handler timeout, lock TTL | New README subsection under Outbox Module                                                                        |

## Risks

| Risk                                                                         | Mitigation                                                                                                             |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `@Processor` concurrency not truly DI-driven                                 | Share single defaults module with env schema; document limitation; consider programmatic registration in open question |
| Cron refactor changes timing semantics                                       | Default `pollIntervalMs=60000`; integration smoke test on cron bootstrap                                               |
| `cronLockTtlMs` vs `pollIntervalMs` mismatch causes overlapping cron leaders | Validate `cronLockTtlMs < pollIntervalMs` in schema                                                                    |
| `lockTtlMs` shorter than handler duration causes duplicate processing        | Document in README; optional schema warning when `lockTtlMs` below configurable handler timeout                        |
| `InfrastructureModule.forRoot()` diverges from app-specific overrides        | Barrel uses defaults only; entrypoints own real policy via `forRootAsync`                                              |

## Rollback strategy

Revert the PR. No migrations. Remove `OUTBOX_*` env vars (optional; defaults apply). Static constants restoration in `drizzle-outbox-processor.ts` fully restores prior behavior.

## Open questions requiring human decision

1. **Concurrency wiring:** Accept env-backed decorator helper (pragmatic) vs. programmatic BullMQ worker registration (fully DI-driven, larger diff)?
2. **Unified vs. split options:** Single `OutboxProcessorOptions` for cron + worker + processor (backlog suggestion) vs. separate `OutboxSchedulingOptions` / `OutboxWorkerOptions` tokens?
3. **Cron scheduling mechanism:** `@Interval` + static helper vs. `SchedulerRegistry` + `OnModuleInit` (DI-pure)?
4. **Backoff configurability:** Env-tunable `retryBaseDelaySeconds` / `retryMaxDelaySeconds` only, or expose full `retryDelaySeconds(attempt)` factory in `forRoot`?
5. **Handler timeout:** Document-only for P2-01, or add BullMQ job `timeout` aligned with `lockTtlMs`?
6. **Lightweight cron import:** Should cron import full `OutboxProcessorModule` (pulls Drizzle, Events, Audit) or a new `OutboxOptionsModule` that only provides `TOKENS.OutboxProcessorOptions`?
