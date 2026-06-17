# P2-01 — Independent verification

## Verdict

approved

## Scope checked

- Source issue: `docs/agent-backlog/NESTJS_STARTER_KIT_REQUIRED_FIXES.md` §9 (Outbox runtime constants → typed configuration).
- Approved plan: `docs/agent-plans/P2-01-outbox-runtime-configuration.md` (`status: approved`).
- Implementation report: `docs/agent-reports/P2-01-implementation.md` (used as a pointer only; claims re-verified independently).
- Git state: 13 modified + 7 new/untracked files; all align with the approved plan file list. No unrelated production refactors observed.
- Out of scope respected: no BullMQ job timeout, no P0-02 heartbeat implementation, no Outbox writer changes, no schema migrations.

## Root-cause assessment

**Root cause (confirmed):** Outbox runtime policy (batch size, retry limits, lock lease, backoff, poll cadence, worker concurrency) was embedded as module-level constants or implicit framework defaults, preventing composition roots from tuning behavior without editing infrastructure internals.

**Fix assessment:** The implementation addresses the root cause by introducing `OutboxProcessorOptions`, a `TOKENS.OutboxProcessorOptions` injection token, `OutboxProcessorModule.forRoot` / `forRootAsync`, env-backed validation, and composition-root wiring in Worker and Cron. `DrizzleOutboxProcessor` no longer contains `MAX_ATTEMPTS`, `BATCH_SIZE`, `LOCK_TTL_MS`, or inline backoff math. This is a structural fix, not a symptom suppressor.

## Acceptance criteria matrix

| #   | Criterion                                         | Status     | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --- | ------------------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | All Outbox runtime policy values are configurable | **passed** | `OutboxProcessorOptions` covers `batchSize`, `maxAttempts`, `lockTtlMs`, `pollIntervalMs`, `cronLockTtlMs`, `concurrency`, `retryDelaySeconds`. Env keys `OUTBOX_*` in `env.schema.ts`; mapped via `AppConfigService.outbox()` and `forRootAsync` in Worker/Cron.                                                                                                                                                                                   |
| 2   | Defaults are safe and defined in one place        | **passed** | Canonical defaults in `OUTBOX_PROCESSOR_DEFAULT_OPTIONS` (`outbox-processor.defaults.ts`) match pre-change behavior (50 / 10 / 300_000 / 60_000 / 55_000 / 1 / exponential backoff). `forRoot()` without args uses these defaults. `env.schema` defaults are aligned (duplicated for validation, same values).                                                                                                                                      |
| 3   | Invalid values fail during startup                | **passed** | `InfrastructureConfigModule` `validate` runs `envSchema.safeParse` and throws `Invalid env: …` on failure, including `OUTBOX_CRON_LOCK_TTL_MS >= OUTBOX_POLL_INTERVAL_MS` and retry delay cross-checks. Unit tests in `outbox-processor.options.schema.spec.ts` cover rejection paths.                                                                                                                                                              |
| 4   | Worker provides the options explicitly            | **passed** | `worker.module.ts` registers `OutboxProcessorModule.forRootAsync({ inject: [AppConfigService], useFactory: (c) => c.outbox() })`. `@Processor` concurrency uses `buildOutboxProcessorDecoratorOptions()` per approved plan (env-backed decorator limitation documented in plan deviations).                                                                                                                                                         |
| 5   | Lock TTL is compatible with lease heartbeat       | **passed** | No lease heartbeat/renewal exists in `drizzle-outbox-processor.ts` (P0-02 heartbeat remains an open backlog item; out of P2-01 scope). Injectable `this.options.lockTtlMs` drives `expiredLockAt` reclaim; `lockedBy` ownership guards on `markProcessed` / `markFailed` are preserved. Configurable TTL does not conflict with a future heartbeat that would read the same options token. README documents `lockTtlMs` vs handler duration tuning. |
| 6   | No direct `process.env` usage was introduced      | **passed** | Grep of changed outbox/config/worker/cron files finds one intentional use: `resolveOutboxOptionsFromEnv(env = process.env)` in `outbox-processor.defaults.ts` for BullMQ `@Processor` decorator metadata (approved plan deviation). `DrizzleOutboxProcessor`, `OutboxSchedule`, dynamic module, and config services do not read `process.env`.                                                                                                      |
| 7   | Module portability from P1 remains intact         | **passed** | `OutboxProcessorModule` exposes `forRoot` / `forRootAsync` with `TOKENS.OutboxProcessorOptions`; `global: false`; exports processor + options tokens. Consumers can pass custom options without `AppConfigService` (`forRoot(customOptions)`). Barrel `InfrastructureModule` uses `forRoot()` defaults. All static `OutboxProcessorModule` imports replaced with dynamic registration.                                                              |
| 8   | Build and relevant tests pass                     | **passed** | `npm run build`, `npm run build:worker`, `npm run build:cron` exit 0. Targeted outbox Jest: 6/6 passed. Full `npm run test:unit`: 12/12 passed. `npm run lint` fails on pre-existing `null-mail.adapter.ts` only (unrelated).                                                                                                                                                                                                                       |

### Plan acceptance criteria (additional)

| Plan criterion                         | Status     | Evidence                                                                                                         |
| -------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------- |
| Runtime policy set by composition root | **passed** | Worker + Cron `forRootAsync`; no policy constants in processor                                                   |
| Safe defaults                          | **passed** | `OUTBOX_PROCESSOR_DEFAULT_OPTIONS` + env defaults                                                                |
| Values validated                       | **passed** | Zod in `env.schema` + `outbox-processor.options.schema`; 4 schema unit tests                                     |
| README tuning guidance                 | **passed** | README § Outbox Module “Runtime configuration” subsection with batch/concurrency/lockTtl/poll/cron relationships |

