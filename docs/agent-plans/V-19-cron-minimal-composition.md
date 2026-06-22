---
issue_id: V-19
status: approved
owner: human-approval-required
---

# V-19 — Cron composition does not import DB/outbox processor when only enqueueing jobs

## Source issue

`docs/agent-backlog/NESTJS_STARTER_KIT_REQUIRED_FIXES.md` — verification backlog row **V-19**:

> Cron composition does not import DB/outbox processor when only enqueueing jobs

**Linked defect:** **P2-13** (`docs/agent-backlog/NESTJS_STARTER_KIT_REQUIRED_FIXES.md` — section P2-13; implementation plan `docs/agent-plans/P2-13-outbox-scheduler-options-for-cron.md`).

**Investigation (2026-06-22, current branch):** verification scenario is **not stale**. The underlying composition defect from P2-13 is still present in production code. V-19 cannot return `approved` until P2-13 is implemented and independently verified.

## Current behavior

1. **`CronModule`** (`apps/cron/src/cron.module.ts`) imports the full outbox processor / DB stack:

   - `DrizzleModule.forRootAsync(...)` — opens a PostgreSQL pool at bootstrap.
   - `OutboxProcessorModule.forRootAsync({ imports: [InfrastructureConfigModule, drizzleModule, bullMqQueuesModule], ... })` — registers `TOKENS.OutboxProcessorOptions` **and** instantiates `DrizzleOutboxProcessor`, `AuditModule`, and `EventsModule`.

2. **`OutboxSchedule`** (`apps/cron/src/schedules/outbox.schedule.ts`) is a thin scheduler. It injects only:

   | Token                           | Used?                                           |
   | ------------------------------- | ----------------------------------------------- |
   | `TOKENS.QueueGateway`           | Yes — `queues.add(QUEUES.OUTBOX, ...)`          |
   | `TOKENS.DistributedLock`        | Yes — `lock.runWithLock('cron:outbox', ...)`    |
   | `TOKENS.OutboxProcessorOptions` | Yes — only `pollIntervalMs` and `cronLockTtlMs` |
   | `TOKENS.OutboxProcessor`        | **No**                                          |
   | `DRIZZLE_DB` / outbox table     | **No**                                          |

3. **`WorkerModule`** (`apps/worker/src/worker.module.ts`) correctly imports `OutboxProcessorModule.forRootAsync(...)` plus `outboxProcessorProvider` because it actually consumes `TOKENS.OutboxProcessor` and performs DB reads/writes.

4. **`OutboxProcessorModule`** (`libs/infrastructure/src/outbox/outbox-processor.module.ts`) uses `ConfigurableModuleBuilder<OutboxProcessorOptions>` with `optionsInjectionToken: TOKENS.OutboxProcessorOptions`. Its `buildFeatureImports()` adds `AuditModule`, `EventsModule`, and `LoggerModule` on top of caller-supplied `connectionImports` (Drizzle, BullMQ queues).

5. **`OutboxProcessorOptionsModule` does not exist yet** — Cron still depends on the processor module solely to obtain scheduler options.

6. **No Cron composition DI regression spec exists** (`apps/cron/src/cron.module.spec.ts` is absent). `apps/cron/src/schedules/outbox.schedule.spec.ts` tests schedule behavior in isolation with manual mocks; it does not validate module import graph.

7. **`README.md` §3.3** describes Cron purpose (scheduled jobs, BullMQ enqueue, distributed lock) but does not document the options/processor module split. Line ~1197 still states Cron configures outbox policy through `OutboxProcessorModule.forRootAsync()`.

## Confirmed root cause

Same as P2-13: Cron’s composition root imports **`OutboxProcessorModule`** solely to obtain **`TOKENS.OutboxProcessorOptions`**. That couples the Cron entrypoint to:

1. PostgreSQL (`DrizzleModule` + `DrizzleOutboxProcessor`).
2. Outbox event-routing infrastructure (`EventsModule`, `AuditModule`).
3. Unnecessary BullMQ queue visibility passed into processor `imports` for transitive `EventsModule` handlers.

This is an architectural coupling issue (multi-entrypoint minimality / portability), not a proven runtime bug. Cron’s actual responsibility is: acquire a distributed lock, enqueue an outbox processing job on a timer.

## Dependency/runtime flow

### Current (V-19 would fail today)

