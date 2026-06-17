# P2-01 — Implementation report

## Verdict

implemented

## Approved plan

`docs/agent-plans/P2-01-outbox-runtime-configuration.md` (`status: approved`)

## Changed files

### Created

| Path                                                                     | Purpose                                       |
| ------------------------------------------------------------------------ | --------------------------------------------- |
| `libs/contracts/src/outbox/outbox-processor.options.ts`                  | `OutboxProcessorOptions` contract             |
| `libs/infrastructure/src/outbox/outbox-processor.defaults.ts`            | Safe defaults and env-backed decorator helper |
| `libs/infrastructure/src/outbox/outbox-processor.options.schema.ts`      | Zod env schema and env → options mapper       |
| `libs/infrastructure/src/outbox/outbox-processor.options.schema.spec.ts` | Validation unit tests                         |
| `libs/infrastructure/src/outbox/drizzle-outbox-processor.spec.ts`        | Processor option usage unit tests             |

### Modified

| Path                                                             | Change                                                                 |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `libs/contracts/src/tokens.ts`                                   | Added `TOKENS.OutboxProcessorOptions`                                  |
| `libs/infrastructure/src/config/env.schema.ts`                   | Added `OUTBOX_*` env keys and cross-field validation                   |
| `libs/infrastructure/src/config/infrastructure-config.module.ts` | Maps validated env to `outbox` config section                          |
| `libs/infrastructure/src/config/app-config.service.ts`           | Added `outbox()` accessor                                              |
| `libs/infrastructure/src/outbox/outbox-processor.module.ts`      | Dynamic `forRoot` / `forRootAsync` via `ConfigurableModuleBuilder`     |
| `libs/infrastructure/src/outbox/drizzle-outbox-processor.ts`     | Injects options; removed hardcoded constants                           |
| `apps/worker/src/worker.module.ts`                               | `OutboxProcessorModule.forRootAsync` from `AppConfigService.outbox()`  |
| `apps/worker/src/processors/outbox.processor.ts`                 | BullMQ concurrency from `buildOutboxProcessorDecoratorOptions()`       |
| `apps/cron/src/cron.module.ts`                                   | Same `forRootAsync` options factory as worker                          |
| `apps/cron/src/schedules/outbox.schedule.ts`                     | DI-driven `pollIntervalMs` and `cronLockTtlMs` via `SchedulerRegistry` |
| `libs/infrastructure/src/infrastructure.module.ts`               | `OutboxProcessorModule.forRoot()` for barrel defaults                  |
| `.env.example`                                                   | Documented `OUTBOX_*` variables                                        |
| `README.md`                                                      | Outbox runtime tuning subsection                                       |

## Completed steps

1. Added `OutboxProcessorOptions` contract and `TOKENS.OutboxProcessorOptions`.
2. Implemented defaults, Zod schema, and env integration (`env.schema`, `infrastructure-config.module`, `app-config.service`).
3. Converted `OutboxProcessorModule` to `forRoot` / `forRootAsync` with `ConfigurableModuleBuilder`.
4. Updated `DrizzleOutboxProcessor` to inject options; removed `MAX_ATTEMPTS`, `BATCH_SIZE`, `LOCK_TTL_MS`, and inline backoff formula.
5. Wired worker composition root with `forRootAsync` and env-backed `@Processor` concurrency helper.
6. Wired cron composition root with the same options factory; replaced `@Cron` with `SchedulerRegistry` interval scheduling.
7. Updated `InfrastructureModule` barrel to `OutboxProcessorModule.forRoot()`.
8. Updated `.env.example` and `README.md`.
9. Added schema and processor unit tests.

## Deviations

| Item                                      | Notes                                                                                                                                                                                         |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cron imports full `OutboxProcessorModule` | Matches approved plan. Cron now transitively loads Drizzle/Events/Audit providers even though it only schedules jobs. A lightweight options-only module remains an open question in the plan. |
| `@Processor` concurrency                  | Uses env-backed `buildOutboxProcessorDecoratorOptions()` at class definition time (approved plan recommendation). Runtime `forRoot` overrides do not automatically change decorator metadata. |
| BullMQ job timeout                        | Not added (plan out of scope). Documented relationship in README only.                                                                                                                        |

P0-02 lease renewal and ownership checks (`lockedBy` guards on `markProcessed` / `markFailed`, `outbox.ownershipLost` audit path) were not modified beyond replacing constant sources with injected options.

## Commands executed

```bash
npm run build
node node_modules/jest/bin/jest.js --config jest.unit.config.ts libs/infrastructure/src/outbox/outbox-processor.options.schema.spec.ts libs/infrastructure/src/outbox/drizzle-outbox-processor.spec.ts
node node_modules/jest/bin/jest.js --config jest.unit.config.ts
npx eslint <changed source files> --max-warnings=0
git status
git diff --stat
```

## Command results

| Command                    | Result                          | Conclusion                                                                                                                           |
| -------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `npm run build`            | Exit 0                          | API, worker, cron, and migrations compile                                                                                            |
| Outbox targeted Jest       | Exit 0, 6 tests passed          | Schema validation and processor option usage verified                                                                                |
| Full unit Jest             | Exit 0, 12 tests passed         | No regressions in unit suite                                                                                                         |
| ESLint on changed files    | Exit 0                          | Changed files are lint-clean                                                                                                         |
| `npm run lint` (full repo) | Exit 1                          | Pre-existing failure in `libs/infrastructure/src/mail/null-mail.adapter.ts` (`@typescript-eslint/require-await`); unrelated to P2-01 |
| `git diff --stat`          | 13 modified files + 5 new files | Production-code diff is non-empty                                                                                                    |

`npm run build:worker`, `npm run build:cron`, `npm run start:worker`, and `npm run start:cron` were not run separately; `npm run build` already builds worker and cron entrypoints successfully.

## Acceptance criteria self-check

| Criterion                              | Status | Evidence                                                                                                          |
| -------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------- |
| Runtime policy set by composition root | Met    | `worker.module.ts` and `cron.module.ts` use `OutboxProcessorModule.forRootAsync` with `AppConfigService.outbox()` |
| No policy constants in processor       | Met    | `drizzle-outbox-processor.ts` uses `this.options.*` only                                                          |
| Safe defaults                          | Met    | `OUTBOX_PROCESSOR_DEFAULT_OPTIONS` and env schema defaults match prior hardcoded values                           |
| Values validated                       | Met    | Zod in `env.schema` and `outbox-processor.options.schema`; 4 schema unit tests                                    |
| README tuning guidance                 | Met    | New subsection under Outbox Module                                                                                |

## Remaining risks

- Cron entrypoint now initializes Drizzle-related providers because it imports the full `OutboxProcessorModule`.
- `@Processor` concurrency reads env at module load time; changing options only through programmatic `forRoot` without aligning env would desync decorator metadata.
- `lockTtlMs` must remain greater than worst-case handler duration to avoid duplicate reclaim under concurrency > 1 (documented in README).

## Unverified areas

- Runtime bootstrap of worker and cron with live PostgreSQL/Redis (`npm run start:worker`, `npm run start:cron`).
- Full-repo `npm run lint` pass (blocked by pre-existing unrelated lint error).
- Independent verification agent review.