## Dependency and DI verification

```text
Worker (OutboxProcessor BullMQ consumer)
  OutboxProcessor.process()
    -> TOKENS.OutboxProcessor (IOutboxProcessor)
      -> DrizzleOutboxProcessor (useExisting provider)
        -> TOKENS.OutboxProcessorOptions (injected options)
          -> OutboxProcessorModule.forRootAsync factory
            -> AppConfigService.outbox()
              -> InfrastructureConfigModule validate (envSchema → mapOutboxEnvToOptions)

Cron (OutboxSchedule)
  OutboxSchedule.tick()
    -> TOKENS.OutboxProcessorOptions (pollIntervalMs, cronLockTtlMs)
    -> TOKENS.DistributedLock, TOKENS.QueueGateway
  Options from same forRootAsync factory as Worker

Barrel (InfrastructureModule)
  OutboxProcessorModule.forRoot() → OUTBOX_PROCESSOR_DEFAULT_OPTIONS
```

- `DrizzleOutboxProcessor` injects `@Inject(TOKENS.OutboxProcessorOptions)`.
- `OutboxSchedule` injects `@Inject(TOKENS.OutboxProcessorOptions)` for `pollIntervalMs` and `cronLockTtlMs`.
- `ConfigurableModuleBuilder` binds `optionsInjectionToken: TOKENS.OutboxProcessorOptions`.
- Worker and Cron share the same `AppConfigService.outbox()` factory (no worker/cron policy drift via env).

## Commands executed

| Command                                                                                                                                                                        | Result                                                             | Conclusion                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ | ----------------------------------------------------- |
| `git status`                                                                                                                                                                   | 13 modified, 7 untracked (plan/docs + new outbox files)            | Diff scope matches P2-01                              |
| `git diff` (key files)                                                                                                                                                         | Confirms constant removal, `forRootAsync`, dynamic module          | Implementation matches plan                           |
| `npm run build`                                                                                                                                                                | Exit 0                                                             | API, worker, cron, migrations compile                 |
| `npm run build:worker`                                                                                                                                                         | Exit 0                                                             | Worker entrypoint compiles                            |
| `npm run build:cron`                                                                                                                                                           | Exit 0                                                             | Cron entrypoint compiles                              |
| `npx jest libs/infrastructure/src/outbox/outbox-processor.options.schema.spec.ts libs/infrastructure/src/outbox/drizzle-outbox-processor.spec.ts --config jest.unit.config.ts` | Exit 0, 6 tests passed                                             | Schema validation and processor option usage verified |
| `npm run test:unit`                                                                                                                                                            | Exit 0, 12 tests passed                                            | No unit regressions                                   |
| `npm run lint`                                                                                                                                                                 | Exit 1 — `null-mail.adapter.ts` `@typescript-eslint/require-await` | Pre-existing failure; no outbox-related lint errors   |

## Findings

1. **Hardcoded constants removed** from `drizzle-outbox-processor.ts`; all policy reads `this.options.*`.
2. **Dynamic module** correctly provides and exports `TOKENS.OutboxProcessorOptions`.
3. **Cron scheduling** moved to DI-driven `setInterval` + `SchedulerRegistry` using injected `pollIntervalMs` (default 60s preserved).
4. **Decorator concurrency limitation** documented: `buildOutboxProcessorDecoratorOptions()` reads env at class-definition time; runtime `forRoot` overrides without env alignment could desync BullMQ concurrency from injectable options (approved plan risk).
5. **Cron imports full `OutboxProcessorModule`** (Drizzle/Events/Audit transitive load) — matches approved plan; lightweight options-only module remains an open question.
6. **`resolveOutboxOptionsFromEnv` silent fallback** on parse failure returns defaults (only used by decorator helper). Main bootstrap path throws via `envSchema`; schemas are currently aligned.
7. **P0-02 heartbeat not present** — lock expiry is still time-since-`lockedAt` only; configurable `lockTtlMs` enables operational tuning but does not implement lease renewal.

## Documentation alignment

- `.env.example` documents all eight `OUTBOX_*` variables with values matching defaults.
- `README.md` adds “Runtime configuration” under Outbox Module with env list and tuning relationships (batch size, concurrency, `lockTtlMs`, poll interval, cron lock, retries).
- Aligns with backlog acceptance criteria and approved plan scope.

## Remaining risks

- `@Processor` concurrency is not fully DI-driven; env/decorator path can diverge from programmatic `forRoot` overrides.
- Cron entrypoint initializes full outbox processor module graph (heavier than scheduling-only needs).
- Without P0-02 heartbeat, long batches can still exceed `lockTtlMs` and allow duplicate reclaim (mitigated by documentation and tunable TTL, not eliminated).
- `resolveOutboxOptionsFromEnv` fallback could mask schema drift between decorator and bootstrap paths if schemas diverge in future edits.

## Unverified areas

- Runtime bootstrap with live PostgreSQL + Redis (`npm run start:worker`, `npm run start:cron`) — infrastructure not exercised in this verification run.
- Full-repo `npm run lint` pass — blocked by pre-existing unrelated `null-mail.adapter.ts` error.
- End-to-end outbox processing under custom `OUTBOX_*` env values at runtime.
