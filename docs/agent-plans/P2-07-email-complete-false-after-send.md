---
issue_id: P2-07
status: approved
owner: human-approval-required
---

# P2-07 — Handle `complete() === false` after email side effect

## Source issue

`docs/agent-backlog/NESTJS_STARTER_KIT_REQUIRED_FIXES.md` — section **P2-07. Обробляти `complete() === false` після email side effect**.

Related backlog note: **R-03** confirms `RedisJobExecutionStore` lease mechanics are already implemented; only post-send `complete()` handling in `EmailProcessor` remains open.

**Investigation (2026-06-21, branch `main`, clean working tree):** defect confirmed. `EmailProcessor` awaits `IJobExecutionStore.complete()` but discards its boolean result. Issue is **not stale**.

## Current behavior

1. `EmailProcessor.process()` acquires a Redis execution lease when `idempotencyKey` is present, starts a heartbeat interval, sends email via `IEmailGateway.send()`, then calls `executions.complete()`.
2. Pre-send ownership loss is guarded: if heartbeat sets `ownershipLost` before send, processor logs a warning and throws — the `catch` path calls `release()` and BullMQ may retry (correct for pre-send failure).
3. Post-send, the `complete()` return value is **never checked** (lines 107–112 of `email.processor.ts`). Processor returns normally regardless of outcome.
4. `RedisJobExecutionStore.complete()` returns `false` when the Redis key is missing or the stored token no longer matches the caller's ownership token (compare-and-set failure).
5. When `complete()` returns `false` after a successful send:
   - BullMQ marks the job **successful** (no error thrown);
   - no durable `"completed"` marker is written;
   - the execution key may expire entirely;
   - a later retry or re-enqueued job with the same `idempotencyKey` can `acquire()` again and send a **duplicate email**.
6. Throwing a generic error into the existing `catch` block would call `release()` (wrong after send) and trigger BullMQ retries (default **3 attempts** via `BullQueueGateway.buildJobOptions()`) — amplifying duplicate sends.
7. `DrizzleOutboxProcessor` already guards post-side-effect ownership (`markProcessed()` check, lines 83–87); email processor has no equivalent after `complete()`.
8. README documents this gap explicitly (lines 1448–1449) but code does not mitigate it.

## Confirmed root cause

`EmailProcessor.process()` treats post-send `complete()` as fire-and-forget. When the Redis lease/token is lost during or after `mail.send()`, the irreversible side effect has already occurred but no durable completion (or ambiguous) marker is persisted, and BullMQ considers the job successful — leaving the idempotency gate open for future deliveries.

**Primary code location:** `apps/worker/src/processors/email.processor.ts` — `EmailProcessor.process()`, lines 107–112.

**Supporting evidence:**

- `libs/infrastructure/src/idempotency/redis-job-execution.store.ts` — `complete()` returns `result === 'OK'` (false on token mismatch / missing key); unit-tested in `redis-job-execution.store.spec.ts` lines 55–60.
- `EmailProcessor` is the **only** runtime consumer of `IJobExecutionStore.complete()`.
- No `ExecutionOwnershipLostError` or BullMQ `UnrecoverableError` usage exists in the codebase today.

## Dependency/runtime flow

```text
UserRegisteredEventHandler (or other enqueue path)
  -> IQueueGateway.add(QUEUES.EMAIL, 'send-welcome-email', { idempotencyKey, ... })
       -> BullMQ job (stable jobId when provided)

Worker EmailProcessor.process()
  -> IJobExecutionStore.acquire(idempotencyKey)     [SET NX EX → UUID token | null]
  -> setInterval → IJobExecutionStore.extend()      [heartbeat; sets ownershipLost on failure]
  -> IEmailGateway.send()                           [irreversible side effect]
  -> IJobExecutionStore.complete()                  [CAS token → "completed"; returns boolean]  ← NOT CHECKED
  -> return (BullMQ success)

On thrown error (current):
  -> IJobExecutionStore.release()                   [compare-and-delete; allows retry]
  -> rethrow → BullMQ retry (up to defaultAttempts)

DI (unchanged composition roots):
  apps/worker/src/worker.module.ts
    -> IdempotencyModule.register() → RedisJobExecutionStore (TOKENS.JobExecutionStore)
    -> MailModule.forRootAsync() → SmtpMailAdapter | NullMailAdapter (TOKENS.EmailGateway)
    -> EmailProcessor provider

  apps/api/src/api.module.ts
    -> IdempotencyModule.register() (HTTP idempotency only; no JobExecutionStore consumer)
```

**Failure sequence (current):**

```text
Worker acquires lease, sends email successfully
  -> lease expires or heartbeat fails during long SMTP call
  -> complete() returns false (token mismatch / key gone)
  -> processor returns; BullMQ marks job completed
  -> execution key absent after TTL
  -> new job acquires lease → duplicate email
```

