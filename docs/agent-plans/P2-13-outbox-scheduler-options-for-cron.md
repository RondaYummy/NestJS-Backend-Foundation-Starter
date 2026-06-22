---
issue_id: P2-13
status: approved
owner: human-approval-required
---

# P2-13 — Extract Outbox scheduler options from `OutboxProcessorModule` for Cron

## Source issue

`docs/agent-backlog/NESTJS_STARTER_KIT_REQUIRED_FIXES.md` — section **P2-13. Винести Outbox scheduler options із `OutboxProcessorModule` для Cron**.

Backlog index: `docs/agent-backlog/INDEX.md` (`P2-13`).

**Investigation (2026-06-22, current branch):** defect confirmed. Issue is **not stale**. Only backlog doc edits are unstaged; production code matches the issue description.

## Current behavior

`CronModule` (`apps/cron/src/cron.module.ts`) imports the full outbox processor stack:

- `DrizzleModule.forRootAsync(...)` — opens a PostgreSQL pool at bootstrap.
- `OutboxProcessorModule.forRootAsync({ imports: [InfrastructureConfigModule, drizzleModule, bullMqQueuesModule], ... })` — registers `TOKENS.OutboxProcessorOptions` **and** instantiates `DrizzleOutboxProcessor`, `AuditModule`, and `EventsModule` (including `UserRegisteredEventHandler` → `IQueueGateway`).

`OutboxSchedule` (`apps/cron/src/schedules/outbox.schedule.ts`) is a thin scheduler. It injects:

| Token                           | Used?                                           |
| ------------------------------- | ----------------------------------------------- |
| `TOKENS.QueueGateway`           | Yes — `queues.add(QUEUES.OUTBOX, ...)`          |
| `TOKENS.DistributedLock`        | Yes — `lock.runWithLock('cron:outbox', ...)`    |
| `TOKENS.OutboxProcessorOptions` | Yes — only `pollIntervalMs` and `cronLockTtlMs` |
| `TOKENS.OutboxProcessor`        | **No**                                          |
| `DRIZZLE_DB` / outbox table     | **No**                                          |

`WorkerModule` (`apps/worker/src/worker.module.ts`) correctly imports `OutboxProcessorModule.forRootAsync(...)` plus `outboxProcessorProvider` because it actually consumes `TOKENS.OutboxProcessor` and performs DB reads/writes.

`OutboxProcessorModule` (`libs/infrastructure/src/outbox/outbox-processor.module.ts`) uses `ConfigurableModuleBuilder<OutboxProcessorOptions>` with `optionsInjectionToken: TOKENS.OutboxProcessorOptions`. Its `buildFeatureImports()` adds `AuditModule`, `EventsModule`, and `LoggerModule` on top of caller-supplied `connectionImports` (Drizzle, BullMQ queues).

## Confirmed root cause

Cron’s composition root imports **`OutboxProcessorModule`** solely to obtain **`TOKENS.OutboxProcessorOptions`**. That couples the Cron entrypoint to:

1. PostgreSQL (`DrizzleModule` + `DrizzleOutboxProcessor`).
2. Outbox event-routing infrastructure (`EventsModule`, `AuditModule`).
3. Unnecessary BullMQ queue visibility passed into processor `imports` for transitive `EventsModule` handlers.

This is an architectural coupling issue (multi-entrypoint minimality / portability), not a proven runtime bug. Cron’s actual responsibility is: acquire a distributed lock, enqueue an outbox processing job on a timer.

## Dependency/runtime flow

### Current (problematic)

```text
CronModule
  ├─ DrizzleModule.forRootAsync()           → PG pool + DRIZZLE_DB
  ├─ RedisModule + LocksModule              → TOKENS.DistributedLock
  ├─ InfrastructureBullMqModule             → TOKENS.QueueGateway (OUTBOX queue)
  └─ OutboxProcessorModule.forRootAsync()
       ├─ TOKENS.OutboxProcessorOptions      ← only thing OutboxSchedule needs
       ├─ DrizzleOutboxProcessor              ← unused by Cron
       ├─ AuditModule
       └─ EventsModule
            └─ UserRegisteredEventHandler   → IQueueGateway (transitive)

OutboxSchedule
  → pollIntervalMs / cronLockTtlMs
  → lock.runWithLock('cron:outbox', ...)
  → queues.add(QUEUES.OUTBOX, 'process-pending-outbox-events', ...)
```

### Target

```text
CronModule
  ├─ OutboxProcessorOptionsModule.forRootAsync()  → TOKENS.OutboxProcessorOptions only
  ├─ RedisModule + LocksModule
  └─ InfrastructureBullMqModule (OUTBOX queue only)

OutboxSchedule  → unchanged injection surface

WorkerModule
  └─ OutboxProcessorModule.forRootAsync()         → full processor stack (unchanged)
       └─ composes OutboxProcessorOptionsModule internally
```

