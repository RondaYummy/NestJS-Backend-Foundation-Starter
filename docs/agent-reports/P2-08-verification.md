# P2-08 — Independent Verification

**Verified by:** independent-verifier  
**Date:** 2026-06-21  
**Branch:** main (unstaged P2-08 changes + untracked new files)

---

## Verdict

**approved**

---

## Scope checked

P2-08 changes are confined to the planned files. No unrelated production refactors in API, Cron, or contracts.

| File                                                                     | Plan entry            | Verdict        |
| ------------------------------------------------------------------------ | --------------------- | -------------- |
| `apps/worker/src/processors/create-outbox-processor.ts`                  | Create                | In scope       |
| `apps/worker/src/processors/outbox-processor.provider.ts`                | Create                | In scope       |
| `apps/worker/src/processors/create-outbox-processor.spec.ts`             | Create                | In scope       |
| `apps/worker/src/processors/outbox.processor.ts`                         | Delete                | In scope       |
| `apps/worker/src/worker.module.ts`                                       | Modify                | In scope       |
| `libs/infrastructure/src/outbox/outbox-processor.defaults.ts`            | Modify                | In scope       |
| `libs/infrastructure/src/outbox/outbox-processor.options.schema.ts`      | Modify                | In scope       |
| `libs/infrastructure/src/outbox/outbox-processor.options.schema.spec.ts` | Modify                | In scope       |
| `libs/infrastructure/src/config/env.schema.spec.ts`                      | Modify                | In scope       |
| `docs/agent-reports/P2-08-implementation.md`                             | Implementation report | Non-production |

**Not modified (confirmed):** `apps/cron/**`, `apps/api/**`, `libs/contracts/**`, `OutboxProcessorOptions` shape, `IOutboxProcessor`, `DrizzleOutboxProcessor`.

**Documented deviation (acceptable):**

| Plan                                                         | Actual                                                | Assessment                                                                                                                                                                    |
| ------------------------------------------------------------ | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `useFactory` returns `createOutboxProcessorClass(...)` class | Factory returns `new ProcessorClass(outbox)` instance | Justified — `@nestjs/bullmq` `BullExplorer.registerWorkers()` resolves processor metadata from `wrapper.instance.constructor` when `wrapper.inject` is set (useFactory path). |
| `inject: [TOKENS.OutboxProcessorOptions]` only               | Also injects `TOKENS.OutboxProcessor`                 | Justified — required to construct the processor instance with the outbox service in the factory.                                                                              |

---

## Root-cause assessment

**Original defect:** Two configuration paths for outbox worker concurrency:

- **Path A (removed):** `outbox.processor.ts` → `buildOutboxProcessorDecoratorOptions()` → `resolveOutboxOptionsFromEnv()` → `outboxProcessorEnvSchema.safeParse(process.env)` with silent fallback.
- **Path B (retained):** `env.schema.ts` → `mapOutboxEnvToOptions()` → `AppConfigService.outbox()` → `TOKENS.OutboxProcessorOptions`.

The fix addresses the root cause directly:

1. Path A symbols deleted from production code (`rg` over `apps/` and `libs/` — no matches).
2. BullMQ concurrency is derived at DI time from `options.concurrency` via `outboxProcessorProvider`.
3. Duplicate `outboxProcessorEnvSchema` / `parseOutboxProcessorEnv` removed; `env.schema.ts` is the sole env parser with fail-fast rules.
4. No `process.env` reads in outbox config/defaults/schema files (only unrelated `DATABASE_URL` fallback in `drizzle-outbox-processor.int-spec.ts`).

Pre-fix processor (removed):

```ts
@Processor(QUEUES.OUTBOX, buildOutboxProcessorDecoratorOptions())
export class OutboxProcessor extends WorkerHost { ... }
```

---

## Acceptance criteria matrix

