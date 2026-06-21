---
issue_id: P2-02
status: approved
owner: human-approval-required
---

# P2-02 — Align `QueueJobRegistry`, `QUEUES`, and BullMQ registrations

## Source issue

`docs/agent-backlog/NESTJS_STARTER_KIT_REQUIRED_FIXES.md` — section **P2-02. Узгодити `QueueJobRegistry`, `QUEUES` та BullMQ registrations**.

Related verification item: **V-07** — queue registry compile-time/runtime parity (`docs/agent-backlog/INDEX.md`).

**Investigation (2026-06-21, current branch):** defect confirmed. Issue is **not stale**.

## Current behavior

Three separate sources describe different queue sets:

| Source                         | Location                                           | Queue count                   | Active queues                             |
| ------------------------------ | -------------------------------------------------- | ----------------------------- | ----------------------------------------- |
| `QUEUES` constant              | `libs/contracts/src/queues/queue-names.ts`         | 9                             | `outbox`, `email` (7 placeholders unused) |
| `QueueJobRegistry`             | `libs/contracts/src/queues/queue-gateway.ts`       | 2                             | `outbox`, `email`                         |
| BullMQ entrypoint registration | `apps/api`, `apps/worker`, `apps/cron` modules     | 1–2 per entrypoint            | `outbox`, `email` (selective, post–P1-04) |
| Deprecated BullMQ facade       | `libs/infrastructure/src/infrastructure.module.ts` | 9 via `Object.values(QUEUES)` | same 7 orphan registrations               |

### `QueueJobRegistry` (compile-time contract)

File: `libs/contracts/src/queues/queue-gateway.ts`

| Queue    | Job name                        | Payload type            |
| -------- | ------------------------------- | ----------------------- |
| `email`  | `send-welcome-email`            | `EmailJobPayload`       |
| `outbox` | `process-pending-outbox-events` | `Record<string, never>` |

Derived types: `QueueName = keyof QueueJobRegistry` → `'email' | 'outbox'`.

### `QUEUES` (public constants)

File: `libs/contracts/src/queues/queue-names.ts`

| Key             | Value             | Used in runtime code? |
| --------------- | ----------------- | --------------------- |
| `DEFAULT`       | `'default'`       | No                    |
| `EVENTS`        | `'events'`        | No                    |
| `OUTBOX`        | `'outbox'`        | Yes                   |
| `EMAIL`         | `'email'`         | Yes                   |
| `NOTIFICATIONS` | `'notifications'` | No                    |
| `INTEGRATIONS`  | `'integrations'`  | No                    |
| `ANALYTICS`     | `'analytics'`     | No                    |
| `FILES`         | `'files'`         | No                    |
| `MAINTENANCE`   | `'maintenance'`   | No                    |

Re-export: `libs/infrastructure/src/bullmq/queues.ts`.

### BullMQ registrations (runtime)

| Entrypoint | File                               | `registerQueues(...)`           |
| ---------- | ---------------------------------- | ------------------------------- |
| API        | `apps/api/src/api.module.ts`       | `[QUEUES.OUTBOX]`               |
| Worker     | `apps/worker/src/worker.module.ts` | `[QUEUES.OUTBOX, QUEUES.EMAIL]` |
| Cron       | `apps/cron/src/cron.module.ts`     | `[QUEUES.OUTBOX]`               |

Active producers/consumers:

| Symbol                  | File                                                                 | Queue / job                                |
| ----------------------- | -------------------------------------------------------------------- | ------------------------------------------ |
| `OutboxSchedule.tick()` | `apps/cron/src/schedules/outbox.schedule.ts`                         | `OUTBOX` / `process-pending-outbox-events` |
| `UserRegisteredHandler` | `libs/infrastructure/src/events/handlers/user-registered.handler.ts` | `EMAIL` / `send-welcome-email`             |
| `OutboxProcessor`       | `apps/worker/src/processors/outbox.processor.ts`                     | `QUEUES.OUTBOX`                            |
| `EmailProcessor`        | `apps/worker/src/processors/email.processor.ts`                      | `QUEUES.EMAIL`                             |
| `HealthService`         | `libs/infrastructure/src/health/health.service.ts`                   | `@InjectQueue(QUEUES.OUTBOX)`              |