```text
CronModule
  ├─ DrizzleModule.forRootAsync()           → PG pool + DRIZZLE_DB
  ├─ RedisModule + LocksModule              → TOKENS.DistributedLock
  ├─ InfrastructureBullMqModule           → TOKENS.QueueGateway (OUTBOX queue)
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

### Expected after P2-13 (V-19 pass condition)

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

Independently confirm — with static import-graph evidence, targeted DI tests, and optional runtime bootstrap — that Cron composition is a thin scheduler (enqueue + lock only) and does not import `DrizzleModule` or `OutboxProcessorModule` after P2-13 is implemented.

## Scope

| Activity                                      | Responsibility        | Notes                                                                       |
| --------------------------------------------- | --------------------- | --------------------------------------------------------------------------- |
| Extract options module; slim Cron composition | **P2-13 implementer** | See `docs/agent-plans/P2-13-outbox-scheduler-options-for-cron.md`           |
| Add options + Cron DI regression specs        | **P2-13 implementer** | `outbox-processor-options.module.spec.ts`, `cron.module.spec.ts`            |
| Update README Cron/outbox docs                | **P2-13 implementer** | §3.3 + runtime configuration paragraph                                      |
| Independent verification                      | **V-19 verifier**     | Inspect diff, run commands, write `docs/agent-reports/V-19-verification.md` |

## Out of scope

- Implementing the P2-13 fix (separate approved plan).
- Splitting `envSchema` / making `DATABASE_URL` optional for Cron (`InfrastructureConfigModule` may still validate full env after P2-13).
- Changes to `OutboxSchedule` behavior, queue payload, or lock key semantics.
- Worker processor logic, BullMQ concurrency, or outbox retry policy.
- API or Migrations entrypoint changes.
- Marking P2-13 or V-19 resolved in backlog INDEX without implementation + verification evidence.

## Files to create

| File                                      | Symbol / responsibility                                                        |
| ----------------------------------------- | ------------------------------------------------------------------------------ |
| `docs/agent-reports/V-19-verification.md` | Independent verification report (verifier output; not created during planning) |

**Prerequisites from P2-13 (implementer creates):**

| File                                                                     | Symbol / responsibility                                                            |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| `libs/infrastructure/src/outbox/outbox-processor-options.module.ts`      | `OutboxProcessorOptionsModule` — registers only `TOKENS.OutboxProcessorOptions`    |
| `libs/infrastructure/src/outbox/outbox-processor-options.module.spec.ts` | Isolated Nest test: options token resolves without Drizzle                         |
| `apps/cron/src/cron.module.spec.ts`                                      | Cron DI compile test: no `DrizzleModule` / `OutboxProcessorModule` in import graph |

## Files to modify

None during verification planning. Verifier inspects changes from P2-13:

| File                                                        | What to verify                                                                                                                                                 |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/cron/src/cron.module.ts`                              | No `DrizzleModule`, `drizzleModule`, `mapAppConfigToDrizzleOptions`, or `OutboxProcessorModule` imports; uses `OutboxProcessorOptionsModule.forRootAsync(...)` |
| `libs/infrastructure/src/outbox/outbox-processor.module.ts` | Composes `OutboxProcessorOptionsModule` internally; Worker public API unchanged                                                                                |
| `apps/worker/src/worker.module.ts`                          | **Unchanged** — still imports `OutboxProcessorModule.forRootAsync`                                                                                             |
| `README.md`                                                 | Cron documented as thin scheduler; options vs processor module split                                                                                           |

## Files to delete

None.

## Contract and DI changes

- **Verifier expectation:** no public HTTP API or contract field changes.
- **`OutboxProcessorOptions` interface** (`libs/contracts/src/outbox/outbox-processor.options.ts`) — unchanged.
- **`TOKENS.OutboxProcessorOptions`** — unchanged; Cron obtains it via `OutboxProcessorOptionsModule` instead of `OutboxProcessorModule`.
- **`TOKENS.OutboxProcessor`** — remains only in `OutboxProcessorModule` (Worker).
- **Breaking change:** none expected for external consumers.

## Implementation steps

V-19 is a verification issue. Steps below are for the **independent verifier** after P2-13 implementation is complete.

### Prerequisite gate

1. Confirm **P2-13 plan** frontmatter is `status: approved`.
2. Confirm P2-13 implementation exists (inspect `git diff`; read `docs/agent-reports/P2-13-implementation.md` if present, but do not trust it without code inspection).
3. If P2-13 is not implemented, stop and return verdict **`changes-required`** with note: underlying defect still open.

### Step 1 — Scope and diff review

1. Run `git status` and `git diff`.
2. Confirm only P2-13-scoped files changed (primarily new options module, refactored processor module, slimmed `cron.module.ts`, new specs, README).
3. In `apps/cron/src/cron.module.ts`, confirm:
   - `DrizzleModule` / `drizzleModule` / `mapAppConfigToDrizzleOptions` are **absent**;
   - `OutboxProcessorModule` import is **absent**;
   - `OutboxProcessorOptionsModule.forRootAsync({ imports: [InfrastructureConfigModule], inject: [AppConfigService], useFactory: config => config.outbox() })` is present;
   - `ScheduleModule`, `InfrastructureConfigModule`, `LoggerModule`, `redisModule`, BullMQ connection + `QUEUES.OUTBOX`, `LocksModule` remain.