## Goal

After a successful email send, treat `complete() === false` (and post-send `ownershipLost`) as an **explicit ambiguous outcome**, not silent success. Persist a best-effort durable marker to block future duplicate sends, fail the BullMQ job **without retry**, and document at-least-once semantics — without claiming exactly-once delivery.

## Scope

**Chosen approach (hybrid — backlog options combined):**

1. **Check** `complete()` return value and re-check `ownershipLost` immediately before `complete()`.
2. On post-send completion failure:
   - **Best-effort durable marker:** add `IJobExecutionStore.markAmbiguousSent(key, ttlSeconds)` that unconditionally sets Redis value `"sent-ambiguous"` with `completedRetentionTtlSeconds` TTL (blocks future `acquire` via SET NX).
   - **Explicit error:** introduce `ExecutionOwnershipLostError` and throw it wrapped in BullMQ `UnrecoverableError` so the job fails without BullMQ retry (email already sent; retry would duplicate).
   - **Structured audit log** (warn level) with `idempotencyKey`, `jobId`, and outcome reason — mirror outbox ownership-lost logging style.
3. **Split error handling** in `EmailProcessor`: track `sideEffectCommitted` after successful `mail.send()`; call `release()` only when `!sideEffectCommitted`.
4. **Best-effort provider dedup signal:** when `idempotencyKey` is present, pass it to SMTP as a deterministic `Message-ID` header (nodemailer `messageId` option). Document as provider-level hint, not a guarantee.
5. **Unit tests** for post-send `complete() === false` and pre-send vs post-send `release()` behavior.
6. **Integration test** extending `email.processor.int-spec.ts`: simulate lease loss between send and complete; assert no second `mail.send()` on subsequent `process()` call when ambiguous marker is written.
7. **Documentation:** update README §5.17 job execution failure model and `EXAMPLES.md` at-least-once note to describe post-send ambiguous handling and residual crash window.

## Out of scope

- Changing `RedisJobExecutionStore.acquire()` / `complete()` CAS semantics (R-03 — already correct).
- Exactly-once email delivery claims or new durable PostgreSQL dedup store.
- P2-04 (Outbox timeout handler completion guard).
- P2-08 (Outbox processor duplicate `process.env` path).
- Extending `IEmailGateway` with a formal idempotency-key contract field beyond optional `messageId` passthrough (minimal additive optional field only if needed for SMTP).
- New env variables or config schema changes.
- Worker/Cron/API composition root wiring changes beyond existing providers.
- Crash window where process dies **before** ambiguous marker write completes — residual at-least-once behavior, documented but not eliminated.

## Files to create

| Path                                                          | Responsibility                                                                                                                                                                      |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `libs/infrastructure/src/idempotency/job-execution.errors.ts` | Export `ExecutionOwnershipLostError` (extends `Error`, stable `name`, optional `idempotencyKey` / `jobId` context).                                                                 |
| `apps/worker/src/processors/email.processor.spec.ts`          | Unit tests with mocked `IJobExecutionStore`, `IEmailGateway`, config, logger; cover post-send complete failure, no `release()` on post-send path, `UnrecoverableError` propagation. |

## Files to modify

| Path                                                                    | Symbol / responsibility                                                                                                                                                                                       |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `libs/contracts/src/idempotency/job-execution-store.ts`                 | `IJobExecutionStore` — add `markAmbiguousSent(key: string, ttlSeconds: number): Promise<void>`.                                                                                                               |
| `libs/infrastructure/src/idempotency/redis-job-execution.store.ts`      | `RedisJobExecutionStore.markAmbiguousSent()` — unconditional `RedisService.set(buildKey(key), 'sent-ambiguous', ttlSeconds)`.                                                                                 |
| `libs/infrastructure/src/idempotency/redis-job-execution.store.spec.ts` | Unit test for `markAmbiguousSent()` key/value/TTL.                                                                                                                                                            |
| `apps/worker/src/processors/email.processor.ts`                         | `EmailProcessor.process()` — `sideEffectCommitted` flag; pre-complete ownership check; capture `complete()` result; post-send failure handler; conditional `release()`; `UnrecoverableError` throw.           |
| `libs/infrastructure/src/mail/smtp-mail.adapter.ts`                     | `SmtpMailAdapter.send()` — accept optional `messageId` in input; pass to nodemailer `sendMail({ messageId })`.                                                                                                |
| `libs/infrastructure/src/mail/null-mail.adapter.ts`                     | `NullMailAdapter.send()` — accept optional `messageId` (no-op, signature parity).                                                                                                                             |
| `libs/contracts/src/mail/email-gateway.ts`                              | `IEmailGateway.send()` input — add optional `messageId?: string`.                                                                                                                                             |
| `apps/worker/src/processors/email.processor.int-spec.ts`                | New case: post-send `complete()` failure → subsequent duplicate job does not send again (when Redis available).                                                                                               |
| `README.md`                                                             | §5.17 Job execution store — document `"sent-ambiguous"` state, post-send failure handling, updated failure model (replace "key may expire and allow repeat" with mitigated behavior + residual crash window). |
| `EXAMPLES.md`                                                           | At-least-once email note — reference ambiguous marker and no-retry policy.                                                                                                                                    |