### `BullQueueGateway` contract drift

File: `libs/infrastructure/src/bullmq/queue.gateway.ts`

- `IQueueGateway.add` (contract): generic over `QueueName`, `JobName<TQueue>`, `JobPayload<TQueue, TJob>`.
- `BullQueueGateway.add` (implementation): loosened to `queueName: string`, `jobName: string`, `payload: T`.
- `BullQueueGateway.addBulk`: correctly generic over `QueueName`.

### Documentation drift

| Document                                | Problem                                                                                         |
| --------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `README.md` §5.5 (~635–664)             | Shows 7 queue names (omits `DEFAULT`, `EVENTS`); shows untyped `add(queueName: string, ...)`    |
| `README.md` (~889)                      | Uses job name `'send-welcome'` instead of registry `'send-welcome-email'`                       |
| `README.md` §14 (~1920–1948)            | Extension guide skips `QueueJobRegistry` and `registerQueues`; uses nonexistent `QUEUES.MY_JOB` |
| `EXAMPLES.md` §10 (~507–560)            | Same placeholder list, `QUEUES.MY_JOB`, no registry step                                        |
| `docs/infrastructure-modules/README.md` | Entrypoint queue table is correct; no registry extension guidance                               |

## Confirmed root cause

The starter kit exposes nine public queue constants while only two queues have typed job contracts and runtime consumers. `QueueName` is derived from `QueueJobRegistry`, so seven `QUEUES` values cannot be passed to `IQueueGateway.add` without compile errors. The deprecated `InfrastructureModule` facade still registers all nine queues in BullMQ, reintroducing runtime/registry divergence. `BullQueueGateway.add` bypasses the generic contract, hiding mismatches at the implementation layer. Extension docs describe an incomplete workflow that leads developers to add queue names without registry entries.

## Dependency/runtime flow

```text
Cron OutboxSchedule
  -> IQueueGateway.add(QUEUES.OUTBOX, 'process-pending-outbox-events', ...)
       -> BullQueueGateway.add (must resolve registered OUTBOX queue)
            -> BullModule Queue(OUTBOX)

Worker OutboxProcessor / event handlers
  -> Outbox side effects -> UserRegisteredHandler
       -> IQueueGateway.add(QUEUES.EMAIL, 'send-welcome-email', EmailJobPayload)
            -> BullQueueGateway.add
                 -> BullModule Queue(EMAIL)  [Worker-only registration]

Compile-time gate:
  QueueJobRegistry -> QueueName / JobName / JobPayload
  QUEUES constants should name only registry-backed queues (or registry must be extended first)

Runtime gate:
  InfrastructureBullMqModule.registerQueues([...]) at composition root
  must include every queue that entrypoint enqueues or consumes
```

## Goal

Establish a single authoritative queue contract where:

1. Every `QUEUES.*` constant corresponds to a `QueueJobRegistry` entry.
2. Every registry queue is registered via `registerQueues` in the entrypoint(s) that enqueue or consume it.
3. `BullQueueGateway` implements `IQueueGateway` without weakening `add` to untyped `string` parameters.
4. Queue extension documentation describes the full workflow (registry → constants → registration → processor → typed enqueue).

## Scope

Human must choose **Option A** or **Option B** before implementation (see Open questions). This plan assumes **Option A (recommended)** unless the approver selects Option B.

### Option A (recommended): trim placeholders to active queues

Remove unused placeholder queues from `QUEUES` until real job contracts and consumers exist. Align deprecated facade and docs with the two active queues.

### Option B (alternative): extend registry for all declared queues

Add `QueueJobRegistry` entries (initially empty job maps or placeholder jobs) for all nine queues and keep `QUEUES` as-is. Register each queue only in composition roots that need it. Higher maintenance cost; only justified if placeholders are intentional public extension slots.

## Out of scope

- Adding real processors or business jobs for placeholder queues (`notifications`, `analytics`, etc.).
- Changing BullMQ connection configuration, retry/backoff defaults, or graceful shutdown (see **V-15**).
- Refactoring Application use cases or Outbox semantics.
- **P1-04** infrastructure portability work (already delivered; this plan consumes its `registerQueues` API).
- Production migration or Redis key cleanup for previously registered orphan queues in existing deployments.

