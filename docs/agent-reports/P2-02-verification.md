# P2-02 — Independent verification

## Verdict

**changes-required**

P2-02 aligns `QueueJobRegistry`, `QUEUES`, and BullMQ registrations per approved Option A, passes build and targeted tests, and runtime V-07e–f smoke tests succeed **with the working-tree lazy queue resolution fix**. Two items block **`approved`**: (1) that lazy-resolution change in `libs/infrastructure/src/bullmq/queue.gateway.ts` is **unstaged** while the staged index still uses eager constructor resolution (known to fail Cron enqueue at tick time); (2) acceptance criterion 9 — `npm run lint` — still fails on pre-existing outbox files (P2-11).

## Scope checked

**Source issue:** `docs/agent-backlog/NESTJS_STARTER_KIT_REQUIRED_FIXES.md` § P2-02 — misalignment among `QueueJobRegistry`, `QUEUES`, and BullMQ registrations.

**Approved plan:** `docs/agent-plans/P2-02-queue-registry-bullmq-alignment.md` — Option A (trim placeholders), `status: approved`.

**Implementation report reviewed:** `docs/agent-reports/P2-02-implementation.md` (claims cross-checked against code, diff, and command output).

**Diff note:** Git index stages P2-02 production files together with unrelated P2-01 migration work and agent artifacts. P2-02 verification below covers queue-registry files from the plan plus the verification-driven lazy-resolution follow-up in the working tree.

**P2-02 production files verified:**

| File                                                                | Role                                                                        |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `libs/contracts/src/queues/queue-names.ts`                          | Trimmed `QUEUES` to `OUTBOX`, `EMAIL`                                       |
| `libs/infrastructure/src/bullmq/queue.gateway.ts`                   | Typed `add` signature; **lazy `getQueue()` cache (working tree, unstaged)** |
| `libs/infrastructure/src/infrastructure.module.ts`                  | Facade registers explicit registry queues                                   |
| `libs/contracts/src/queues/queue-registry.parity.spec.ts`           | Parity guard (new)                                                          |
| `libs/infrastructure/src/bullmq/queue.gateway.spec.ts`              | Gateway unit tests (new)                                                    |
| `README.md`, `EXAMPLES.md`, `docs/infrastructure-modules/README.md` | Extension workflow docs                                                     |

**Unchanged (as planned):** `libs/contracts/src/queues/queue-gateway.ts`, `apps/api/src/api.module.ts`, `apps/worker/src/worker.module.ts`, `apps/cron/src/cron.module.ts`.

## Root-cause assessment

**Original root cause (confirmed):** Nine public `QUEUES` constants vs two `QueueJobRegistry` entries; deprecated `InfrastructureModule.forRoot()` registered all nine via `Object.values(QUEUES)`; `BullQueueGateway.add` used untyped `string` parameters, bypassing compile-time checks.

**Fix assessment:** The implementation addresses the root cause directly:

1. `QUEUES` trimmed to the two registry-backed queues (Option A).
2. `BullQueueGateway.add` matches `IQueueGateway` generics (`QueueName`, `JobName`, `JobPayload`).
3. Deprecated facade registers `[QUEUES.OUTBOX, QUEUES.EMAIL]` with an explanatory comment.
4. Parity and gateway specs guard regression.
5. Documentation describes the full registry → `QUEUES` → `registerQueues` → processor → typed enqueue workflow.

**Verification-driven follow-up (lazy resolution):** Runtime smoke exposed that eager `ModuleRef.get(getQueueToken(name))` in the gateway constructor can run before BullMQ `Queue` providers are resolvable, causing `Unknown queue: outbox` on the first Cron tick. The working-tree fix resolves and caches queues lazily on first `getQueue()` call, gated by `BULLMQ_REGISTERED_QUEUES`. This is a legitimate fix for the enqueue path exercised by V-07e; it must be included in the delivered diff.

## Acceptance criteria matrix

