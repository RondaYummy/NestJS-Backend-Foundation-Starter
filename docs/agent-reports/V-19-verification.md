# V-19 — Independent verification

## Verdict

**approved**

## Scope checked

V-19 is a verification backlog item. The underlying fix was delivered by **P2-13** (commit `85eda48`, plan `docs/agent-plans/P2-13-outbox-scheduler-options-for-cron.md` — `status: approved`).

Implementation scope matches the approved P2-13 / V-19 plans with no unrelated production changes on `main`:

| Artifact | Role |
| -------- | ---- |
| `libs/infrastructure/src/outbox/outbox-processor-options.module.ts` | Lightweight options-only module |
| `libs/infrastructure/src/outbox/outbox-processor-options.module.spec.ts` | Isolated DI test |
| `libs/infrastructure/src/outbox/outbox-processor.module.ts` | Composes options module internally |
| `apps/cron/src/cron.module.ts` | Slim composition — no Drizzle/OutboxProcessorModule |
| `apps/cron/src/cron.module.spec.ts` | Import-graph + DI regression test |
| `README.md` | §3.3 + runtime configuration documentation |

Out of scope respected: no `envSchema` split, no `OutboxSchedule` behavior change, no Worker processor logic changes.

**Note:** `docs/agent-backlog/INDEX.md` is staged for deletion on the working tree — unrelated to V-19 composition; does not affect this verdict.

## Root-cause assessment

**Root cause (confirmed):** `CronModule` imported `OutboxProcessorModule` solely to obtain `TOKENS.OutboxProcessorOptions`, which transitively pulled in PostgreSQL (`DrizzleModule`), audit/events infrastructure, and unnecessary queue visibility for processor handlers.

**Fix (confirmed):** Options registration extracted to `OutboxProcessorOptionsModule`; `CronModule` imports only that lightweight module; `OutboxProcessorModule` composes the options submodule internally so Worker call sites stay unchanged.

### DI chain (after fix)

```text
CronModule
  ├─ OutboxProcessorOptionsModule.forRootAsync()
  │    └─ TOKENS.OutboxProcessorOptions
  ├─ RedisModule + LocksModule → TOKENS.DistributedLock
  └─ InfrastructureBullMqModule → TOKENS.QueueGateway (QUEUES.OUTBOX)

OutboxSchedule
  → injects QueueGateway, DistributedLock, OutboxProcessorOptions
  → does NOT inject OutboxProcessor or DRIZZLE_DB

WorkerModule (unchanged)
  └─ OutboxProcessorModule.forRootAsync()
       ├─ OutboxProcessorOptionsModule.forRootAsync()
       ├─ DrizzleOutboxProcessor → TOKENS.OutboxProcessor
       └─ outboxProcessorProvider
```

Static inspection: `apps/cron/src/cron.module.ts` has no imports from `@infrastructure/database/drizzle/drizzle.module` or `@infrastructure/outbox/outbox-processor.module`. Only `apps/worker/src/worker.module.ts` imports `OutboxProcessorModule` among entrypoints.

## Acceptance criteria matrix

| ID | Criterion | Result | Evidence |
| -- | --------- | ------ | -------- |
| AC-1 | P2-13 fix implemented and scoped correctly | **passed** | Commit `85eda48`; files match plan; no scope expansion |
| AC-2 | `CronModule` has no `DrizzleModule` / `drizzleModule` | **passed** | `cron.module.ts` inspection; `cron.module.spec.ts` static + DI checks; `DRIZZLE_DB` throws on `moduleRef.get()` |
| AC-3 | `CronModule` has no `OutboxProcessorModule` | **passed** | No import in `cron.module.ts`; startup logs show `OutboxProcessorOptionsModule` only; no `TOKENS.OutboxProcessor` in Cron tree |
| AC-4 | `OutboxSchedule` receives typed `OutboxProcessorOptions` | **passed** | `OutboxSchedule` injects `TOKENS.OutboxProcessorOptions`; DI test resolves token via `OutboxProcessorOptionsModule` |
| AC-5 | Worker remains sole outbox processor entrypoint | **passed** | `worker.module.ts` unchanged — `OutboxProcessorModule.forRootAsync` + `outboxProcessorProvider` |
| AC-6 | `OutboxProcessorModule` composes options module internally | **passed** | `forRoot` / `forRootAsync` import `OutboxProcessorOptionsModule.forRoot*` |
| AC-7 | `npm run build:cron` passes | **passed** | Exit 0 (independent run) |
| AC-8 | `npm run build:worker` passes | **passed** | Exit 0 (independent run) |
| AC-9 | Cron + options DI specs pass | **passed** | 3 targeted specs — 8 tests total, all passed |
| AC-10 | README documents thin Cron composition | **passed** | §3.3 describes thin scheduler; L1207–1208 documents options vs processor module split |
| AC-11 | Optional Cron bootstrap without PG | **passed** | `npm run start:cron` — Nest context started; Redis check passed; no PG/Drizzle pool logs |