## Files to create

| Path                                                      | Responsibility                                                                                                                            |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `libs/contracts/src/queues/queue-registry.parity.spec.ts` | Compile-time/runtime parity guard: every `QUEUES` value is a `QueueName`; every `QueueName` has a matching `QUEUES` entry (Option A: 2↔2) |
| `libs/infrastructure/src/bullmq/queue.gateway.spec.ts`    | Unit tests for typed `add`/`addBulk` delegation and unknown-queue error from `getQueue()`                                                 |

## Files to modify

| Path                                               | Symbol / responsibility                                                                                                     |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `libs/contracts/src/queues/queue-names.ts`         | `QUEUES` — remove 7 unused placeholders (Option A) or unchanged (Option B)                                                  |
| `libs/contracts/src/queues/queue-gateway.ts`       | `QueueJobRegistry`, `IQueueGateway` — extend entries (Option B only)                                                        |
| `libs/infrastructure/src/bullmq/queue.gateway.ts`  | `BullQueueGateway.add` — match `IQueueGateway` generic signature; import `JobName`, `JobPayload`                            |
| `libs/infrastructure/src/infrastructure.module.ts` | `InfrastructureModule.forRoot()` — replace `Object.values(QUEUES)` with explicit active queue list aligned to registry      |
| `README.md`                                        | §5.5 BullMQ queue list and `IQueueGateway` signature; §14 extension workflow; fix `'send-welcome'` → `'send-welcome-email'` |
| `EXAMPLES.md`                                      | §10 “Додати BullMQ job” — full extension steps including registry and `registerQueues`                                      |
| `docs/infrastructure-modules/README.md`            | Add brief note linking queue registration to `QueueJobRegistry` parity                                                      |

**No changes expected** to entrypoint `registerQueues` calls under Option A (already correct for `OUTBOX` / `EMAIL`):

- `apps/api/src/api.module.ts`
- `apps/worker/src/worker.module.ts`
- `apps/cron/src/cron.module.ts`

## Files to delete

None.

## Contract and DI changes

| Change                                       | Breaking?                                                      | Notes                                                        |
| -------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------ |
| Remove 7 keys from `QUEUES` (Option A)       | Yes for external consumers referencing removed keys            | No in-repo usages found                                      |
| Tighten `BullQueueGateway.add` signature     | No for correct callers; yes for code passing arbitrary strings | Aligns implementation with existing `IQueueGateway` contract |
| `InfrastructureModule` queue set             | Behavior change for deprecated facade consumers                | Document in implementation report                            |
| `TOKENS.QueueGateway` / `IQueueGateway` port | Unchanged                                                      | Token and interface remain stable                            |

## Implementation steps

### Step 0 — Human selects Option A or B

Do not implement until recorded in plan frontmatter or approval comment.

### Step 1 — Align `QUEUES` with `QueueJobRegistry` (Option A)

1. Edit `libs/contracts/src/queues/queue-names.ts`:
   - Keep only `OUTBOX: 'outbox'` and `EMAIL: 'email'`.
   - Remove `DEFAULT`, `EVENTS`, `NOTIFICATIONS`, `INTEGRATIONS`, `ANALYTICS`, `FILES`, `MAINTENANCE`.
2. Verify no remaining references to removed keys (`rg 'QUEUES\\.(DEFAULT|EVENTS|NOTIFICATIONS|...)'`).

**Option B alternative:** For each remaining `QUEUES` key, add a `QueueJobRegistry` queue entry. Prefer module augmentation pattern in a dedicated file (e.g. `libs/contracts/src/queues/queue-registry.extensions.ts`) only if approver wants consumer-extensible registry; otherwise extend inline in `queue-gateway.ts` with documented placeholder job types.

### Step 2 — Fix `BullQueueGateway.add` contract

Edit `libs/infrastructure/src/bullmq/queue.gateway.ts`:

```ts
async add<TQueue extends QueueName, TJob extends JobName<TQueue>>(
  queueName: TQueue,
  jobName: TJob,
  payload: JobPayload<TQueue, TJob>,
  options?: QueueJobOptions,
): Promise<string>
```

- Import `JobName`, `JobPayload` from `@contracts/queues/queue-gateway`.
- Keep internal `getQueue(name: string)` unchanged.
- Ensure `implements IQueueGateway` satisfies TypeScript without structural workaround.

### Step 3 — Align deprecated facade registration

Edit `libs/infrastructure/src/infrastructure.module.ts`:

- Replace `InfrastructureBullMqModule.registerQueues(Object.values(QUEUES), ...)` with explicit list `[QUEUES.OUTBOX, QUEUES.EMAIL]` (Option A) or registry-derived list (Option B).
- Add one-line comment: facade registers only registry-backed queues.

### Step 4 — Add parity and gateway tests

1. `queue-registry.parity.spec.ts`:
   - Assert `Object.values(QUEUES)` equals the set of `QueueName` keys (via type-level test or runtime comparison against known registry keys).
2. `queue.gateway.spec.ts`:
   - Mock `ModuleRef`, `BULLMQ_REGISTERED_QUEUES`, `BULLMQ_MODULE_OPTIONS`.
   - Verify `add(QUEUES.EMAIL, 'send-welcome-email', payload)` delegates to underlying `Queue.add`.
   - Verify unknown queue throws `Unknown queue: ...`.

### Step 5 — Update extension documentation

1. **`README.md` §5.5:** Show actual `QUEUES` (2 entries), typed `IQueueGateway.add` signature from `queue-gateway.ts`, correct welcome-email example.
2. **`README.md` §14:** Ordered checklist:
   1. Add queue + job payload types to `QueueJobRegistry` in `queue-gateway.ts`.
   2. Add constant to `queue-names.ts`.
   3. Call `InfrastructureBullMqModule.registerQueues([...])` in API/Worker/Cron module that enqueues or consumes the queue.
   4. Add `@Processor(QUEUES.YOUR_QUEUE)` in Worker.
   5. Enqueue via typed `IQueueGateway.add(QUEUES.YOUR_QUEUE, 'your-job-name', payload)`.
3. **`EXAMPLES.md` §10:** Replace `QUEUES.MY_JOB` with a concrete example name (e.g. `QUEUES.REPORTS` + matching registry entry) or use a clearly marked pseudo-snippet that includes registry step.
4. Fix `README.md` ~889: `'send-welcome'` → `'send-welcome-email'`.

### Step 6 — Targeted verification, then full verification

Run targeted checks after Steps 1–4, then full build/lint/test per Full verification section.

## Migration and rollout concerns

- **Existing deployments** using deprecated `InfrastructureModule.forRoot()` may have BullMQ metadata for seven unused queues in Redis. Removing registration stops new connections to those queues; existing Redis keys are inert. No automatic cleanup required; document optional manual Redis namespace review.
- **Downstream starter-kit consumers** who imported removed `QUEUES.*` keys will get compile errors — intentional breaking change under Option A; note in implementation report.
- Entrypoint selective registration from P1-04 remains the production pattern; this fix does not revert that.

## Targeted verification

| Command / scenario                                                                            | Expected result                                              |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `rg "QUEUES\\.(DEFAULT\|EVENTS\|NOTIFICATIONS\|INTEGRATIONS\|ANALYTICS\|FILES\|MAINTENANCE)"` | No matches after Option A                                    |
| `npm run test:unit -- queue-registry.parity`                                                  | Parity spec passes                                           |
| `npm run test:unit -- queue.gateway.spec`                                                     | Gateway spec passes                                          |
| TypeScript compile of `user-registered.handler.ts` and `outbox.schedule.ts`                   | `IQueueGateway.add` calls type-check with registry job names |

### V-07 scenarios (define during verification)

