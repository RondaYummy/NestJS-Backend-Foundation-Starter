---
issue_id: P2-08
status: approved
owner: human-approval-required
---

# P2-08 — Remove duplicate `process.env` configuration path for Outbox Worker concurrency

## Source issue

`docs/agent-backlog/NESTJS_STARTER_KIT_REQUIRED_FIXES.md` — section **P2-08. Прибрати другий `process.env` configuration path для Outbox Worker concurrency**.

Related backlog grouping: **Contracts/configuration** (`P2-02`, `P2-03`, `P2-08`).

## Current behavior

1. **Path A — decorator / import-time `process.env` (controls actual BullMQ worker parallelism):**
   - `apps/worker/src/processors/outbox.processor.ts` applies `@Processor(QUEUES.OUTBOX, buildOutboxProcessorDecoratorOptions())`.
   - `buildOutboxProcessorDecoratorOptions()` in `libs/infrastructure/src/outbox/outbox-processor.defaults.ts` calls `resolveOutboxOptionsFromEnv()`, which reads `process.env` via `outboxProcessorEnvSchema.safeParse(env)`.
   - On parse failure, Path A silently returns `OUTBOX_PROCESSOR_DEFAULT_OPTIONS` (including `concurrency: 1`).

2. **Path B — typed config pipeline (documented source of truth):**
   - `OUTBOX_CONCURRENCY` is validated in `libs/infrastructure/src/config/env.schema.ts`.
   - `InfrastructureConfigModule` fail-fast validates env and maps outbox settings through `mapOutboxEnvToOptions()` into `AppConfigService.outbox()`.
   - `WorkerModule` passes `config.outbox()` into `OutboxProcessorModule.forRootAsync()`, registering `TOKENS.OutboxProcessorOptions` for `DrizzleOutboxProcessor`.

3. **Runtime effect:**
   - BullMQ worker concurrency is set exclusively from Path A (`WORKER_METADATA` on the `@Processor` class, read by `@nestjs/bullmq` `BullExplorer.handleProcessor()`).
   - `OutboxProcessorOptions.concurrency` on Path B is populated but **not consumed** by `DrizzleOutboxProcessor`, `OutboxSchedule`, or any other runtime code.
   - When env is fully valid, both paths usually agree by coincidence (same env var). When env is invalid, Path B prevents startup while Path A would silently fall back — but in practice Path B wins because the app never boots.

4. **Lint debt (overlaps P2-11, explicitly called out in P2-08):**
   - Unused imports in `outbox-processor.defaults.ts`: `computeHandlerTimeoutMs`, `computeLockHeartbeatIntervalMs`.
   - Unused `defaultLockTtlMs` in `outbox-processor.defaults.ts`.
   - Unused `lockTtlMs` local in `mapOutboxEnvToOptions()` (`outbox-processor.options.schema.ts`).
   - Unused `parseOutboxProcessorEnv()` (never called).

**Investigation (2026-06-21, branch `main`):** root cause confirmed — duplicate env paths and silent decorator fallback still present. Issue is **not stale**.

## Confirmed root cause

Outbox BullMQ worker concurrency bypasses the typed configuration pipeline. A reusable infrastructure helper (`buildOutboxProcessorDecoratorOptions` → `resolveOutboxOptionsFromEnv`) reads `process.env` at class-decoration / module-import time with silent full-default fallback, while all other outbox settings flow through `InfrastructureConfigModule` → `AppConfigService.outbox()` → `OutboxProcessorModule.forRootAsync()`. The duplicate Zod schema (`outboxProcessorEnvSchema` vs `envSchema` outbox fields) creates inconsistent validation semantics and dead code.

## Dependency/runtime flow