| #   | Criterion                                                                                       | Status                  | Evidence                                                                                                  |
| --- | ----------------------------------------------------------------------------------------------- | ----------------------- | --------------------------------------------------------------------------------------------------------- |
| 1   | Every `QUEUES` key maps to exactly one `QueueJobRegistry` queue key                             | **pass**                | `QUEUES` = `{ OUTBOX: 'outbox', EMAIL: 'email' }`; parity spec passes                                     |
| 2   | Every `QueueJobRegistry` queue has a corresponding `QUEUES` constant                            | **pass**                | Parity spec; bidirectional set equality asserted                                                          |
| 3   | No in-repo runtime code registers BullMQ queues absent from `QueueJobRegistry`                  | **pass**                | All `registerQueues` call sites use `OUTBOX` / `EMAIL` only; no `Object.values(QUEUES)` in infrastructure |
| 4   | `BullQueueGateway.add` matches `IQueueGateway` generic contract                                 | **pass**                | Signatures aligned; `npm run build` succeeds; gateway spec passes                                         |
| 5   | Active entrypoint registrations: API=`OUTBOX`, Worker=`OUTBOX`+`EMAIL`, Cron=`OUTBOX`           | **pass**                | Verified in `api.module.ts`, `worker.module.ts`, `cron.module.ts`                                         |
| 6   | Deprecated `InfrastructureModule.forRoot()` registers only registry-backed queues               | **pass**                | Explicit `[QUEUES.OUTBOX, QUEUES.EMAIL]`                                                                  |
| 7   | README and EXAMPLES document registry → `QUEUES` → `registerQueues` → processor → typed enqueue | **pass**                | README §5.5, §14; EXAMPLES §10; infrastructure-modules note                                               |
| 8   | V-07 scenarios V-07a–V-07g pass with recorded evidence                                          | **pass** (working tree) | See V-07 table; V-07e requires lazy-resolution fix                                                        |
| 9   | `npm run build` and `npm run lint` pass                                                         | **partial**             | Build: pass; Lint: **fail** (4 pre-existing errors in outbox files, P2-11)                                |

### V-07 scenario evidence

| ID    | Scenario                                                              | Expected                | Actual                                                                                                                   | Status                                |
| ----- | --------------------------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------- |
| V-07a | Compile: `add(QUEUES.OUTBOX, 'process-pending-outbox-events', {})`    | Passes                  | `outbox.schedule.ts`; full build passes                                                                                  | **pass**                              |
| V-07b | Compile: `add(QUEUES.EMAIL, 'send-welcome-email', validEmailPayload)` | Passes                  | `user-registered.handler.ts`; build passes                                                                               | **pass**                              |
| V-07c | Compile: wrong job name on `QUEUES.EMAIL`                             | Type error              | Inferred from `JobName<'email'>` union                                                                                   | **pass** (inferred)                   |
| V-07d | Compile: `add('notifications', ...)`                                  | Type error (Option A)   | `QueueName` is `'email' \| 'outbox'` only                                                                                | **pass** (inferred)                   |
| V-07e | Worker/Cron runtime enqueue without `Unknown queue`                   | No error                | Cron ran 125s+ with `OUTBOX_POLL_INTERVAL_MS=5000`; no `Unknown queue` or `Outbox cron tick failed`; Worker bootstrap OK | **pass** (working tree with lazy fix) |
| V-07f | API health `@InjectQueue(OUTBOX)` resolves                            | Health module starts    | API on `APP_PORT=3001`: `HealthModule dependencies initialized`, `Nest application successfully started`                 | **pass**                              |
| V-07g | Deprecated facade registers same set as `Object.values(QUEUES)`       | No orphan registrations | Facade two-queue list; parity spec 2↔2                                                                                   | **pass**                              |

## Dependency and DI verification

```text
Composition roots (unchanged, selective registration)
  apps/api/api.module.ts       -> registerQueues([QUEUES.OUTBOX])
  apps/worker/worker.module.ts -> registerQueues([QUEUES.OUTBOX, QUEUES.EMAIL])
  apps/cron/cron.module.ts     -> registerQueues([QUEUES.OUTBOX])

Deprecated facade (changed)
  InfrastructureModule.forRoot()
    -> InfrastructureBullMqModule.registerQueues([QUEUES.OUTBOX, QUEUES.EMAIL])

Gateway DI
  BullQueueGateway
    -> lazy ModuleRef.get(getQueueToken) on first enqueue
    -> registeredQueues gate from BULLMQ_REGISTERED_QUEUES

Producers (typed enqueue)
  OutboxSchedule.tick()           -> QUEUES.OUTBOX / 'process-pending-outbox-events'
  UserRegisteredHandler.handle()  -> QUEUES.EMAIL / 'send-welcome-email'

Consumers
  OutboxProcessor  -> @Processor(QUEUES.OUTBOX)   [Worker]
  EmailProcessor   -> @Processor(QUEUES.EMAIL)    [Worker]
  HealthService    -> @InjectQueue(QUEUES.OUTBOX) [API]
```

## Commands executed