## Dependency and DI verification

- **`OutboxProcessorOptionsModule`:** `ConfigurableModuleBuilder<OutboxProcessorOptions>` with `optionsInjectionToken: TOKENS.OutboxProcessorOptions`; `global: false`; explicit export of `TOKENS.OutboxProcessorOptions`.
- **`OutboxProcessorModule`:** Delegates options to submodule via `OutboxProcessorOptionsModule.forRoot*`; retains `DrizzleOutboxProcessor`, `TOKENS.OutboxProcessor`, and `buildFeatureImports` (Audit, Events, Logger).
- **Contracts:** `OutboxProcessorOptions` interface and `TOKENS.OutboxProcessorOptions` unchanged.
- **`OutboxSchedule`:** Injection surface unchanged — still `QueueGateway`, `DistributedLock`, `OutboxProcessorOptions` only.

## Commands executed

| Command | Result | Conclusion |
| ------- | ------ | ---------- |
| `npm run test:module -- libs/infrastructure/src/outbox/outbox-processor-options.module.spec.ts --forceExit` | Exit 0; 1/1 passed | Options token resolves without Drizzle |
| `npm run test:module -- apps/cron/src/cron.module.spec.ts --forceExit` | Exit 0; 2/2 passed | Primary V-19 composition evidence |
| `npm run test:unit -- apps/cron/src/schedules/outbox.schedule.spec.ts --forceExit --runInBand` | Exit 0; 5/5 passed (first attempt EPIPE worker crash; retry succeeded) | No schedule behavior regression |
| `npm run build:cron` | Exit 0 | Cron compiles without Drizzle in composition root |
| `npm run build:worker` | Exit 0 | Processor refactor does not break Worker |
| `npm run lint` | Exit 0 | No lint regressions |
| `npm run start:cron` (Redis at 127.0.0.1) | Nest context started; `OutboxProcessorOptionsModule dependencies initialized`; no PG pool messages | AC-11 satisfied |

**Script note:** Module bootstrap specs correctly run via `npm run test:module` per V-14 Jest suite split (plan references `test:unit` for `*.module.spec.ts`; `test:module` is the correct script).

## Findings

1. **Composition minimality achieved.** Cron entrypoint is a thin scheduler: distributed lock + BullMQ enqueue only. No runtime PostgreSQL coupling.
2. **Regression guard in place.** `cron.module.spec.ts` combines static source inspection with Nest DI compile test — build-only checks alone would not catch this class of defect.
3. **Worker path preserved.** Full outbox processor stack remains in Worker; no breaking change to public module APIs.
4. **P2-13 verification exists separately** (`docs/agent-reports/P2-13-verification.md`, verdict approved). V-19 independently re-confirms the verification scenario from the V-19 plan perspective.

## Documentation alignment

- `README.md` §3.3: Cron described as thin scheduler (lock + enqueue; Worker processes outbox rows).
- `README.md` L1207–1208: Cron uses `OutboxProcessorOptionsModule.forRootAsync()`; Worker uses `OutboxProcessorModule.forRootAsync()`.

Documentation matches implementation.

## Remaining risks

1. **`DATABASE_URL` still required in env** for Cron via `InfrastructureConfigModule` full schema validation — runtime PG connection removed, but env validation is not (documented post-fix limitation per plan; not a V-19 failure).
2. **Cron runtime depends on Redis availability** — bootstrap correctly calls `assertRedisAvailable` before Nest context creation.
3. **Jest worker EPIPE on Windows** — transient infrastructure flake observed on first `outbox.schedule.spec.ts` run; resolved with `--runInBand` retry. Not a code defect.

## Unverified areas

- Full `npm run test:all` / `npm run build` (all entrypoints) not executed in this V-19 session — P2-13 verification report documents full build and unit gate green.
- Long-running Cron process shutdown / SIGTERM graceful behavior not in V-19 scope.