```text
process.env.OUTBOX_CONCURRENCY
  |
  +-- Path A (defect)
  |     outbox.processor.ts @Processor(..., buildOutboxProcessorDecoratorOptions())
  |       -> resolveOutboxOptionsFromEnv(process.env)
  |       -> outboxProcessorEnvSchema.safeParse  [silent fallback on failure]
  |       -> BullExplorer.handleProcessor(..., { concurrency })
  |       -> BullMQ Worker parallelism  *** ACTUAL RUNTIME ***
  |
  +-- Path B (intended)
        env.schema.ts OUTBOX_CONCURRENCY
          -> InfrastructureConfigModule.validate  [fail-fast]
          -> mapOutboxEnvToOptions()
          -> AppConfigService.outbox()
          -> OutboxProcessorModule.forRootAsync()
          -> TOKENS.OutboxProcessorOptions
          -> DrizzleOutboxProcessor (batchSize, lockTtlMs, heartbeat, etc.)
          -> concurrency field stored but UNUSED by processor service

Composition roots:
  apps/worker/src/worker.module.ts
    OutboxProcessorModule.forRootAsync({ useFactory: config => config.outbox() })
    providers: [OutboxProcessor]   // Path A decorator still active

  apps/cron/src/cron.module.ts
    OutboxProcessorModule.forRootAsync (pollIntervalMs, cronLockTtlMs only — no BullMQ processor)

Reference pattern (no duplicate env path):
  apps/worker/src/processors/email.processor.ts
    @Processor(QUEUES.EMAIL)  // no decorator worker options
    runtime config via AppConfigService.jobExecution() inside process()
```

**Symbols on the defect path:**

| File                                                                | Symbol                                                                | Current behavior                                   |
| ------------------------------------------------------------------- | --------------------------------------------------------------------- | -------------------------------------------------- |
| `apps/worker/src/processors/outbox.processor.ts`                    | `OutboxProcessor`, `@Processor`                                       | Reads concurrency via Path A at import time        |
| `libs/infrastructure/src/outbox/outbox-processor.defaults.ts`       | `buildOutboxProcessorDecoratorOptions`, `resolveOutboxOptionsFromEnv` | Direct `process.env` read; silent fallback         |
| `libs/infrastructure/src/outbox/outbox-processor.options.schema.ts` | `outboxProcessorEnvSchema`, `parseOutboxProcessorEnv`                 | Duplicate validation schema; dead export           |
| `apps/worker/src/worker.module.ts`                                  | `WorkerModule`                                                        | Wires Path B but leaves Path A active on processor |
| `libs/infrastructure/src/config/infrastructure-config.module.ts`    | `validate` mapper                                                     | Single fail-fast path for outbox options           |
| `libs/contracts/src/outbox/outbox-processor.options.ts`             | `OutboxProcessorOptions.concurrency`                                  | Populated on Path B, not wired to BullMQ worker    |

## Goal

Establish **one typed source of truth** for outbox worker concurrency (`AppConfigService.outbox().concurrency` / `TOKENS.OutboxProcessorOptions`), remove import-time `process.env` reads from reusable infrastructure, and ensure BullMQ worker parallelism matches the typed options without silent validation fallback.

## Scope

1. Remove Path A (`buildOutboxProcessorDecoratorOptions`, `resolveOutboxOptionsFromEnv`, direct `process.env` reads in outbox defaults).
2. Wire BullMQ outbox worker `concurrency` from `TOKENS.OutboxProcessorOptions` at Worker composition time (after Nest config bootstrap).
3. Consolidate duplicate outbox env validation — retain `env.schema.ts` as the sole runtime env parser; keep `mapOutboxEnvToOptions()` as the mapper from validated env subset to `OutboxProcessorOptions`.
4. Remove dead symbols that break lint (`parseOutboxProcessorEnv`, unused imports/locals).
5. Add unit coverage proving BullMQ processor concurrency is derived from injected options, not a parallel env read.
6. Verify Worker bootstrap still registers the outbox consumer with expected concurrency.

## Out of scope

- Changing outbox env variable names or default values.
- Wiring `concurrency` into `DrizzleOutboxProcessor` business logic (BullMQ-level setting only; processor service does not need to read it).
- Cron entrypoint changes beyond ensuring existing `OutboxProcessorModule.forRootAsync` wiring remains unchanged.
- README documentation sync (already describes Path B; optional follow-up if dynamic processor factory pattern needs a short Worker note).
- P2-11 full lint gate restoration beyond the dead symbols in outbox config files touched by this fix.
- BullMQ job-level timeout, rate limiting, or other worker options beyond `concurrency`.
- Breaking changes to `OutboxProcessorOptions` contract shape.

## Files to create

