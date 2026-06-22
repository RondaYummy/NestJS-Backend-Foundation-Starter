# P2-13 — Implementation report

## Verdict

implemented

## Approved plan

`docs/agent-plans/P2-13-outbox-scheduler-options-for-cron.md` — `status: approved`

## Changed files

| Path                                                                     | Change                                                                                                                     |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `libs/infrastructure/src/outbox/outbox-processor-options.module.ts`      | **Created** — lightweight `ConfigurableModuleBuilder` module registering/exporting only `TOKENS.OutboxProcessorOptions`.   |
| `libs/infrastructure/src/outbox/outbox-processor-options.module.spec.ts` | **Created** — isolated DI test for options module without config/Drizzle.                                                  |
| `libs/infrastructure/src/outbox/outbox-processor.module.ts`              | **Modified** — composes `OutboxProcessorOptionsModule` internally; processor stack unchanged for Worker.                   |
| `apps/cron/src/cron.module.ts`                                           | **Modified** — removed `DrizzleModule` and `OutboxProcessorModule`; uses `OutboxProcessorOptionsModule.forRootAsync` only. |
| `apps/cron/src/cron.module.spec.ts`                                      | **Created** — static import-graph check + Cron DI compile test (no `DRIZZLE_DB`).                                          |
| `README.md`                                                              | **Modified** — §3.3 thin-scheduler note; runtime configuration split Cron vs Worker modules.                               |

## Completed steps

1. Created `OutboxProcessorOptionsModule` with `forRoot` / `forRootAsync`, `global: false`, explicit export of `TOKENS.OutboxProcessorOptions`.
2. Refactored `OutboxProcessorModule` to delegate options registration to the new submodule while preserving Worker-facing `forRoot` / `forRootAsync` API.
3. Slimmed `CronModule` to scheduler-only imports (Redis, locks, BullMQ OUTBOX queue, options module).
4. Added `outbox-processor-options.module.spec.ts` and `cron.module.spec.ts`.
5. Updated `README.md` §3.3 and runtime configuration paragraph.
6. Confirmed `apps/worker/src/worker.module.ts` unchanged.

## Deviations

None. `OutboxProcessorOptionsModule` name used per plan recommendation (open question #1).

## Commands executed

```bash
npm run build:cron
npm run build:worker
npm run test:unit -- outbox-processor-options.module.spec
npm run test:unit -- cron.module.spec --forceExit
npm run test:unit -- outbox.schedule.spec --forceExit
npm run build
npm run lint
npm run test:unit -- --forceExit
```

## Command results

| Command                                                     | Result                                 | Conclusion                                        |
| ----------------------------------------------------------- | -------------------------------------- | ------------------------------------------------- |
| `npm run build:cron`                                        | Exit code 0                            | Cron compiles without Drizzle in composition root |
| `npm run build:worker`                                      | Exit code 0                            | Processor module refactor did not break Worker    |
| `npm run test:unit -- outbox-processor-options.module.spec` | 1 passed                               | Options token resolves in isolation               |
| `npm run test:unit -- cron.module.spec --forceExit`         | 2 passed                               | Cron DI + import-graph checks pass                |
| `npm run test:unit -- outbox.schedule.spec --forceExit`     | 5 passed                               | Existing schedule behavior unchanged              |
| `npm run build`                                             | Exit code 0                            | All entrypoints compile                           |
| `npm run lint`                                              | Exit code 0                            | No new lint issues                                |
| `npm run test:unit -- --forceExit`                          | 26 suites / 126 tests passed           | Full unit gate green                              |
| `npm run start:cron`                                        | Not completed (shell exit -1073741819) | Runtime bootstrap not confirmed in this session   |

## Acceptance criteria self-check

| Criterion                                                                                | Status | Evidence                                                                                              |
| ---------------------------------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------- |
| `CronModule` bootstrap does not require Drizzle/DB for scheduler enqueue path            | Pass   | `drizzleModule` removed from `cron.module.ts`; `cron.module.spec.ts` asserts `DRIZZLE_DB` unavailable |
| `OutboxSchedule` receives typed `OutboxProcessorOptions` without `OutboxProcessorModule` | Pass   | Cron imports `OutboxProcessorOptionsModule`; DI test resolves `TOKENS.OutboxProcessorOptions`         |
| Worker remains sole entrypoint with actual outbox processor                              | Pass   | `worker.module.ts` unchanged; still imports `OutboxProcessorModule` + `outboxProcessorProvider`       |
| `npm run build:cron` passes                                                              | Pass   | Command exit 0                                                                                        |
| Cron DI test passes                                                                      | Pass   | `cron.module.spec.ts`                                                                                 |

## Remaining risks

- Cron still validates full `envSchema` (including `DATABASE_URL`) via `InfrastructureConfigModule` even though it no longer opens a PG pool — documented out-of-scope limitation.
- `OutboxProcessorModule` now depends on child-module export visibility; explicit `exports` added on options module to avoid Nest DI gaps.
- Cron unit test uses `--forceExit` due to BullMQ/interval open handles in test teardown (pre-existing pattern risk for CI).

## Unverified areas

- `npm run start:cron` bootstrap with live Redis/BullMQ and log inspection confirming no PostgreSQL connection attempt.
- Independent verification (`docs/agent-plans/V-19-cron-minimal-composition.md`) not run by implementer.