## Goal

Decouple Cron from the outbox DB processor stack while preserving the same typed `OutboxProcessorOptions` contract at the composition boundary. Worker remains the sole entrypoint that imports the actual outbox processor.

## Scope

1. Create a lightweight `OutboxProcessorOptionsModule` that registers only `TOKENS.OutboxProcessorOptions` via `ConfigurableModuleBuilder`.
2. Refactor `OutboxProcessorModule` to compose `OutboxProcessorOptionsModule` internally so Worker call sites stay unchanged.
3. Slim `CronModule` to scheduler-only imports (remove `DrizzleModule` and `OutboxProcessorModule`).
4. Add unit/DI tests for the new options module and Cron composition.
5. Update `README.md` to describe Cron as a thin enqueue scheduler and document the split between options module (Cron) and processor module (Worker).

## Out of scope

- Splitting `envSchema` / making `DATABASE_URL` optional for Cron (`InfrastructureConfigModule` still validates full env today).
- Changes to `OutboxSchedule` behavior, queue payload, or lock key semantics.
- Worker processor logic, BullMQ concurrency, or outbox retry policy (covered by other issues).
- `InfrastructureModule` deprecated facade refactor (unless human approves in open questions).
- Renaming `OutboxProcessorOptions` contract fields or `TOKENS.OutboxProcessorOptions`.
- API or Migrations entrypoint changes.

## Files to create

| File                                                                     | Symbol / responsibility                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `libs/infrastructure/src/outbox/outbox-processor-options.module.ts`      | `OutboxProcessorOptionsModule` — `ConfigurableModuleBuilder<OutboxProcessorOptions>` with `optionsInjectionToken: TOKENS.OutboxProcessorOptions`; `forRoot` / `forRootAsync`; `global: false`; exports `TOKENS.OutboxProcessorOptions` only; re-export `OUTBOX_PROCESSOR_OPTIONS_MODULE_OPTIONS_TOKEN` (or equivalent `MODULE_OPTIONS_TOKEN` alias) |
| `libs/infrastructure/src/outbox/outbox-processor-options.module.spec.ts` | Isolated Nest test: options token resolves via `forRoot(OUTBOX_PROCESSOR_DEFAULT_OPTIONS)` without `InfrastructureConfigModule` or Drizzle                                                                                                                                                                                                          |
| `apps/cron/src/cron.module.spec.ts`                                      | Cron DI compile test: `CronModule` boots without `DrizzleModule` / `OutboxProcessorModule` in import graph; `OutboxSchedule` receives `TOKENS.OutboxProcessorOptions` (mock Redis/BullMQ as needed)                                                                                                                                                 |

## Files to modify

| File                                                        | Symbol / change                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `libs/infrastructure/src/outbox/outbox-processor.module.ts` | Move `ConfigurableModuleBuilder` setup to `OutboxProcessorOptionsModule`; `OutboxProcessorModule.forRoot` / `forRootAsync` compose `OutboxProcessorOptionsModule.forRoot*(sameOptions)` + `buildFeatureImports(connectionImports)`; keep `DrizzleOutboxProcessor` + `TOKENS.OutboxProcessor`; re-export `TOKENS.OutboxProcessorOptions` via importing/exporting options submodule; preserve `OUTBOX_PROCESSOR_MODULE_OPTIONS_TOKEN` re-export for backward compatibility |
| `apps/cron/src/cron.module.ts`                              | Remove `drizzleModule`, `DrizzleModule` import, `mapAppConfigToDrizzleOptions`; replace `OutboxProcessorModule` with `OutboxProcessorOptionsModule.forRootAsync({ imports: [InfrastructureConfigModule], inject: [AppConfigService], useFactory: config => config.outbox() })`; keep `ScheduleModule`, `InfrastructureConfigModule`, `LoggerModule`, `redisModule`, BullMQ connection + `QUEUES.OUTBOX`, `LocksModule`                                                   |
| `README.md`                                                 | §3.3 Cron — state Cron is a thin scheduler (enqueue + lock only; no DB/outbox processor); §“Runtime configuration” (~L1197) — Cron uses `OutboxProcessorOptionsModule`, Worker uses `OutboxProcessorModule`                                                                                                                                                                                                                                                              |

## Files to delete

None.

## Contract and DI changes