## Files to delete

None.

## Contract and DI changes

| Change                                      | Impact                                                                                                                          |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `IJobExecutionStore.markAmbiguousSent()`    | New method on existing port. `RedisJobExecutionStore` implements it. No new tokens. `IdempotencyModule` registration unchanged. |
| `IEmailGateway.send()` optional `messageId` | Additive optional field; existing callers unaffected. `SmtpMailAdapter` and `NullMailAdapter` updated.                          |
| `ExecutionOwnershipLostError`               | Infrastructure-local error class; thrown from `EmailProcessor`, wrapped in `UnrecoverableError` from `bullmq`.                  |
| Redis key states                            | Extend documented states: `… → completed` **or** `… → sent-ambiguous` (both block `acquire` via SET NX).                        |

No changes to `TOKENS`, `IdempotencyModule`, or `apps/worker/src/worker.module.ts` provider arrays expected.

## Implementation steps

1. **Add error type** — create `ExecutionOwnershipLostError` in `libs/infrastructure/src/idempotency/job-execution.errors.ts` with message distinguishing pre-send vs post-send context (`phase: 'before-send' | 'after-send'`).

2. **Extend contract** — add `markAmbiguousSent(key, ttlSeconds)` to `IJobExecutionStore`.

3. **Implement store method** — in `RedisJobExecutionStore`, call `this.redis.set(this.buildKey(key), 'sent-ambiguous', ttlSeconds)`. Add unit test asserting key, value, and TTL arguments.

4. **Extend email gateway (optional field)** — add `messageId?: string` to `IEmailGateway.send()` input; wire through `SmtpMailAdapter` (nodemailer) and `NullMailAdapter`.

5. **Refactor `EmailProcessor.process()`**:
   - Introduce `let sideEffectCommitted = false`.
   - After successful `mail.send()`, set `sideEffectCommitted = true`.
   - Pass `messageId: idempotencyKey ? formatMessageId(idempotencyKey) : undefined` to `mail.send()` (private helper producing RFC-compliant Message-ID from idempotency key).
   - Before `complete()`, if `ownershipLost`, call private `handlePostSendCompletionFailure(idempotencyKey, ownershipToken, job, reason)`.
   - Capture `const completed = await this.executions.complete(...)`.
   - If `!completed`, call same failure handler.
   - In `catch`: call `release()` **only** when `idempotencyKey && ownershipToken && !sideEffectCommitted`; rethrow.
   - `handlePostSendCompletionFailure`:
     - Log structured warn (`Job execution ownership lost after email send`, `{ idempotencyKey, jobId, reason }`).
     - Best-effort `await this.executions.markAmbiguousSent(idempotencyKey, completedRetentionTtlSeconds)` (swallow/log Redis errors — marker failure must not mask the primary error).
     - `throw new UnrecoverableError(new ExecutionOwnershipLostError(...).message)`.

6. **Unit tests** — `email.processor.spec.ts`:
   - Mock `complete()` → `false` after send resolves → expect `markAmbiguousSent` called, `release` **not** called, thrown error is `UnrecoverableError`.
   - Mock `ownershipLost = true` before complete (simulate via extend returning false on last heartbeat tick before complete check) → same assertions.
   - Pre-send throw path → `release` called, error is **not** `UnrecoverableError`.

7. **Integration test** — in `email.processor.int-spec.ts`:
   - Use short lease (existing `TEST_JOB_EXECUTION_OPTIONS`), delayed send, force token invalidation before complete (e.g. manually overwrite Redis key mid-flight, or stop heartbeat and wait for expiry).
   - Assert first run throws/fails without BullMQ retry semantics (processor throw).
   - Assert second `process()` with same `idempotencyKey` does not call `mail.send()` (ambiguous or completed marker blocks acquire).

8. **Documentation** — update README failure model and EXAMPLES.md; explicitly state delivery is **at-least-once**, not exactly-once; describe `"sent-ambiguous"` and no-retry on post-send ownership loss.

## Migration and rollout concerns