| #   | Criterion                                                                                               | Status                     | Evidence                                                                                                                                                                                                                                                      |
| --- | ------------------------------------------------------------------------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Single typed source of truth: `AppConfigService.outbox().concurrency` / `TOKENS.OutboxProcessorOptions` | **passed**                 | Full DI chain verified (see below). Provider injects `TOKENS.OutboxProcessorOptions` and passes `options.concurrency` to factory.                                                                                                                             |
| 2   | No `process.env` read in reusable outbox decorator/helper code                                          | **passed**                 | `outbox-processor.defaults.ts`, `outbox-processor.options.schema.ts` contain no env reads.                                                                                                                                                                    |
| 3   | BullMQ outbox worker `concurrency` matches `OutboxProcessorOptions.concurrency`                         | **passed** (static + unit) | `createOutboxProcessorClass(3)` → `WORKER_METADATA === { concurrency: 3 }`. Provider wiring: `createOutboxProcessorClass(options.concurrency)`. Live BullMQ Worker bootstrap not executed.                                                                    |
| 4   | Invalid outbox env does not silently fall back via parallel parser                                      | **passed**                 | Path A removed. `env.schema.spec.ts` confirms rejections for invalid cross-field combinations.                                                                                                                                                                |
| 5   | Dead imports/constants removed                                                                          | **passed**                 | `buildOutboxProcessorDecoratorOptions`, `resolveOutboxOptionsFromEnv`, `outboxProcessorEnvSchema`, `parseOutboxProcessorEnv`, unused imports/locals removed. `computeHandlerTimeoutMs` / `computeLockHeartbeatIntervalMs` retained in schema (used by tests). |
| 6   | `build:worker`, `build`, targeted unit tests, `lint` pass                                               | **passed**                 | All commands executed successfully (see Commands).                                                                                                                                                                                                            |
| 7   | Worker entrypoint boundary preserved; Cron/API unchanged                                                | **passed**                 | `@Processor` only in `create-outbox-processor.ts`. Cron still uses `OutboxProcessorModule.forRootAsync` without BullMQ processor.                                                                                                                             |

---

## Dependency and DI verification

**Target wiring (verified):**

```text
process.env.OUTBOX_CONCURRENCY
  → env.schema.ts (fail-fast + superRefine)
  → infrastructure-config.module.ts mapOutboxEnvToOptions({ ... OUTBOX_CONCURRENCY: e.OUTBOX_CONCURRENCY })
  → AppConfigService.outbox()
  → OutboxProcessorModule.forRootAsync({ useFactory: config => config.outbox() })
  → TOKENS.OutboxProcessorOptions
       ├→ DrizzleOutboxProcessor (batch/lock/heartbeat options)
       └→ outboxProcessorProvider.useFactory(options, outbox)
             → createOutboxProcessorClass(options.concurrency)
             → @Processor(QUEUES.OUTBOX, { concurrency })
             → BullExplorer.registerWorkers() → handleProcessor(..., workerOptions)
```

**Key code points:**

```58:64:apps/worker/src/worker.module.ts
    OutboxProcessorModule.forRootAsync({
      imports: [InfrastructureConfigModule, drizzleModule, bullMqQueuesModule],
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => config.outbox(),
    }),
  ],
  providers: [EmailProcessor, outboxProcessorProvider],
```

```11:18:apps/worker/src/processors/outbox-processor.provider.ts
export const outboxProcessorProvider: Provider = {
  provide: OUTBOX_WORKER_PROCESSOR,
  useFactory: (options: OutboxProcessorOptions, outbox: IOutboxProcessor) => {
    const ProcessorClass = createOutboxProcessorClass(options.concurrency);
    return new ProcessorClass(outbox);
  },
  inject: [TOKENS.OutboxProcessorOptions, TOKENS.OutboxProcessor],
};
```

```9:24:apps/worker/src/processors/create-outbox-processor.ts
export function createOutboxProcessorClass(concurrency: number) {
  @Processor(QUEUES.OUTBOX, { concurrency })
  class OutboxProcessorHost extends WorkerHost {
    // ...
  }
  return OutboxProcessorHost;
}
```

**BullExplorer discovery (`@nestjs/bullmq/dist/bull.explorer.js`):**

- Scans all providers via `discoveryService.getProviders()`.
- For `useFactory` providers (`wrapper.inject` set), resolves processor class via `wrapper.instance?.constructor`.
- Reads `@Processor` metadata from `instance.constructor`.
- Reads worker options via `getWorkerOptionsMetadata(instance.constructor)` and passes them to `handleProcessor`.