| Item                                                                                         | Change                                                                                                                                    |
| -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `OutboxProcessorOptions` interface (`libs/contracts/src/outbox/outbox-processor.options.ts`) | **No change**                                                                                                                             |
| `TOKENS.OutboxProcessorOptions` (`libs/contracts/src/tokens.ts`)                             | **No change**                                                                                                                             |
| `TOKENS.OutboxProcessor`                                                                     | **No change** — remains only in `OutboxProcessorModule`                                                                                   |
| `OutboxProcessorModule` public API                                                           | **Preserve** `forRoot` / `forRootAsync` signatures for Worker; internally delegate options registration to `OutboxProcessorOptionsModule` |
| `OutboxProcessorOptionsModule`                                                               | **New** public module for Cron and any future thin schedulers                                                                             |

### Consumers of affected contracts

| Consumer                                   | Current                                                     | After fix                                                |
| ------------------------------------------ | ----------------------------------------------------------- | -------------------------------------------------------- |
| `OutboxSchedule`                           | `TOKENS.OutboxProcessorOptions` via `OutboxProcessorModule` | Same token via `OutboxProcessorOptionsModule`            |
| `DrizzleOutboxProcessor`                   | `TOKENS.OutboxProcessorOptions` via processor module        | Via `OutboxProcessorModule` → internal options submodule |
| `outboxProcessorProvider` (Worker)         | `TOKENS.OutboxProcessorOptions` via processor module        | Unchanged (still imports `OutboxProcessorModule`)        |
| `WorkerModule`                             | `OutboxProcessorModule.forRootAsync`                        | **Unchanged**                                            |
| `InfrastructureModule` (deprecated facade) | `OutboxProcessorModule.forRootAsync`                        | **Unchanged**                                            |
| `CronModule`                               | `OutboxProcessorModule` + `DrizzleModule`                   | **`OutboxProcessorOptionsModule` only**                  |

No other production references to `OutboxProcessorModule` exist outside Worker, Cron, and the deprecated `InfrastructureModule`.

## Implementation steps

1. **Create `OutboxProcessorOptionsModule`**
   - Copy the `ConfigurableModuleBuilder<OutboxProcessorOptions>` block from `outbox-processor.module.ts` into the new file.
   - Set `optionsInjectionToken: TOKENS.OutboxProcessorOptions`.
   - Implement `forRoot` (default `OUTBOX_PROCESSOR_DEFAULT_OPTIONS` from `outbox-processor.defaults.ts`) and `forRootAsync`.
   - Set `global: false`.
   - Export only `TOKENS.OutboxProcessorOptions`.
   - Export `MODULE_OPTIONS_TOKEN` as `OUTBOX_PROCESSOR_OPTIONS_MODULE_OPTIONS_TOKEN` (or keep a single alias re-exported from processor module).

2. **Refactor `OutboxProcessorModule`**
   - Remove the `ConfigurableModuleBuilder` definition from this file.
   - In `forRoot` / `forRootAsync`, return dynamic module with:
     ```text
     imports: [
       OutboxProcessorOptionsModule.forRoot*(sameOptions),
       ...buildFeatureImports(connectionImports),
     ]
     ```
   - Keep `@Module` providers: `DrizzleOutboxProcessor`, `TOKENS.OutboxProcessor` alias.
   - Keep `exports: [TOKENS.OutboxProcessor, TOKENS.OutboxProcessorOptions]`.
   - Re-export `OUTBOX_PROCESSOR_MODULE_OPTIONS_TOKEN` from options module for any external consumers.

3. **Slim `CronModule`**
   - Remove `drizzleModule` constant and `DrizzleModule` / `mapAppConfigToDrizzleOptions` imports.
   - Replace `OutboxProcessorModule.forRootAsync({ imports: [..., drizzleModule, bullMqQueuesModule], ... })` with:
     ```typescript
     OutboxProcessorOptionsModule.forRootAsync({
       imports: [InfrastructureConfigModule],
       inject: [AppConfigService],
       useFactory: (config: AppConfigService) => config.outbox(),
     });
     ```
   - Verify `bullMqQueuesModule` remains for `TOKENS.QueueGateway` only (OUTBOX queue).

4. **Add tests**
   - `outbox-processor-options.module.spec.ts`: mirror `redis.module.spec.ts` pattern — `Test.createTestingModule` with `forRoot(OUTBOX_PROCESSOR_DEFAULT_OPTIONS)`, assert `TOKENS.OutboxProcessorOptions` resolves with expected `pollIntervalMs` / `cronLockTtlMs`.
   - `cron.module.spec.ts`: compile `CronModule` with mocked `REDIS_CLIENT` / BullMQ dependencies (or override providers); assert module compiles and `OutboxSchedule` is injectable; assert import graph does not reference `DrizzleModule` or `OutboxProcessorModule` (static import check or absence of `DRIZZLE_DB` provider).