| ID    | Scenario                                                                                  | Expected                                |
| ----- | ----------------------------------------------------------------------------------------- | --------------------------------------- |
| V-07a | Compile: `IQueueGateway.add(QUEUES.OUTBOX, 'process-pending-outbox-events', {})`          | Passes                                  |
| V-07b | Compile: `IQueueGateway.add(QUEUES.EMAIL, 'send-welcome-email', validEmailPayload)`       | Passes                                  |
| V-07c | Compile: `IQueueGateway.add(QUEUES.EMAIL, 'wrong-job', payload)`                          | Type error                              |
| V-07d | Compile: `IQueueGateway.add('notifications', 'any', {})`                                  | Type error (Option A)                   |
| V-07e | Runtime: Worker bootstraps with `OUTBOX` + `EMAIL` registered; Cron enqueues outbox job   | No `Unknown queue` error                |
| V-07f | Runtime: API health check `@InjectQueue(OUTBOX)` resolves                                 | Health module starts                    |
| V-07g | Deprecated `InfrastructureModule.forRoot()` registers same set as `Object.values(QUEUES)` | No orphan registrations beyond registry |

## Full verification

| Command                                         | Expected                                         |
| ----------------------------------------------- | ------------------------------------------------ |
| `npm run build`                                 | Success                                          |
| `npm run build:api`                             | Success                                          |
| `npm run build:worker`                          | Success                                          |
| `npm run build:cron`                            | Success                                          |
| `npm run lint`                                  | Success                                          |
| `npm run test:unit`                             | Success (including new specs)                    |
| `npm run start:api` (minimal env, short run)    | Bootstrap without queue resolution errors        |
| `npm run start:worker` (minimal env, short run) | Processors bind to registered queues             |
| `npm run start:cron` (minimal env, short run)   | Outbox schedule enqueues without `Unknown queue` |

Record each command with result and conclusion in the implementation report.

## Acceptance criteria

1. Every key in `QUEUES` maps to exactly one `QueueJobRegistry` queue key (same string value).
2. Every `QueueJobRegistry` queue has a corresponding `QUEUES` constant.
3. No in-repo runtime code registers BullMQ queues absent from `QueueJobRegistry`.
4. `BullQueueGateway` implements `IQueueGateway.add` with the same generic parameters as the contract (no public `string` queue/job names).
5. Active entrypoint registrations remain: API=`OUTBOX`, Worker=`OUTBOX`+`EMAIL`, Cron=`OUTBOX`.
6. Deprecated `InfrastructureModule.forRoot()` registers only registry-backed queues (not seven unused placeholders).
7. README and EXAMPLES extension guides document registry → `QUEUES` → `registerQueues` → processor → typed enqueue workflow.
8. V-07 scenarios V-07a–V-07g pass with recorded evidence.
9. `npm run build` and `npm run lint` pass.

## Risks

| Risk                                                    | Mitigation                                                                                               |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Breaking external consumers of removed `QUEUES` keys    | Document in implementation report; Option B if retention required                                        |
| Orphan Redis queue keys from prior deployments          | Document as non-blocking; optional cleanup guidance                                                      |
| Option B empty registry jobs provide false type safety  | Require at least one typed job per queue or explicit `never` job map with documented enqueue prohibition |
| Tightening `BullQueueGateway.add` reveals latent misuse | `rg` for `QueueGateway`/`IQueueGateway` usages before merge; fix any compile failures                    |

## Rollback strategy

1. Revert commits touching `queue-names.ts`, `queue-gateway.ts`, `queue.gateway.ts`, and `infrastructure.module.ts`.
2. Restore prior documentation sections.
3. Re-run `npm run build` and `npm run test:unit` to confirm baseline.
4. No database migration rollback required.

## Open questions requiring human decision

1. **Option A vs Option B:** Remove seven unused placeholder queues (recommended), or keep all nine and extend `QueueJobRegistry`? Option A matches current runtime reality and P1-04 selective registration.
2. **Registry extension pattern:** If Option B, should placeholder queues use empty job maps, dummy jobs, or module augmentation files for downstream apps?
3. **Breaking change policy:** Is removing unused `QUEUES` keys acceptable for this starter-kit release, or must removed keys be deprecated aliases first?
4. **V-07 formalization:** Should V-07 scenario steps be promoted into `docs/agent-backlog/NESTJS_STARTER_KIT_REQUIRED_FIXES.md` as part of this fix or a separate documentation task?