This aligns with the instance-returning factory pattern and the unit test asserting `WORKER_METADATA`.

---

## Commands executed

| Command                                                                                                                                                                                                                                               | Result                                      | Conclusion                                     |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- | ---------------------------------------------- |
| `node node_modules/jest/bin/jest.js --config jest.unit.config.ts apps/worker/src/processors/create-outbox-processor.spec.ts libs/infrastructure/src/outbox/outbox-processor.options.schema.spec.ts libs/infrastructure/src/config/env.schema.spec.ts` | Pass — 3 suites, 32 tests                   | Targeted P2-08 tests pass                      |
| `node node_modules/@nestjs/cli/bin/nest.js build worker`                                                                                                                                                                                              | Pass                                        | Worker compiles with new provider wiring       |
| `node node_modules/@nestjs/cli/bin/nest.js build api && ... worker && ... cron && ... migrations`                                                                                                                                                     | Pass                                        | All entrypoints compile                        |
| `npm run lint`                                                                                                                                                                                                                                        | Pass                                        | Full-repo lint gate clean                      |
| `node node_modules/jest/bin/jest.js --config jest.unit.config.ts`                                                                                                                                                                                     | Pass — 22 suites, 106 tests                 | Full unit suite passes                         |
| `node node_modules/typescript/bin/tsc -p apps/worker/tsconfig.app.json --noEmit`                                                                                                                                                                      | Pass                                        | Worker typecheck clean                         |
| `rg "buildOutboxProcessorDecoratorOptions\|resolveOutboxOptionsFromEnv\|outboxProcessorEnvSchema\|parseOutboxProcessorEnv" apps/ libs/`                                                                                                               | No matches                                  | Deleted symbols absent from production code    |
| `rg "process\.env" libs/infrastructure/src/outbox/`                                                                                                                                                                                                   | Only `drizzle-outbox-processor.int-spec.ts` | No config-path env reads in outbox module      |
| `npm run start:worker`                                                                                                                                                                                                                                | Not run                                     | Requires Redis + PostgreSQL; optional per plan |

**Note:** `npx jest` and `npx nest build` intermittently exit with Windows access violation (`-1073741819`). Equivalent `node node_modules/...` invocations succeed.

---

## Findings

**Positive:**

1. Root cause fully addressed — no parallel env parser or import-time decorator config.
2. Test migration complete — cross-field rules (cron lock vs poll, heartbeat vs lock TTL, handler timeout, retry ordering, batch size) covered in `env.schema.spec.ts`.
3. Factory metadata tests confirm concurrency is argument-driven, not env-driven.
4. BullExplorer source confirms `useFactory` + instance pattern is the supported discovery path.
5. Module import order preserved: `OutboxProcessorModule.forRootAsync` in `imports` before `outboxProcessorProvider` in `providers`.

**Minor gaps (non-blocking):**

1. No unit test for `outboxProcessorProvider` itself — only `createOutboxProcessorClass`. Wiring is simple and statically verifiable.
2. `OUTBOX_WORKER_PROCESSOR` symbol token differs from plan’s implicit class-as-provider pattern; BullExplorer discovers by metadata on `instance.constructor`, not by token, so this is fine.

---

## Documentation alignment

- Implementation report accurately describes changes and the BullExplorer deviation.
- Backlog P2-08 requirements met.
- README not updated — correctly out of scope per plan.

---

## Remaining risks

1. **Runtime Worker bootstrap unverified** — No live confirmation that the outbox BullMQ consumer registers with the configured concurrency when Redis/PostgreSQL are available. Mitigated by BullExplorer source analysis + metadata unit tests.
2. **`npm run test:unit` / `npx` script instability on Windows** — Intermittent access violation; use `node node_modules/jest/bin/jest.js --config jest.unit.config.ts` as workaround.
3. **Dynamic class per concurrency value** — Each boot creates a new anonymous class; acceptable for config-fixed-at-startup, but differs from static `@Processor` class pattern.

---

## Unverified areas

- `npm run start:worker` with `OUTBOX_CONCURRENCY=2` against live Redis/PostgreSQL.
- End-to-end BullMQ worker parallelism under load (beyond `WORKER_METADATA` unit assertion).