5. **Update documentation**
   - `README.md` §3.3: Cron enqueues outbox jobs via BullMQ; does not read the outbox table or host BullMQ processors.
   - `README.md` runtime configuration paragraph: split Cron (`OutboxProcessorOptionsModule`) vs Worker (`OutboxProcessorModule`).

6. **Verify Worker unchanged**
   - Confirm `apps/worker/src/worker.module.ts` requires no import changes.
   - Confirm `outboxProcessorProvider` still resolves `TOKENS.OutboxProcessorOptions` from composed processor module.

## Migration and rollout concerns

- **Deploy order:** Cron and Worker can deploy independently. Cron will stop opening PG connections after this change; Worker continues processing outbox rows. No schema migration.
- **Env file:** Cron deployments still need a valid `.env` for `InfrastructureConfigModule` (including `DATABASE_URL` validation) until a separate env-splitting task is approved. Runtime PG connection is removed; env validation is not.
- **Duplicate token registration:** Cron must import **only** `OutboxProcessorOptionsModule`, never both options and processor modules. Worker imports processor module which composes options internally.

## Targeted verification

| Command                                                     | Purpose                                                   |
| ----------------------------------------------------------- | --------------------------------------------------------- |
| `npm run build:cron`                                        | Cron compiles without Drizzle imports in `cron.module.ts` |
| `npm run test:unit -- outbox-processor-options.module.spec` | Options module DI test                                    |
| `npm run test:unit -- cron.module.spec`                     | Cron composition DI test                                  |
| `npm run test:unit -- outbox.schedule.spec`                 | Existing schedule unit tests still pass                   |

## Full verification

| Command                | Purpose                                                                                   |
| ---------------------- | ----------------------------------------------------------------------------------------- |
| `npm run build`        | Full multi-entrypoint build                                                               |
| `npm run build:worker` | Processor module refactor did not break Worker                                            |
| `npm run lint`         | Lint gate                                                                                 |
| `npm run test:unit`    | Full unit suite                                                                           |
| `npm run start:cron`   | Bootstrap with Redis + BullMQ available; confirm no PostgreSQL connection attempt in logs |

## Acceptance criteria

Mapped from backlog issue:

- [ ] `CronModule` bootstrap does **not** require Drizzle/DB when the scheduler only enqueues a queue job (`drizzleModule` removed from `apps/cron/src/cron.module.ts` imports).
- [ ] `OutboxSchedule` receives the same typed `OutboxProcessorOptions` via `TOKENS.OutboxProcessorOptions` without importing `OutboxProcessorModule`.
- [ ] Worker remains the sole entrypoint that imports the actual outbox processor (`OutboxProcessorModule` + `outboxProcessorProvider` unchanged).
- [ ] `npm run build:cron` passes.
- [ ] Cron DI test (`cron.module.spec.ts`) passes.

## Risks

| Risk                                                                       | Mitigation                                                                                       |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Duplicate `TOKENS.OutboxProcessorOptions` if both modules imported in Cron | Cron uses only `OutboxProcessorOptionsModule`; never import processor module at Cron root        |
| `OutboxProcessorModule` refactor breaks Worker DI                          | Keep Worker imports unchanged; run `build:worker` and `start:worker` bootstrap                   |
| Nest `ConfigurableModuleBuilder` nested composition edge cases             | Mirror proven `OutboxProcessorModule` / `RedisModule` patterns from P1-04; test both entrypoints |
| Cron still requires `DATABASE_URL` in env despite no PG connection         | Document as known limitation; out of scope unless human approves env schema split                |
| Cron DI test needs Redis/BullMQ mocks                                      | Follow `redis.module.spec.ts` / `bullmq.module.spec.ts` mock patterns                            |

## Rollback strategy

Revert the commit(s). Cron will again import `DrizzleModule` and `OutboxProcessorModule`. No data migration or persistent state change. Safe to roll back independently of Worker.

## Open questions requiring human decision

1. **Module name:** `OutboxProcessorOptionsModule` (recommended — matches contract + `TOKENS.OutboxProcessorOptions`) vs backlog alternative `OutboxSchedulerConfigModule`?
2. **Cron DI test depth:** Compile-only `Test.createTestingModule` with mocked infra (recommended) vs full bootstrap requiring live Redis/BullMQ?
3. **Env validation:** Should this issue also make `DATABASE_URL` optional for Cron (split `envSchema`), or is removing runtime PG connection sufficient for P2-13 acceptance?
4. **`InfrastructureModule` facade:** Update deprecated facade docs/exports to mention `OutboxProcessorOptionsModule`, or leave untouched?
5. **Public barrel export:** Add explicit re-export from a shared `outbox/index.ts` if one is introduced later, or rely on `@infrastructure/outbox/*` path imports only (current pattern)?