### Step 2 — Static import-graph trace

Trace and document:

```text
CronModule
  ├─ OutboxProcessorOptionsModule.forRootAsync()
  │    └─ TOKENS.OutboxProcessorOptions only
  ├─ RedisModule + LocksModule → TOKENS.DistributedLock
  └─ InfrastructureBullMqModule → TOKENS.QueueGateway (OUTBOX)

OutboxSchedule
  → injects QueueGateway, DistributedLock, OutboxProcessorOptions
  → does NOT inject OutboxProcessor or DRIZZLE_DB

WorkerModule
  └─ OutboxProcessorModule.forRootAsync()  ← sole processor entrypoint
       └─ composes OutboxProcessorOptionsModule internally
```

Confirm `apps/cron/src/cron.module.ts` has **no** static imports from:

- `@infrastructure/database/drizzle/drizzle.module`
- `@infrastructure/outbox/outbox-processor.module`

Confirm `OutboxSchedule` (`apps/cron/src/schedules/outbox.schedule.ts`) is **unchanged** in injection surface (still `TOKENS.OutboxProcessorOptions`, not processor token).

### Step 3 — Targeted unit verification (mandatory)

Run:

```bash
npm ci
npm run test:unit -- libs/infrastructure/src/outbox/outbox-processor-options.module.spec.ts
npm run test:unit -- apps/cron/src/cron.module.spec.ts
npm run test:unit -- apps/cron/src/schedules/outbox.schedule.spec.ts
```

**Expected:**

- Options module spec: `TOKENS.OutboxProcessorOptions` resolves via `forRoot(OUTBOX_PROCESSOR_DEFAULT_OPTIONS)` without Drizzle.
- Cron module spec: `Test.createTestingModule({ imports: [CronModule] })` compiles; `OutboxSchedule` injectable; `DRIZZLE_DB` provider **not** in module graph; `TOKENS.OutboxProcessor` **not** registered at Cron root.
- Existing schedule spec: still passes (no behavior regression).

**Negative control (optional, pre-fix baseline only):** on unfixed branch, `cron.module.spec.ts` should fail or be absent — confirms the test catches the defect.

### Step 4 — Build and lint

```bash
npm run build:cron
npm run build:worker
npm run lint
```

Record exit codes. Build-only pass on unfixed branch is **insufficient** for approval (defect is composition coupling, not compile-time).

### Step 5 — Optional runtime bootstrap

When Redis and BullMQ are available locally (PostgreSQL **not** required after fix):

```bash
npm run start:cron
```

**Expected:**

- Cron Nest application context starts without DI errors.
- Startup logs show **no** PostgreSQL connection attempt (no `PG_POOL` / Drizzle pool messages).
- Redis availability check in `apps/cron/src/main.ts` still runs (`assertRedisAvailable`).

If infrastructure is unavailable, record under **Unverified areas** — do not treat as project defect.

### Step 6 — Documentation alignment

Verify `README.md`:

- §3.3 Cron — states Cron is a thin scheduler (enqueue + lock; no DB/outbox processor).
- Runtime configuration paragraph (~L1197) — Cron uses `OutboxProcessorOptionsModule`; Worker uses `OutboxProcessorModule`.

### Step 7 — Write verification report

Create `docs/agent-reports/V-19-verification.md` using structure from `.cursor/skills/change-verification/SKILL.md`:

```markdown
# V-19 — Independent verification

## Verdict

approved | changes-required | not-confirmed

## Scope checked

## Root-cause assessment

## Acceptance criteria matrix

## Dependency and DI verification

## Commands executed

## Findings

## Documentation alignment

## Remaining risks

## Unverified areas
```

Include per-command records:

```text
Command:
Result:
Conclusion:
```

## Migration and rollout concerns

None for verification. P2-13 fix itself requires no schema migration. After fix, Cron deployments stop opening PG connections; Worker continues processing outbox rows independently.

**Known post-fix limitation (document, do not fail V-19):** Cron may still require `DATABASE_URL` in env because `InfrastructureConfigModule` validates full schema — runtime PG connection is removed; env validation is not (unless a separate env-splitting task is approved).

## Targeted verification

| Command                                                                                       | Expected result                           |
| --------------------------------------------------------------------------------------------- | ----------------------------------------- |
| `npm ci`                                                                                      | Clean install succeeds                    |
| `npm run test:unit -- libs/infrastructure/src/outbox/outbox-processor-options.module.spec.ts` | Passes; options module DI evidence        |
| `npm run test:unit -- apps/cron/src/cron.module.spec.ts`                                      | Passes; primary V-19 composition evidence |
| `npm run test:unit -- apps/cron/src/schedules/outbox.schedule.spec.ts`                        | Passes; no schedule behavior regression   |
| Code review of `apps/cron/src/cron.module.ts`                                                 | No Drizzle/OutboxProcessorModule imports  |

