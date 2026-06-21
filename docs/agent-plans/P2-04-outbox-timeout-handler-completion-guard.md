---
issue_id: P2-04
status: approved
owner: human-approval-required
---

# P2-04 — Do not reclaim Outbox event while a timed-out handler still runs

## Source issue

`docs/agent-backlog/NESTJS_STARTER_KIT_REQUIRED_FIXES.md` — section **P2-04. Не reclaim-ити Outbox event, поки timeouted handler продовжує side effect**.

Related verification scenario: backlog **V-09** (_Outbox timeout does not produce overlapping side effects_).

**Investigation (2026-06-21, branch `main`, clean working tree):** defect confirmed. P0-02 added lease heartbeat and optional handler timeout, but the timeout path still releases ownership while `IDomainEventRouter.route()` continues. Issue is **not stale**.

## Current behavior

1. `DrizzleOutboxProcessor.processPending()` claims rows, starts a heartbeat interval (`extendLock`), then calls `publishEventWithTimeout()`.
2. When `handlerTimeoutMs > 0`, `publishEventWithTimeout()` uses **`Promise.race`** between:
   - `publishEvent()` → `IDomainEventRouter.route()` → `IDomainEventHandler.handle()` side effects, and
   - a timer that **rejects** with `Outbox handler timeout after …ms`.
3. On timeout rejection, the `catch` path in `processPending()` immediately calls **`markFailed()`**, which sets `status = 'pending'` (retry) or `'failed'`, clears `lockedAt` / `lockedBy`, and schedules `availableAt`.
4. The `finally` block stops the heartbeat.
5. The original `publishEvent()` promise is **not awaited, aborted, or cancelled** — it keeps running as an orphaned async task.
6. After `availableAt`, another worker (or a later outbox job) can **re-claim** the same event via `claimPendingBatch()` while the first handler is still executing integration side effects.

**Default exposure:** `handlerTimeoutMs` defaults to **`0` (disabled)** in env schema, defaults, and `.env.example`. The race appears only when operators set `OUTBOX_HANDLER_TIMEOUT_MS > 0`.

**Partial mitigation already present (not sufficient for P2-04):**

- P0-02 heartbeat prevents **lease-expiry reclaim** during slow handlers when timeout is disabled.
- `UserRegisteredEventHandler` uses deterministic BullMQ `jobId` / `idempotencyKey`, which reduces duplicate enqueue impact but does **not** prevent concurrent handler execution or guarantee all future handlers will be idempotent.

## Confirmed root cause

`publishEventWithTimeout()` treats timeout as **abandonment** of the handler promise. `markFailed()` releases DB ownership before `route()` completes, so reclaim + concurrent side effects become possible even though heartbeat would otherwise keep the lease alive.

**Primary code location:** `libs/infrastructure/src/outbox/drizzle-outbox-processor.ts`

- `publishEventWithTimeout()` — lines 209–235 (`Promise.race` + reject on timeout)
- `processPending()` — lines 90–108 (`catch` → `markFailed()` immediately after timeout)
- `markFailed()` — lines 287–318 (clears `lockedAt` / `lockedBy`)

## Dependency/runtime flow

```text
Cron OutboxSchedule (distributed lock)
  -> BullMQ OUTBOX queue job
       -> OutboxProcessor.process()
            -> IOutboxProcessor.processPending()  [DrizzleOutboxProcessor]
                 -> claimPendingBatch()           [TX: SELECT FOR UPDATE SKIP LOCKED + UPDATE lockedAt/lockedBy]
                 -> for each event:
                      setInterval -> extendLock()  [heartbeat while processing]
                      publishEventWithTimeout()
                        -> publishEvent()
                             -> IDomainEventRouter.route()
                                  -> IDomainEventHandler.handle()  [e.g. BullMQ enqueue]
                      on success: markProcessed()
                      on error:   markFailed()     [releases row for retry]
                 finally: clearInterval(heartbeat)

DI (unchanged by this fix):
  apps/worker/src/worker.module.ts
  apps/cron/src/cron.module.ts
  libs/infrastructure/src/infrastructure.module.ts
    -> OutboxProcessorModule.forRootAsync({ useFactory: config.outbox() })
    -> DrizzleOutboxProcessor (TOKENS.OutboxProcessor)
    -> DomainEventRouter (TOKENS.DomainEventRouter)
    -> UserRegisteredEventHandler (TOKENS.DomainEventHandlers)
```