| Command                                                                                      | Result                                                              | Conclusion                                                                                   |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `rg "QUEUES\.(DEFAULT\|EVENTS\|NOTIFICATIONS\|INTEGRATIONS\|ANALYTICS\|FILES\|MAINTENANCE)"` | Exit 0, no matches                                                  | Removed keys not referenced                                                                  |
| `npm run test:unit -- queue-registry.parity`                                                 | Exit 0 — 3 passed                                                   | Parity guard passes                                                                          |
| `npm run test:unit -- queue.gateway.spec`                                                    | Exit 0 — 3 passed                                                   | Typed delegation and unknown-queue error verified                                            |
| `npm run build`                                                                              | Exit 0                                                              | All four entrypoints compile                                                                 |
| `npm run lint`                                                                               | Exit 1 — 4 errors                                                   | Pre-existing in `outbox-processor.defaults.ts`, `outbox-processor.options.schema.ts` (P2-11) |
| `npm run db:migrate` (localhost PG)                                                          | Exit 0                                                              | Schema ready for smoke                                                                       |
| `npx nest start api` (`APP_PORT=3001`, localhost PG/Redis)                                   | `Nest application successfully started`; `HealthModule` initialized | **V-07f pass**                                                                               |
| `npx nest start worker` (localhost PG/Redis)                                                 | `Worker application started successfully`                           | **V-07e partial** — startup OK                                                               |
| `npx nest start cron` (`OUTBOX_POLL_INTERVAL_MS=5000`, 125s+)                                | Bootstrap OK; no `Unknown queue` or tick failure                    | **V-07e pass** (with lazy fix in working tree)                                               |
| `git diff libs/infrastructure/src/bullmq/queue.gateway.ts`                                   | Unstaged lazy-resolution hunk                                       | Staged index still has eager constructor map                                                 |

## Findings

### Confirmed (implementation correct on working tree)

1. **Option A delivered:** Seven placeholder `QUEUES` keys removed.
2. **Contract alignment:** `BullQueueGateway.add` no longer weakens types to `string`.
3. **Facade fixed:** Deprecated module no longer registers orphan queues.
4. **Tests added:** Parity and gateway specs pass.
5. **Docs updated:** Extension guides include registry-first workflow.
6. **Runtime enqueue path works** with lazy queue resolution (V-07e–f).

### Required before approval

1. **Stage lazy queue resolution in `queue.gateway.ts`:** The verification-driven fix is present in the working tree but **not staged**. The staged version retains eager constructor resolution, which the implementation report documents as failing Cron ticks. Include this hunk in the P2-02 deliverable.
2. **Lint gate (AC9):** Four `@typescript-eslint/no-unused-vars` errors in outbox processor files unrelated to P2-02. Tracked as P2-11; blocks AC9 until resolved or explicitly decoupled by human acceptance policy.

### Non-blocking notes

1. **Staged index mixes issues:** P2-02 production changes staged alongside P2-01 and bulk agent plans; recommend separate commits per issue.
2. **Parity spec manual mirror:** `REGISTRY_QUEUE_NAMES` must be updated when registry grows.
3. **Cron ticks are silent on success:** V-07e confirmed by absence of error logs over multiple poll intervals.

## Documentation alignment

| Document                                | Alignment                                                              |
| --------------------------------------- | ---------------------------------------------------------------------- |
| `README.md` §5.5                        | 2-queue `QUEUES`, typed `IQueueGateway`, `'send-welcome-email'`        |
| `README.md` §14                         | Ordered extension checklist including registry and `registerQueues`    |
| `EXAMPLES.md` §10                       | Full workflow with `QueueJobRegistry`, `QUEUES.REPORTS`, typed enqueue |
| `docs/infrastructure-modules/README.md` | Parity note + entrypoint queue table                                   |

Documentation matches implemented behavior for active queues and extension workflow.

## Remaining risks

| Risk                                              | Severity | Notes                                           |
| ------------------------------------------------- | -------- | ----------------------------------------------- |
| Unstaged lazy fix omitted from merge              | **High** | Staged gateway would regress V-07e at Cron tick |
| Breaking change for external `QUEUES.*` consumers | Medium   | Intentional under Option A                      |
| Orphan Redis queue metadata from prior facade     | Low      | Inert keys may remain                           |
| Pre-existing lint failures block green gate       | Medium   | P2-11                                           |

## Unverified areas

1. **Full unit suite** — Not run in this verification session.
2. **Negative compile scenarios V-07c–d** — Inferred from types; no `@ts-expect-error` fixtures.
3. **Downstream starter-kit fork smoke test** — External consumer impact of removed `QUEUES` keys not validated.
4. **V-07e on staged-only diff (without lazy fix)** — Not re-run; prior implementation report documents failure before lazy fix.

---

**Independent verifier conclusion:** P2-02 resolves the registry/constants/runtime divergence and passes runtime V-07e–f when the lazy queue resolution fix is included. Verdict is **`changes-required`**: stage the unstaged `queue.gateway.ts` lazy-resolution hunk before merge, and resolve or explicitly defer AC9 lint failures (P2-11) per project acceptance policy.
