# P2-13 — Independent verification

## Verdict

**approved**

## Scope checked

Implementation matches approved plan `docs/agent-plans/P2-13-outbox-scheduler-options-for-cron.md` with no scope expansion:

| Planned item                                                  | Status    |
| ------------------------------------------------------------- | --------- |
| Create `OutboxProcessorOptionsModule`                         | Done      |
| Refactor `OutboxProcessorModule` to compose options submodule | Done      |
| Slim `CronModule` (remove Drizzle + processor module)         | Done      |
| Add `outbox-processor-options.module.spec.ts`                 | Done      |
| Add `cron.module.spec.ts`                                     | Done      |
| Update `README.md` §3.3 and runtime configuration             | Done      |
| Worker / `outboxProcessorProvider` unchanged                  | Confirmed |

**Out of scope respected:** no `envSchema` split, no `OutboxSchedule` behavior change, no Worker processor logic changes.

**Note:** Three small post-staging refinements exist as **unstaged** changes (explicit `exports` on options module, `NonNullable` typing in processor module, `REDIS_HOST` + `moduleRef.init()` in cron DI test). They are consistent with the plan and required for passing DI tests; they should be staged before commit.

## Root-cause assessment

**Root cause (confirmed):** `CronModule` imported `OutboxProcessorModule` only to obtain `TOKENS.OutboxProcessorOptions`, which transitively pulled in Drizzle, audit/events stack, and unnecessary queue visibility for processor handlers.

**Fix (confirmed):** Options registration extracted to `OutboxProcessorOptionsModule`; `CronModule` imports only that lightweight module; `OutboxProcessorModule` composes the options submodule internally so Worker call sites stay unchanged.

### DI chain (after fix)

```text
CronModule
  └─ OutboxProcessorOptionsModule.forRootAsync()
       └─ TOKENS.OutboxProcessorOptions
            └─ OutboxSchedule (pollIntervalMs, cronLockTtlMs)

WorkerModule (unchanged)
  └─ OutboxProcessorModule.forRootAsync()
       ├─ OutboxProcessorOptionsModule.forRootAsync()  → TOKENS.OutboxProcessorOptions
       ├─ DrizzleOutboxProcessor                       → TOKENS.OutboxProcessor
       └─ outboxProcessorProvider                      → injects both tokens
```

`OutboxSchedule` source is unchanged; injection surface preserved.

## Acceptance criteria matrix

| #   | Criterion                                                                                                                    | Result     | Evidence                                                                                                                                                                                        |
| --- | ---------------------------------------------------------------------------------------------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `CronModule` bootstrap does not require Drizzle/DB for scheduler enqueue path                                                | **passed** | `drizzleModule` removed from `apps/cron/src/cron.module.ts`; no `DrizzleModule` / `mapAppConfigToDrizzleOptions` imports; `cron.module.spec.ts` asserts `DRIZZLE_DB` unavailable                |
| 2   | `OutboxSchedule` receives typed `OutboxProcessorOptions` via `TOKENS.OutboxProcessorOptions` without `OutboxProcessorModule` | **passed** | Cron imports `OutboxProcessorOptionsModule` only; DI test resolves `TOKENS.OutboxProcessorOptions`; `OutboxSchedule` still injects same token                                                   |
| 3   | Worker remains sole entrypoint importing actual outbox processor                                                             | **passed** | `apps/worker/src/worker.module.ts` and `outbox-processor.provider.ts` unchanged; only Worker (+ deprecated `InfrastructureModule` facade, not an entrypoint) references `OutboxProcessorModule` |
| 4   | `npm run build:cron` passes                                                                                                  | **passed** | Exit code 0 (independent run)                                                                                                                                                                   |
| 5   | Cron DI test (`cron.module.spec.ts`) passes                                                                                  | **passed** | 2/2 tests passed (independent run)                                                                                                                                                              |

## Dependency and DI verification