| Path                                                         | Responsibility                                                                                                                                                                                                                                        |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/worker/src/processors/create-outbox-processor.ts`      | Export `createOutboxProcessorClass(concurrency: number)` — returns a `@Processor(QUEUES.OUTBOX, { concurrency })` `WorkerHost` subclass with constructor injection of `TOKENS.OutboxProcessor`. Evaluated at DI factory time, not module import time. |
| `apps/worker/src/processors/create-outbox-processor.spec.ts` | Unit test: returned class carries `WORKER_METADATA.concurrency` matching input; no `process.env` access.                                                                                                                                              |
| `apps/worker/src/processors/outbox-processor.provider.ts`    | Export `outboxProcessorProvider: Provider` — `useFactory` injects `TOKENS.OutboxProcessorOptions`, returns `createOutboxProcessorClass(options.concurrency)` (Nest treats returned class as `useClass`).                                              |

## Files to modify

| Path                                                                     | Symbol / responsibility                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/worker/src/processors/outbox.processor.ts`                         | **Delete or replace** — static `@Processor(..., buildOutboxProcessorDecoratorOptions())` removed; logic moves to `create-outbox-processor.ts`.                                                                                                                                                                                                                 |
| `apps/worker/src/worker.module.ts`                                       | `WorkerModule` — replace `OutboxProcessor` in `providers` with `outboxProcessorProvider`; ensure `OutboxProcessorModule.forRootAsync` remains imported before processor provider resolves `TOKENS.OutboxProcessorOptions`.                                                                                                                                     |
| `libs/infrastructure/src/outbox/outbox-processor.defaults.ts`            | Remove `buildOutboxProcessorDecoratorOptions`, `resolveOutboxOptionsFromEnv`, unused imports (`computeHandlerTimeoutMs`, `computeLockHeartbeatIntervalMs`), unused `defaultLockTtlMs`. Retain `OUTBOX_PROCESSOR_DEFAULT_OPTIONS`, `defaultRetryDelaySeconds`.                                                                                                  |
| `libs/infrastructure/src/outbox/outbox-processor.options.schema.ts`      | Remove `outboxProcessorEnvSchema`, `OutboxProcessorEnv` type, `parseOutboxProcessorEnv`. Change `mapOutboxEnvToOptions` parameter to a typed input interface (`OutboxEnvMappingInput`) aligned with fields passed from `infrastructure-config.module.ts`. Remove unused `lockTtlMs` local. Retain `computeLockHeartbeatIntervalMs`, `computeHandlerTimeoutMs`. |
| `libs/infrastructure/src/outbox/outbox-processor.options.schema.spec.ts` | Refocus tests on `mapOutboxEnvToOptions` and compute helpers using explicit input objects (not standalone env schema parsing). Remove tests targeting deleted `outboxProcessorEnvSchema`.                                                                                                                                                                      |
| `libs/infrastructure/src/config/env.schema.spec.ts`                      | Add/adjust outbox cross-field validation tests currently covered only by `outboxProcessorEnvSchema` spec (cron lock vs poll interval, heartbeat vs lock ttl, handler timeout rules, retry delay ordering).                                                                                                                                                     |

## Files to delete

| Path                                             | Reason                                                                                                                                                                                                                                                    |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/worker/src/processors/outbox.processor.ts` | Replaced by factory-based registration (`create-outbox-processor.ts` + provider). _If human prefers keeping the filename, it may re-export the factory instead of deleting — implementer should pick one approach and avoid duplicate processor classes._ |

## Contract and DI changes

| Area                                                                               | Change                                                                                                                                                                                                                                                  |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OutboxProcessorOptions` (`libs/contracts/src/outbox/outbox-processor.options.ts`) | **No shape change** — `concurrency` remains; now actually drives BullMQ worker registration.                                                                                                                                                            |
| `TOKENS.OutboxProcessorOptions`                                                    | **No change** — existing token becomes the sole concurrency source.                                                                                                                                                                                     |
| `IOutboxProcessor` / `DrizzleOutboxProcessor`                                      | **No change** — processor service continues using batch/lock/heartbeat options; concurrency stays at BullMQ layer.                                                                                                                                      |
| Env schema / `AppConfigService.outbox()`                                           | **No change** — remain sole env validation path.                                                                                                                                                                                                        |
| Worker DI                                                                          | **Add** `outboxProcessorProvider` factory provider; **remove** static `OutboxProcessor` class provider.                                                                                                                                                 |
| Infrastructure exports                                                             | **Remove** `buildOutboxProcessorDecoratorOptions`, `resolveOutboxOptionsFromEnv`, `outboxProcessorEnvSchema`, `parseOutboxProcessorEnv` from public outbox module surface (update `libs/infrastructure/src/index.ts` or barrel exports if re-exported). |

### Target wiring (post-fix)