**Timeout race sequence (current, when `handlerTimeoutMs > 0`):**

```text
Worker A claims event, heartbeat active
  -> route() starts (slow external side effect)
  -> timeout fires; Promise.race rejects
  -> markFailed() clears lock; heartbeat stopped
  -> route() still running (orphaned)
Worker B claims same event after availableAt
  -> route() invoked again concurrently with Worker A
```

## Goal

When handler timeout is enabled, **do not release Outbox ownership for retry/reclaim until the in-flight handler promise has actually settled**, so a timed-out execution cannot overlap with a subsequent claim of the same event.

Timeout semantics after fix: timeout means **"do not treat the handler as successful"**, not **"abandon the handler and release the row immediately"**.

## Scope

**Chosen approach (backlog option 2):** await handler completion before calling `markFailed()` on the timeout path; keep heartbeat running until handler settlement.

**Rationale:** smallest correct fix — no contract change to `IDomainEventHandler`, no handler rewrites, directly closes the reclaim race. Cooperative `AbortSignal` (backlog option 1) and downstream fencing-only fixes (option 3) remain documented as follow-ups / defense in depth.

1. Refactor `publishEventWithTimeout()` so timeout flags failure but **waits for `publishEvent()` to settle** before propagating the timeout error to `processPending()`.
2. Preserve existing heartbeat lifecycle: heartbeat continues until `processPending()` `finally` (i.e., until handler settlement on timeout path).
3. Keep success path unchanged: handler completes within timeout → `markProcessed()` as today.
4. Keep failure semantics: handler exceeding timeout → `markFailed()` / retry (or permanent failure at max attempts); **never** `markProcessed()` after timeout even if handler later resolves successfully.
5. Add unit coverage for delayed `markFailed()` and single `route()` invocation under timeout.
6. Add PostgreSQL integration test aligned with backlog **V-09**.
7. Update Outbox timeout documentation in `README.md` (and `.env.example` comment if needed) to describe completion-guard behavior and at-least-once semantics.

## Out of scope

- Cooperative `AbortSignal` propagation through `IDomainEventRouter` / `IDomainEventHandler` (backlog option 1 — optional follow-up).
- New DB columns, migrations, or fencing tokens on `outbox_events`.
- Relying solely on downstream idempotency keys as the primary fix (backlog option 3 — `UserRegisteredEventHandler` already has keys; not sufficient alone).
- P2-08 (duplicate `process.env` path for Outbox Worker concurrency decorator).
- P2-07 (email `complete() === false` after provider send).
- Changing `IOutboxProcessor.processPending()` public signature.
- Worker/Cron composition root wiring changes beyond existing `OutboxProcessorModule.forRootAsync`.
- BullMQ job-level timeout configuration for outbox jobs.
- Crash window where side effect succeeds but process dies before `markProcessed()` — residual at-least-once behavior, unchanged.

## Files to create

| Path     | Responsibility                                  |
| -------- | ----------------------------------------------- |
| _(none)_ | V-09 coverage extends existing spec files below |

## Files to modify