## Full verification

| Command                | Expected result                                                            |
| ---------------------- | -------------------------------------------------------------------------- |
| `npm run build:cron`   | Cron compiles without Drizzle imports                                      |
| `npm run build:worker` | Processor module refactor did not break Worker                             |
| `npm run build`        | Full multi-entrypoint build                                                |
| `npm run lint`         | No new lint errors from P2-13 changes                                      |
| `npm run test:unit`    | Full suite passes (or document pre-existing unrelated failures separately) |
| `npm run start:cron`   | Optional — bootstrap when Redis available; no PG connection in logs        |

## Acceptance criteria

| ID    | Criterion                                                  | Verification method                         | Pass condition                                                              |
| ----- | ---------------------------------------------------------- | ------------------------------------------- | --------------------------------------------------------------------------- |
| AC-1  | P2-13 fix implemented and scoped correctly                 | Diff + scope review                         | Only planned files/symbols changed                                          |
| AC-2  | `CronModule` has no `DrizzleModule` / `drizzleModule`      | Static import review + cron.module.spec     | Absent from `cron.module.ts` and DI graph                                   |
| AC-3  | `CronModule` has no `OutboxProcessorModule`                | Static import review + cron.module.spec     | Absent from `cron.module.ts`; `TOKENS.OutboxProcessor` not at Cron root     |
| AC-4  | `OutboxSchedule` receives typed `OutboxProcessorOptions`   | cron.module.spec + code review              | `TOKENS.OutboxProcessorOptions` resolves via `OutboxProcessorOptionsModule` |
| AC-5  | Worker remains sole outbox processor entrypoint            | Code review of `worker.module.ts`           | `OutboxProcessorModule.forRootAsync` + `outboxProcessorProvider` unchanged  |
| AC-6  | `OutboxProcessorModule` composes options module internally | Code review of `outbox-processor.module.ts` | `OutboxProcessorOptionsModule.forRoot*` in processor imports                |
| AC-7  | `npm run build:cron` passes                                | Execute and record                          | Exit 0                                                                      |
| AC-8  | `npm run build:worker` passes                              | Execute and record                          | Exit 0                                                                      |
| AC-9  | Cron + options DI specs pass                               | Execute targeted unit tests                 | Exit 0                                                                      |
| AC-10 | README documents thin Cron composition                     | Doc review                                  | §3.3 + runtime config paragraph updated                                     |
| AC-11 | Optional Cron bootstrap without PG                         | `npm run start:cron` when Redis available   | No PG pool connection in startup logs                                       |

**Verdict rules:**

- **`approved`** — AC-1 through AC-10 pass; AC-11 passed or explicitly unverified with infra note.
- **`changes-required`** — any of AC-1–AC-9 fail, or Cron still imports Drizzle/OutboxProcessorModule.
- **`not-confirmed`** — targeted specs or build could not run (missing deps, environment failure unrelated to code).

## Risks

1. **False approval from build-only checks** — `npm run build:cron` passes on unfixed branch while still importing Drizzle; targeted `cron.module.spec.ts` is mandatory.
2. **Duplicate `TOKENS.OutboxProcessorOptions`** — if Cron imports both options and processor modules, spec or Nest bootstrap may fail with duplicate provider; verifier must confirm Cron uses **only** `OutboxProcessorOptionsModule`.
3. **Worker regression from processor module refactor** — passing Cron checks does not prove Worker DI; AC-5 and `build:worker` are required.
4. **Env validation vs runtime connection** — verifier may observe `DATABASE_URL` still required in `.env` despite no PG connection; document under remaining risks, not as V-19 failure.
5. **P2-13 not approved/implemented** — V-19 verification blocked until implementation completes.

## Rollback strategy

Verification is read-only. If verdict is `changes-required`, revert to P2-13 implementer — no verifier code changes.

## Open questions requiring human decision

1. **Verification ordering** — must V-19 wait for a separate P2-13 verification report (`docs/agent-reports/P2-13-verification.md`), or is V-19 the canonical composition verification for this defect?
2. **Runtime bootstrap requirement** — is targeted DI spec sufficient for `approved`, or is `npm run start:cron` mandatory when Redis is available?
3. **`DATABASE_URL` env validation** — should V-19 fail if Cron still validates `DATABASE_URL` via `InfrastructureConfigModule`, or is removing runtime PG connection sufficient?
4. **P2-13 plan approval** — P2-13 plan is currently `status: proposed`; confirm human approval before implementation begins.
5. **Module naming** — accept `OutboxProcessorOptionsModule` (P2-13 recommendation) vs backlog alternative `OutboxSchedulerConfigModule` for documentation consistency?