```text
process.env.OUTBOX_CONCURRENCY
  -> env.schema.ts (fail-fast)
  -> mapOutboxEnvToOptions()
  -> AppConfigService.outbox()
  -> OutboxProcessorModule.forRootAsync()
  -> TOKENS.OutboxProcessorOptions
       |-> DrizzleOutboxProcessor (business options)
       +-> outboxProcessorProvider.useFactory
             -> createOutboxProcessorClass(options.concurrency)
             -> @Processor(QUEUES.OUTBOX, { concurrency })
             -> BullMQ Worker
```

## Implementation steps

1. **Factory-based processor registration**
   - Create `create-outbox-processor.ts` with a function that accepts `concurrency: number` and returns a `WorkerHost` subclass decorated with `@Processor(QUEUES.OUTBOX, { concurrency })`.
   - Inject `TOKENS.OutboxProcessor` via constructor; delegate `process()` to `outbox.processPending()`.
   - Create `outbox-processor.provider.ts` with `useFactory: (options) => createOutboxProcessorClass(options.concurrency)` and `inject: [TOKENS.OutboxProcessorOptions]`.

2. **Worker composition root**
   - Update `worker.module.ts`: remove static `OutboxProcessor` import; add `outboxProcessorProvider` to `providers`.
   - Confirm module import order: `OutboxProcessorModule.forRootAsync` before processor provider (already satisfied).

3. **Remove Path A from infrastructure**
   - Delete `buildOutboxProcessorDecoratorOptions` and `resolveOutboxOptionsFromEnv` from `outbox-processor.defaults.ts`.
   - Remove unused imports/constants (`computeHandlerTimeoutMs`, `computeLockHeartbeatIntervalMs`, `defaultLockTtlMs`).

4. **Consolidate env validation**
   - Remove `outboxProcessorEnvSchema` and `parseOutboxProcessorEnv` from `outbox-processor.options.schema.ts`.
   - Introduce `OutboxEnvMappingInput` (plain TypeScript type) for `mapOutboxEnvToOptions` input — fields mirror the object built in `infrastructure-config.module.ts` lines 77–88.
   - Remove unused `lockTtlMs` local in `mapOutboxEnvToOptions`.

5. **Test migration**
   - Move cross-field validation coverage from `outbox-processor.options.schema.spec.ts` to `env.schema.spec.ts`.
   - Keep `mapOutboxEnvToOptions` mapping tests in `outbox-processor.options.schema.spec.ts`.
   - Add `create-outbox-processor.spec.ts` asserting metadata concurrency matches factory input.

6. **Export cleanup**
   - Search for and remove any barrel re-exports of deleted symbols.
   - Grep confirms current consumers of deleted symbols: only `outbox.processor.ts` (removed) and tests.

7. **Verification**
   - Run targeted unit tests, `build:worker`, full `build`, `lint`.

## Migration and rollout concerns

- **Behavior change for invalid env outside Nest bootstrap:** Path A silent fallback is removed entirely. Invalid outbox env continues to fail at startup via `InfrastructureConfigModule` (unchanged operator experience for production).
- **Behavior change for tests importing worker processor directly:** Tests must not rely on `buildOutboxProcessorDecoratorOptions()` or import-time env side effects.
- **Valid env deployments:** No change when `OUTBOX_CONCURRENCY` and related outbox vars are valid — concurrency value should match pre-fix Path A result.
- **Dynamic class + `@nestjs/bullmq` discovery:** Nest treats a factory-returned class as `useClass`; `BullExplorer` reads `@Processor` / `WORKER_METADATA` from that class constructor. Implementer must confirm via Worker bootstrap or a focused integration test — if discovery fails, fallback to documented `manualRegistration` + `BullRegistrar` pattern (see NestJS BullMQ docs) using the same `TOKENS.OutboxProcessorOptions` injection.
- **No database migration.**

## Targeted verification

| Command / scenario                                                                                                          | Expected result                                      |
| --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ------------ | -------------------------------------------------------------------------------------------------------------- |
| `npm run test:unit -- --testPathPattern="create-outbox-processor                                                            | outbox-processor.options.schema                      | env.schema"` | Factory metadata test passes; mapper tests pass; outbox env cross-field rules covered in `env.schema.spec.ts`. |
| `npm run build:worker`                                                                                                      | Worker entrypoint compiles with new provider wiring. |
| `rg "buildOutboxProcessorDecoratorOptions\|resolveOutboxOptionsFromEnv\|outboxProcessorEnvSchema\|parseOutboxProcessorEnv"` | No matches in production code (`apps/`, `libs/`).    |
| `rg "process\.env" libs/infrastructure/src/outbox/`                                                                         | No direct reads (except unrelated future changes).   |