| Path                                                                  | Symbol / responsibility                                                                                                                                                                                                                           |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `libs/infrastructure/src/outbox/drizzle-outbox-processor.ts`          | `publishEventWithTimeout()` — replace reject-on-timeout `Promise.race` with timeout flag + await handler settlement; optional dedicated timeout error class/message; ensure `processPending()` behavior unchanged except timing of `markFailed()` |
| `libs/infrastructure/src/outbox/drizzle-outbox-processor.spec.ts`     | New unit tests: timeout fires before slow `route()` resolves → `markFailed` deferred, `route()` called once, heartbeat not cleared until handler completes (use fake timers)                                                                      |
| `libs/infrastructure/src/outbox/drizzle-outbox-processor.int-spec.ts` | New integration test **V-09**: `handlerTimeoutMs > 0`, slow `route()`, mid-flight reclaim attempt by second processor must fail; final `route()` count = 1                                                                                        |
| `README.md`                                                           | Outbox tuning section (~§5.13): clarify that timeout marks failure **after** handler settlement and does not release the row for concurrent reclaim while handler is still running; retain at-least-once wording (no exactly-once claim)          |
| `.env.example`                                                        | Optional one-line comment under `OUTBOX_HANDLER_TIMEOUT_MS` mirroring README guard semantics                                                                                                                                                      |

## Files to delete

| Path     | Reason |
| -------- | ------ |
| _(none)_ | —      |

## Contract and DI changes

| Area                                         | Change                                   |
| -------------------------------------------- | ---------------------------------------- |
| `IOutboxProcessor`                           | **No change**                            |
| `OutboxProcessorOptions`                     | **No change** (reuse `handlerTimeoutMs`) |
| `IDomainEventRouter` / `IDomainEventHandler` | **No change** in this plan               |
| Nest providers / tokens                      | **No change**                            |
| Env schema / config mapping                  | **No change**                            |

## Implementation steps

1. **Introduce timeout guard in `publishEventWithTimeout()`**
   - Start `const publishPromise = this.publishEvent(event)`.
   - If `handlerTimeoutMs <= 0`, keep current behavior (`await publishPromise`).
   - Otherwise:
     - Run a non-rejecting timeout side (`handlerTimedOut` flag or `{ timedOut: true }` resolution).
     - `await Promise.race([publishPromise, timeoutPromise])`.
     - If timeout won first: log at `warn` with event id; **`await publishPromise` to settlement** (attach `.catch(() => undefined)` only if needed to avoid unhandled rejection — prefer explicit settlement handling).
     - After settlement, if timed out: throw a distinguishable timeout error (existing message string is fine).
     - If publish won first: return normally (handler succeeded within budget).

2. **Verify `processPending()` lifecycle needs no structural change**
   - `catch` still calls `markFailed()` — but only after step 1 completes, so ownership remains until handler finishes.
   - `finally` still clears heartbeat after handler settlement.
   - Confirm `ownershipLost` checks remain meaningful on timeout path (heartbeat continues during wait).

3. **Unit tests (`drizzle-outbox-processor.spec.ts`)**
   - Case A: `handlerTimeoutMs = 1000`, mocked `route()` resolves after 3000 ms (fake timers):
     - `route()` invoked once.
     - `markFailed` DB update not observed until after 3000 ms.
     - Result: `failed = 1`, not `processed`.
   - Case B: `handlerTimeoutMs = 1000`, `route()` resolves at 500 ms:
     - Normal success; `markProcessed` path.
   - Case C (regression): `handlerTimeoutMs = 0`, slow route — existing P0-02 unit behavior unchanged.

4. **Integration test V-09 (`drizzle-outbox-processor.int-spec.ts`)**
   - Options: `lockTtlMs = 3000`, `heartbeatIntervalMs = 500`, `handlerTimeoutMs = 2000`, `retryDelaySeconds = () => 0` (or wait for `availableAt` in a second phase).
   - Insert pending outbox row.
   - Processor A: `processPending()` with `routeDelayMs = 5000`.
   - At ~2500 ms (after timeout, before handler completes): Processor B `claimPendingBatch()` must **not** return the event id.
   - Await A completion: `routeCount === 1`, row `status !== 'processed'` (pending retry or failed per attempts), lock cleared only after handler done.
   - Optional phase 2: after `availableAt`, second `processPending()` may retry (at-least-once) — document expected second `route()` only after first execution fully finished.

5. **Documentation**
   - README: replace wording implying immediate release on timeout with completion-guard semantics.
   - Cross-reference P2-04 / V-09 in plan report only; do not mark backlog resolved here.

## Migration and rollout concerns

