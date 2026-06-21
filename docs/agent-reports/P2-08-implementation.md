# P2-08 — Implementation report

## Verdict

implemented

## Approved plan

`docs/agent-plans/P2-08-outbox-worker-concurrency-single-config-path.md` (`status: approved`)

## Changed files

| Path                                                                     | Change                                                                                                                                                           |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/worker/src/processors/create-outbox-processor.ts`                  | **Created** — `createOutboxProcessorClass(concurrency)` returns a `@Processor(QUEUES.OUTBOX, { concurrency })` `WorkerHost` subclass                             |
| `apps/worker/src/processors/outbox-processor.provider.ts`                | **Created** — `outboxProcessorProvider` injects `TOKENS.OutboxProcessorOptions` + `TOKENS.OutboxProcessor`, registers dynamic processor at DI time               |
| `apps/worker/src/processors/create-outbox-processor.spec.ts`             | **Created** — asserts `WORKER_METADATA.concurrency` matches factory input                                                                                        |
| `apps/worker/src/processors/outbox.processor.ts`                         | **Deleted** — removed import-time `buildOutboxProcessorDecoratorOptions()` Path A                                                                                |
| `apps/worker/src/worker.module.ts`                                       | Replaced static `OutboxProcessor` provider with `outboxProcessorProvider`                                                                                        |
| `libs/infrastructure/src/outbox/outbox-processor.defaults.ts`            | Removed `buildOutboxProcessorDecoratorOptions`, `resolveOutboxOptionsFromEnv`, unused imports/constants; retained defaults helpers                               |
| `libs/infrastructure/src/outbox/outbox-processor.options.schema.ts`      | Removed duplicate `outboxProcessorEnvSchema`, `OutboxProcessorEnv`, `parseOutboxProcessorEnv`; added `OutboxEnvMappingInput`; simplified `mapOutboxEnvToOptions` |
| `libs/infrastructure/src/outbox/outbox-processor.options.schema.spec.ts` | Refocused on `mapOutboxEnvToOptions` and compute helpers with explicit input objects                                                                             |
| `libs/infrastructure/src/config/env.schema.spec.ts`                      | Ported outbox cross-field validation coverage from deleted duplicate schema                                                                                      |

## Completed steps

1. **Factory-based processor registration** — `createOutboxProcessorClass()` + `outboxProcessorProvider` wired in `WorkerModule`.
2. **Worker composition root** — static `OutboxProcessor` removed; `OutboxProcessorModule.forRootAsync` unchanged and resolves before provider factory.
3. **Removed Path A from infrastructure** — no `process.env` reads in outbox defaults/helpers.
4. **Consolidated env validation** — `env.schema.ts` remains sole runtime env parser; `mapOutboxEnvToOptions()` accepts `OutboxEnvMappingInput`.
5. **Test migration** — cross-field rules moved to `env.schema.spec.ts`; mapper/compute tests retained in options schema spec; factory metadata unit test added.
6. **Export cleanup** — deleted symbols had no barrel re-exports; grep confirms no remaining production references.
7. **Verification** — targeted tests, `build:worker`, full `build`, full `lint`, full unit suite executed.

## Deviations

| Plan wording                                                                             | Actual implementation                                 | Reason                                                                                                                                                                                                                           |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `useFactory` returns `createOutboxProcessorClass(...)` class (Nest treats as `useClass`) | Factory returns `new ProcessorClass(outbox)` instance | `@nestjs/bullmq` `BullExplorer.registerWorkers()` resolves processor metadata from `wrapper.instance.constructor` when `wrapper.inject` is set (useFactory path). Returning an instance is required for BullMQ discovery and DI. |

## Commands executed

| Command                                                                                                                                                                                                                     | Result                                     | Conclusion                                                    |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------- |
| `npx jest --config jest.unit.config.ts apps/worker/src/processors/create-outbox-processor.spec.ts libs/infrastructure/src/outbox/outbox-processor.options.schema.spec.ts libs/infrastructure/src/config/env.schema.spec.ts` | Pass (32 tests)                            | Targeted P2-08 tests pass                                     |
| `npx nest build worker`                                                                                                                                                                                                     | Pass                                       | Worker entrypoint compiles with new provider wiring           |
| `npm run build`                                                                                                                                                                                                             | Pass                                       | All entrypoints compile                                       |
| `npm run lint`                                                                                                                                                                                                              | Pass                                       | Full-repo lint gate passes (outbox dead-symbol debt resolved) |
| `npx jest --config jest.unit.config.ts`                                                                                                                                                                                     | Pass (106 tests)                           | Full unit suite passes                                        |
| `rg "buildOutboxProcessorDecoratorOptions\|resolveOutboxOptionsFromEnv\|outboxProcessorEnvSchema\|parseOutboxProcessorEnv" apps/ libs/`                                                                                     | No matches                                 | Deleted symbols removed from production code                  |
| `rg "process\.env" libs/infrastructure/src/outbox/`                                                                                                                                                                         | No matches in config/defaults/schema files | Only unrelated int-spec DATABASE_URL fallback remains         |

## Command results

- **Targeted and full unit tests:** pass with runtime evidence.
- **Build and lint:** pass; P2-08 resolves the pre-existing outbox lint failures cited in P2-07 report.
- **Worker bootstrap (`npm run start:worker`):** not executed — requires local Redis + PostgreSQL; optional per plan.

## Acceptance criteria self-check

| Criterion                                                                                                                  | Status                                                               |
| -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Single typed source of truth for outbox worker concurrency (`AppConfigService.outbox()` / `TOKENS.OutboxProcessorOptions`) | Met                                                                  |
| No `process.env` read in reusable outbox decorator/helper code                                                             | Met                                                                  |
| BullMQ outbox worker `concurrency` matches `OutboxProcessorOptions.concurrency` from typed config pipeline                 | Met — unit test on `WORKER_METADATA`; provider injects typed options |
| Invalid outbox env does not silently fall back via parallel parser                                                         | Met — Path A removed; fail-fast via `env.schema.ts` only             |
| Dead imports/constants removed                                                                                             | Met                                                                  |
| `npm run build:worker`, `npm run build`, targeted unit tests, `npm run lint` pass                                          | Met                                                                  |
| Worker entrypoint boundary preserved; Cron/API unchanged                                                                   | Met                                                                  |

## Remaining risks

1. **Dynamic processor discovery at runtime** — unit test confirms metadata wiring; live Worker bootstrap against Redis was not executed in this environment.
2. **`npm run test:unit` npm script** — intermittently exited with Windows access violation (`-1073741819`); equivalent `npx jest --config jest.unit.config.ts` completed successfully with 106/106 tests.

## Unverified areas

- `npm run start:worker` with `OUTBOX_CONCURRENCY=2` against live Redis/PostgreSQL (optional plan scenario).
- End-to-end BullMQ worker concurrency under load (beyond metadata unit test).