**Concurrency alignment scenario (unit or bootstrap):**

```text
Given: TOKENS.OutboxProcessorOptions with concurrency = 3
When: outboxProcessorProvider factory runs
Then: returned processor class WORKER_METADATA.concurrency === 3
  And: no read of process.env in outbox defaults/helpers
```

## Full verification

| Command                                                        | Expected result                                                                                                                  |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `npm run build`                                                | All entrypoints compile.                                                                                                         |
| `npm run lint`                                                 | No errors in `outbox-processor.defaults.ts` or `outbox-processor.options.schema.ts`; no new lint violations from Worker changes. |
| `npm run test:unit`                                            | Full unit suite passes (including any previously failing outbox schema spec after test migration).                               |
| `npm run start:worker` (optional, requires Redis + PostgreSQL) | Worker boots; BullMQ outbox consumer registered; no duplicate env path errors.                                                   |

Record each command as: command, result, conclusion.

## Acceptance criteria

Mapped from backlog **P2-08**:

- [ ] Single typed source of truth for outbox worker concurrency: `AppConfigService.outbox().concurrency` / `TOKENS.OutboxProcessorOptions`.
- [ ] No `process.env` read in reusable outbox decorator/helper code (`outbox-processor.defaults.ts` and related helpers).
- [ ] BullMQ outbox worker `concurrency` matches `OutboxProcessorOptions.concurrency` from the typed config pipeline.
- [ ] Invalid outbox env does not silently fall back via a parallel parser (fail-fast via `env.schema.ts` only).
- [ ] Dead imports/constants removed: `computeHandlerTimeoutMs`, `computeLockHeartbeatIntervalMs`, `defaultLockTtlMs`, `lockTtlMs`, `parseOutboxProcessorEnv`, `outboxProcessorEnvSchema` (where no longer needed).
- [ ] `npm run build:worker`, `npm run build`, targeted unit tests, and `npm run lint` pass for touched files.
- [ ] Worker entrypoint boundary preserved: `@Processor` remains only in Worker; Cron/API unchanged.

## Risks

| Risk                                                               | Mitigation                                                                                                                                      |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `@nestjs/bullmq` may not discover factory-returned processor class | Verify during implementation with Worker bootstrap; unit-test `WORKER_METADATA`; fall back to `manualRegistration` + `BullRegistrar` if needed. |
| Test migration drops validation coverage                           | Explicitly port all `outboxProcessorEnvSchema` cross-field tests to `env.schema.spec.ts` before deleting schema.                                |
| Dynamic class breaks `@Inject` on constructor                      | Follow Nest `useFactory` returning class pattern; verify DI in Worker bootstrap.                                                                |
| P2-11 lint errors outside touched files remain                     | Expected; report separately — this plan fixes only outbox-related dead symbols cited in P2-08/P2-11 overlap.                                    |

## Rollback strategy

1. Revert Worker processor provider changes; restore static `outbox.processor.ts` with `@Processor(QUEUES.OUTBOX, buildOutboxProcessorDecoratorOptions())`.
2. Restore `buildOutboxProcessorDecoratorOptions` / `resolveOutboxOptionsFromEnv` / `outboxProcessorEnvSchema` if removed.
3. No data or env migration rollback required.

## Open questions requiring human decision

1. **Dynamic class vs `manualRegistration`:** This plan prefers a `useFactory`-returned processor class (minimal diff, keeps `@Processor` pattern). If bootstrap verification fails, should implementation switch to `BullModule.forRoot({ extraOptions: { manualRegistration: true } })` + `BullRegistrar.register()` in Worker?
2. **File retention:** Delete `outbox.processor.ts` entirely, or keep it as a thin re-export of `createOutboxProcessorClass` for discoverability?
3. **Schema deduplication depth:** Remove `outboxProcessorEnvSchema` entirely and rely on `env.schema.ts` tests only, or extract shared `superRefine` helper used by both schemas during a transitional period? **Recommended:** remove duplicate schema entirely; port tests to `env.schema.spec.ts`.
4. **Integration test scope:** Is Worker bootstrap with `OUTBOX_CONCURRENCY=2` against live Redis sufficient runtime evidence, or is unit metadata testing enough for this P2 fix?