- **Backward compatible:** additive contract method and optional gateway field; no DB migrations.
- **Redis key semantics:** new `"sent-ambiguous"` value coexists with `"completed"`; both prevent `acquire` (SET NX). Existing in-flight keys unaffected.
- **Deploy order:** Worker-only change; deploy worker after API is safe (API does not consume `JobExecutionStore` for email).
- **Operational note:** jobs failing with `UnrecoverableError` after send appear as **failed** in BullMQ, not completed — operators should treat as "sent but unconfirmed" and rely on logs/ambiguous marker, not retry the job manually without dedup review.

## Targeted verification

| Command                                                                          | Expected result                                                                                  |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `npm run build:worker`                                                           | Compiles after processor and error changes.                                                      |
| `npm run build`                                                                  | Compiles if contracts/infrastructure gateway signature changes propagate.                        |
| `npm run test:unit -- redis-job-execution.store.spec.ts email.processor.spec.ts` | New and existing store unit tests pass.                                                          |
| `npm run test:int -- email.processor.int-spec.ts`                                | V-03 overlap test still passes; new post-send complete-failure case passes when Redis available. |

## Full verification

| Command                | Expected result                                                                                                |
| ---------------------- | -------------------------------------------------------------------------------------------------------------- |
| `npm run build`        | All entrypoints compile.                                                                                       |
| `npm run lint`         | No new lint violations.                                                                                        |
| `npm run test:unit`    | Full unit suite passes.                                                                                        |
| `npm run test:int`     | Integration suite passes (Redis/PostgreSQL availability noted if skipped).                                     |
| `npm run start:worker` | Worker bootstraps with local Redis and mail adapter (smoke; infrastructure availability noted if unavailable). |

## Acceptance criteria

- [ ] `EmailProcessor` checks the boolean return value of `IJobExecutionStore.complete()` after successful `mail.send()`.
- [ ] Post-send `ownershipLost === true` is detected before calling `complete()` and handled identically to `complete() === false`.
- [ ] Post-send completion failure writes a best-effort `"sent-ambiguous"` Redis marker via `markAmbiguousSent()` with `completedRetentionTtlSeconds` TTL.
- [ ] Post-send completion failure throws `UnrecoverableError` (no BullMQ retry); pre-send failures still use `release()` and allow retry.
- [ ] `ExecutionOwnershipLostError` (or equivalent named error) is raised with structured logging including `idempotencyKey` and `jobId`.
- [ ] When `idempotencyKey` is present, SMTP send includes a deterministic `Message-ID` derived from the key (best-effort provider hint).
- [ ] Documentation states at-least-once delivery; does **not** claim exactly-once email delivery.
- [ ] Unit test proves `release()` is **not** called when send succeeded but `complete()` returned false.
- [ ] Integration test (Redis available) proves a subsequent job with the same `idempotencyKey` does not send again after ambiguous marker write.
- [ ] `npm run build`, `npm run lint`, and relevant tests pass.

## Risks

| Risk                                                                     | Mitigation                                                                                                                  |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| `markAmbiguousSent()` fails (Redis unavailable) after send               | Log error; still throw `UnrecoverableError` to prevent BullMQ retry; document residual duplicate risk on manual re-enqueue. |
| Ambiguous marker blocks legitimate resend forever (within retention TTL) | Intentional for idempotent notification flows; document that operators must use a new idempotency key to force resend.      |
| `UnrecoverableError` surfaces as failed job in BullMQ UI                 | Document operational semantics; prefer failed-over-silent-success.                                                          |
| Message-ID dedup varies by provider                                      | Document as best-effort; not relied upon for correctness.                                                                   |
| Pre-existing README states the bug without fix                           | Update docs in same change set.                                                                                             |

## Rollback strategy

Revert worker and infrastructure changes. Redis keys with `"sent-ambiguous"` expire per TTL (default 30 days) or can be manually deleted. No schema rollback required. BullMQ failed jobs from `UnrecoverableError` remain in failed set — safe to discard (email already sent).

## Open questions requiring human decision

1. **Message-ID scope:** Approve optional `messageId` on `IEmailGateway.send()` in this fix, or defer provider dedup to a follow-up task? _(Plan recommends include — minimal additive change aligned with backlog "provider idempotency key" requirement.)_

2. **Ambiguous marker TTL:** Reuse `completedRetentionTtlSeconds` (default 30 days) for `"sent-ambiguous"`, or introduce a separate retention env? _(Plan recommends reuse — same dedup horizon as `"completed"`.)_

3. **BullMQ job visibility:** Accept that post-send ownership loss marks the job **failed** (not completed) in BullMQ, requiring operator awareness? _(Plan recommends yes — failed is more honest than silent success.)_

4. **Pre-send error typing:** Upgrade existing pre-send ownership loss from generic `Error` to `ExecutionOwnershipLostError` for consistency, or limit new error type to post-send path only? _(Plan recommends upgrade both paths for uniform log filtering; pre-send remains recoverable/non-`UnrecoverableError`.)_