- **No schema migration.**
- **Behavior change** only when `OUTBOX_HANDLER_TIMEOUT_MS > 0`:
  - Timed-out events stay locked longer (until handler completes), which may increase lock hold time and reduce premature retries — intended.
  - Operators who enabled timeout expecting immediate retry release will see delayed retry scheduling; document in README.
- Default `handlerTimeoutMs = 0` deployments are unaffected.

## Targeted verification

| Command / scenario                                         | Expected result                                                                  |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `npm run test:unit -- drizzle-outbox-processor.spec.ts`    | New timeout-guard unit cases pass                                                |
| `npm run test:int -- drizzle-outbox-processor.int-spec.ts` | V-09 scenario passes when PostgreSQL available; skips gracefully otherwise       |
| Manual code review of `publishEventWithTimeout()`          | No orphaned `publishEvent()` after timeout; `markFailed()` only after settlement |

## Full verification

| Command             | Expected result                                                       |
| ------------------- | --------------------------------------------------------------------- |
| `npm run build`     | Pass (infrastructure/outbox change in shared lib)                     |
| `npm run lint`      | Pass                                                                  |
| `npm run test:unit` | Pass                                                                  |
| `npm run test:int`  | Pass or skip only for infra-unavailable cases already handled in spec |

Record results in `docs/agent-reports/P2-04-implementation.md` after implementation.

## Acceptance criteria

- [ ] With `handlerTimeoutMs > 0`, a slow `route()` that exceeds the timeout does **not** cause `markFailed()` / lock release until `route()` settles.
- [ ] While the first handler is still running after timeout, a second worker **cannot** reclaim the same outbox row (V-09).
- [ ] `route()` / handler side effect for a single claim attempt is invoked **at most once concurrently** per timeout cycle (integration test asserts `routeCount === 1` through the guarded window).
- [ ] Handler completing within timeout still follows the existing success path (`markProcessed()`).
- [ ] Handler exceeding timeout is marked failed/retried and is **not** marked processed, even if the handler promise later resolves successfully.
- [ ] Default `handlerTimeoutMs = 0` behavior remains unchanged.
- [ ] README documents completion-guard timeout semantics and does not imply exactly-once delivery.
- [ ] No changes to `IOutboxProcessor`, `IDomainEventRouter`, or `IDomainEventHandler` contracts in this fix.
- [ ] `npm run build` and `npm run lint` pass.

## Risks

| Risk                                                                  | Mitigation                                                                                                                |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Long-running handlers after timeout hold DB locks longer              | Intended trade-off; operators can still tune `lockTtlMs`, disable timeout (`0`), or adopt future AbortSignal cancellation |
| Handler never settles (hang)                                          | Pre-existing hang risk; timeout currently does not cancel anyway — document; future AbortSignal work optional             |
| Unit tests flaky with real timers                                     | Use Jest fake timers in unit spec; keep int-spec wall-clock delays bounded (≤ 20 s)                                       |
| Retry after timeout may still duplicate side effects **sequentially** | At-least-once is acceptable per backlog; concurrent overlap is the defect being fixed                                     |

## Rollback strategy

Revert `drizzle-outbox-processor.ts` timeout guard and new tests/docs. No migration rollback required. Deployments using `OUTBOX_HANDLER_TIMEOUT_MS=0` are unaffected even before rollback.

## Open questions requiring human decision

1. **Timeout error vs handler error when both occur:** If the handler rejects after timeout fired, should `markFailed()` record the handler error, the timeout error, or a combined message? Plan default: **timeout error takes precedence** for observability when `handlerTimedOut === true`.
2. **Logging level on timeout while waiting:** Plan proposes `warn` once when timeout threshold crossed, plus existing batch warn on failures. Confirm acceptable log volume.
3. **AbortSignal follow-up:** Approve deferring cooperative cancellation (contract + handler updates) to a separate task, or require it in this same issue?
4. **Sequential retry after timeout:** V-09 test may include a second `processPending()` after `availableAt` to prove at-least-once retry still works — confirm desired scope for the integration test vs. concurrent-only assertion.