- **`OutboxProcessorOptionsModule`:** `ConfigurableModuleBuilder<OutboxProcessorOptions>` with `optionsInjectionToken: TOKENS.OutboxProcessorOptions`; `global: false`; explicit export of `TOKENS.OutboxProcessorOptions` in `forRoot` / `forRootAsync`.
- **`OutboxProcessorModule`:** Delegates options to submodule; retains `DrizzleOutboxProcessor`, `TOKENS.OutboxProcessor`, and `buildFeatureImports` (Audit, Events, Logger). Public `forRoot` / `forRootAsync` signatures preserved. `OUTBOX_PROCESSOR_MODULE_OPTIONS_TOKEN` re-exported from options module for backward compatibility.
- **Contracts:** `OutboxProcessorOptions` interface and `TOKENS.OutboxProcessorOptions` unchanged.
- **Cron import graph:** No `DrizzleModule` or `OutboxProcessorModule` in `cron.module.ts` (static test + file inspection).

## Commands executed

| Command                                                     | Result                       | Conclusion                                                              |
| ----------------------------------------------------------- | ---------------------------- | ----------------------------------------------------------------------- |
| `npm run build:cron`                                        | Exit 0                       | Cron compiles without Drizzle in composition root                       |
| `npm run build:worker`                                      | Exit 0                       | Processor refactor does not break Worker                                |
| `npm run build:api`                                         | Exit 0                       | API entrypoint unaffected                                               |
| `npm run build:migrations`                                  | Exit 0                       | Migrations entrypoint unaffected                                        |
| `npm run test:unit -- outbox-processor-options.module.spec` | 1 suite / 1 test passed      | Options token resolves in isolation                                     |
| `npm run test:unit -- cron.module.spec --forceExit`         | 1 suite / 2 tests passed     | Cron DI + import-graph checks pass                                      |
| `npm run test:unit -- outbox.schedule.spec --forceExit`     | 1 suite / 5 tests passed     | Schedule behavior unchanged                                             |
| `npm run lint`                                              | Exit 0                       | No lint regressions                                                     |
| `npm run test:unit -- --forceExit`                          | 26 suites / 126 tests passed | Full unit gate green                                                    |
| `npm run build`                                             | Exit 0 (verifier re-run)     | All entrypoints compile; subagent session had shell crash (-1073741819) |
| `npm run start:cron`                                        | Not run                      | Runtime bootstrap not verified                                          |

## Findings

### Positive

1. Root architectural coupling removed: Cron no longer opens PostgreSQL or loads outbox processor/event-routing stack.
2. Options module is minimal and testable in isolation (`outbox-processor-options.module.spec.ts`).
3. Worker composition and `outboxProcessorProvider` DI chain preserved without import changes.
4. Documentation updated in `README.md` to describe thin Cron scheduler vs Worker processor split.
5. All plan-targeted and full unit tests pass under independent execution.

### Minor observations (non-blocking)

1. **Unstaged refinements** should be included in the commit: explicit `exports` on `OutboxProcessorOptionsModule`, `REDIS_HOST` in cron test env, `moduleRef.init()` before close.
2. **`npm run build`** succeeded on verifier re-run (exit 0); an earlier subagent shell session hit a Windows access violation — not attributed to this change.
3. Cron still validates full `envSchema` including `DATABASE_URL` via `InfrastructureConfigModule` — documented out-of-scope limitation per plan.

## Documentation alignment

`README.md` updates align with implementation:

- §3.3 states Cron is a thin scheduler (lock + enqueue only).
- Runtime configuration section distinguishes `OutboxProcessorOptionsModule` (Cron) vs `OutboxProcessorModule` (Worker).

## Remaining risks

| Risk                                                                  | Severity | Notes                                                    |
| --------------------------------------------------------------------- | -------- | -------------------------------------------------------- |
| Cron env still requires `DATABASE_URL` despite no PG pool             | Low      | Known out-of-scope; config validation only               |
| Nest nested-module export visibility                                  | Low      | Mitigated by explicit `exports` on options module        |
| Jest `--forceExit` for cron/schedule tests                            | Low      | Open handles from BullMQ/intervals; pre-existing pattern |
| `InfrastructureModule` deprecated facade still imports full processor | Low      | Unchanged per plan; not a Cron entrypoint concern        |

## Unverified areas

- `npm run start:cron` bootstrap with live Redis/BullMQ and log inspection confirming no PostgreSQL connection attempt.
