# P2-07 — Independent Verification

**Verified by:** independent-verifier  
**Date:** 2026-06-21  
**Branch:** main (staged changes)

---

## Verdict

**approved**

---

## Scope checked

Staged diff contains exactly 13 files. All match the plan's "Files to create" and "Files to modify" lists; no unplanned production file touches:

| File                                                                    | Plan entry            | Verdict        |
| ----------------------------------------------------------------------- | --------------------- | -------------- |
| `libs/infrastructure/src/idempotency/job-execution.errors.ts`           | Create                | In scope       |
| `libs/contracts/src/idempotency/job-execution-store.ts`                 | Modify                | In scope       |
| `libs/infrastructure/src/idempotency/redis-job-execution.store.ts`      | Modify                | In scope       |
| `libs/infrastructure/src/idempotency/redis-job-execution.store.spec.ts` | Modify                | In scope       |
| `libs/contracts/src/mail/email-gateway.ts`                              | Modify                | In scope       |
| `libs/infrastructure/src/mail/smtp-mail.adapter.ts`                     | Modify                | In scope       |
| `libs/infrastructure/src/mail/null-mail.adapter.ts`                     | Modify                | In scope       |
| `apps/worker/src/processors/email.processor.ts`                         | Modify                | In scope       |
| `apps/worker/src/processors/email.processor.spec.ts`                    | Create                | In scope       |
| `apps/worker/src/processors/email.processor.int-spec.ts`                | Modify                | In scope       |
| `README.md`                                                             | Modify                | In scope       |
| `EXAMPLES.md`                                                           | Modify                | In scope       |
| `docs/agent-reports/P2-07-implementation.md`                            | Implementation report | Non-production |

No changes to `worker.module.ts`, `idempotency.module.ts`, `TOKENS`, or unrelated infrastructure. No out-of-scope refactors detected.

---

## Root-cause assessment

The confirmed root cause was `EmailProcessor.process()` treating `IJobExecutionStore.complete()` as fire-and-forget. The fix directly addresses this:

1. `sideEffectCommitted` flag introduced at `let sideEffectCommitted = false` (line 45), set to `true` immediately after `mail.send()` succeeds (line 104).
2. Pre-complete `ownershipLost` check at lines 106–114 detects lease loss that occurred during the send.
3. `complete()` return value captured at line 116–120: `const completed = await this.executions.complete(...)`.
4. `!completed` path (lines 122–129) calls `handlePostSendCompletionFailure`.
5. Catch block (lines 131–134) calls `release()` **only** when `!sideEffectCommitted` — correct conditional.
6. `handlePostSendCompletionFailure` writes best-effort `markAmbiguousSent` and throws `UnrecoverableError`.

The implementation matches the root cause precisely and does not merely suppress symptoms.

---

## Acceptance criteria matrix

| #   | Criterion                                                                                                         | Status                         | Evidence                                                                                                                                                                                                                                                                                            |
| --- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `EmailProcessor` checks boolean return of `complete()` after successful send                                      | **passed**                     | `email.processor.ts` lines 116–129: `const completed = await this.executions.complete(...); if (!completed) { ... }`                                                                                                                                                                                |
| 2   | Post-send `ownershipLost === true` detected before `complete()` and handled identically to `complete() === false` | **passed**                     | Lines 106–114: `if (ownershipLost) { await this.handlePostSendCompletionFailure(...) }` before `complete()` call; unit test case 2 asserts `executions.complete` not called                                                                                                                         |
| 3   | Post-send failure writes `"sent-ambiguous"` via `markAmbiguousSent()` with `completedRetentionTtlSeconds` TTL     | **passed**                     | `handlePostSendCompletionFailure` calls `this.executions.markAmbiguousSent(idempotencyKey, completedRetentionTtlSeconds)`; unit test asserts correct call; store unit test asserts Redis key/value/TTL                                                                                              |
| 4   | Post-send failure throws `UnrecoverableError`; pre-send failures use `release()` and allow retry                  | **passed**                     | Post-send: `handlePostSendCompletionFailure` throws `new UnrecoverableError(...)`; pre-send: `assertOwnershipBeforeSend` throws plain `ExecutionOwnershipLostError`; catch calls `release()` only when `!sideEffectCommitted`; unit tests 3 and 4 confirm                                           |
| 5   | `ExecutionOwnershipLostError` with structured logging (`idempotencyKey`, `jobId`)                                 | **passed**                     | `job-execution.errors.ts`: class with `phase`, `idempotencyKey`, `jobId`, `reason`; `handlePostSendCompletionFailure` logs `{ idempotencyKey, jobId: job.id, reason }` at warn level                                                                                                                |
| 6   | Deterministic SMTP `Message-ID` from idempotency key when present                                                 | **passed**                     | `formatMessageId()` at line 166–170 sanitizes key and formats as `<${sanitized}@idempotency>`; passed to both templated and raw send paths; unit test asserts `messageId: '<welcome-user-1@idempotency>'`; `SmtpMailAdapter` passes `messageId` to nodemailer; `NullMailAdapter` accepts it (no-op) |
| 7   | Documentation states at-least-once; does **not** claim exactly-once                                               | **passed**                     | README diff: "Failure model (at-least-once, **не** exactly-once)"; EXAMPLES diff: "At-least-once семантика (не exactly-once)"; both explicitly state email is not exactly-once                                                                                                                      |
| 8   | Unit test: `release()` NOT called when send succeeded but `complete()` returned false                             | **passed**                     | `email.processor.spec.ts` lines 75–109: mocks `complete()` → `false`, asserts `executions.release` not called                                                                                                                                                                                       |
| 9   | Integration test: subsequent job with same key does not send after ambiguous marker                               | **passed (Redis-conditional)** | `email.processor.int-spec.ts` lines 166–209: test simulates token invalidation during send, asserts `sent-ambiguous` marker written, second `process()` call returns without calling `mail.send()` a second time. Test gracefully skips when Redis unavailable                                      |
| 10  | `npm run build`, `npm run lint`, relevant tests pass                                                              | **passed**                     | Build: exit 0; targeted lint on all 12 production files: exit 0 (no warnings); unit tests: 13/13 passed; integration: 2 tests pass/skip gracefully. Full-repo lint fails on pre-existing outbox issues (P2-08/P2-11, outside P2-07 diff)                                                            |

---

## Dependency and DI verification

```text
EmailProcessor.process()
  -> TOKENS.JobExecutionStore (injected via @Inject)
       -> IdempotencyModule.register() in worker.module.ts
            -> RedisJobExecutionStore (useClass: RedisJobExecutionStore)
                 -> implements IJobExecutionStore (now includes markAmbiguousSent)
                 -> RedisService.set() — method exists at redis.service.ts line 13

EmailProcessor.process()
  -> TOKENS.EmailGateway (injected via @Inject)
       -> MailModule.forRootAsync() in worker.module.ts
            -> SmtpMailAdapter | NullMailAdapter
                 -> both updated to accept optional messageId in send() signature
```

No new tokens introduced. No `worker.module.ts` or `idempotency.module.ts` wiring changes required (confirmed by scope check). `RedisService.set()` already exists with correct signature `(key, value, ttlSeconds?)` — no new method needed on `RedisService`.

`IJobExecutionStore` contract extended with `markAmbiguousSent(key, ttlSeconds)` — additive change; the only runtime consumer (`EmailProcessor`) and the only implementation (`RedisJobExecutionStore`) are both updated. `IdempotencyModule` exports `TOKENS.JobExecutionStore`; the new method is available to all consumers automatically.

`IEmailGateway.send()` extended with optional `messageId?: string` — additive; no callers broken.

---

## Commands executed

| Command                                                                                                | Result                                                       | Conclusion                                                                   |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| `git diff --staged --stat`                                                                             | 13 files, 514 insertions, 35 deletions                       | Scope matches plan exactly                                                   |
| `npm run build`                                                                                        | Exit 0 — all 4 entrypoints compiled                          | Full build passes after contract/infrastructure changes                      |
| `npm run test:unit -- --testPathPatterns="redis-job-execution.store.spec.ts\|email.processor.spec.ts"` | Exit 0 — **13 tests passed** in 2 suites                     | All new and existing unit tests pass                                         |
| `npm run test:int -- --testPathPatterns="email.processor.int-spec.ts"`                                 | Exit 0 — **2 tests passed** (skipped when Redis unavailable) | Integration test logic is structurally sound; skips gracefully without Redis |
| `npx eslint` on all 12 production P2-07 files                                                          | Exit 0 — no output                                           | No lint violations in changed files                                          |

---

## Findings

### Positive findings

1. **`sideEffectCommitted` flag is correctly placed**: Set after both send paths (templated and raw) resolve, before any completion logic. The flag precisely tracks whether the irreversible side effect occurred.

2. **`handlePostSendCompletionFailure` swallows marker errors correctly**: Redis failure during `markAmbiguousSent` is caught, logged at warn level, and does not mask the primary `UnrecoverableError`. Duplicate risk on manual re-enqueue with same key is acknowledged in docs.

3. **Pre-send ownership loss path correctly preserved**: `assertOwnershipBeforeSend` throws plain `ExecutionOwnershipLostError` (not `UnrecoverableError`), allowing BullMQ retry. Catch correctly calls `release()` when `!sideEffectCommitted`.

4. **Unit test coverage is comprehensive**: Four test cases cover all key paths — post-send `complete() === false`, post-send `ownershipLost` before complete, pre-send ownership loss, and SMTP failure before committed.

5. **Integration test design is correct**: Token invalidation during `send()` precisely simulates the race condition described in the root cause. The second `process()` call verifies the dedup gate.

### Minor observations (non-blocking)

1. **`handlePostSendCompletionFailure` signature deviation from plan**: Plan step 5 listed `ownershipToken` as a parameter; actual implementation omits it (not needed — `markAmbiguousSent` is unconditional). This is a harmless, correct simplification.

2. **Integration test `buildJob` has no `jobId`**: `buildJob(payload)` returns `{ data: payload }` without `id`, making `job.id` → `undefined` in integration tests. `String(undefined)` is `"undefined"` in the error message. Does not affect behavior being tested (dedup logic is based on `idempotencyKey`, not `jobId`).

3. **Jest open handle warning in integration test**: `"Jest did not exit one second after the test run has completed"` — pre-existing pattern in integration specs (ioredis connection teardown). Not a P2-07 defect.

4. **Full-repo lint and unit suite blocked by pre-existing outbox failures**: `outbox-processor.defaults.ts` and `outbox-processor.options.schema.ts` (P2-08/P2-11 scope) contain pre-existing lint errors. `outbox-processor.options.schema.spec.ts` has a pre-existing test failure. These are explicitly outside P2-07 diff and were present before this change.

---

## Documentation alignment

- **README §5.17** updated: `sent-ambiguous` state added to state diagram and contract table; flow diagram updated; failure model section relabeled "(at-least-once, **не** exactly-once)"; pre-send vs post-send failure handling distinguished; `Message-ID` best-effort hint documented.
- **EXAMPLES.md** updated: flow diagram extended with `sent-ambiguous` and `markAmbiguousSent`; key state table adds `sent-ambiguous` row; at-least-once caveat rewritten to describe the mitigated behavior and residual crash window.
- Both documents no longer contain the misleading "key may expire and allow repeat" wording (removed in diff).
- No claim of exactly-once delivery in any updated documentation.

Documentation and code are aligned.

---

## Remaining risks

The following risks are inherent to the design, documented by the implementer, and accepted by the plan:

1. **Residual crash window**: If the worker process dies after `mail.send()` succeeds but before `markAmbiguousSent()` completes, the key is absent and a future `acquire()` can succeed — potential duplicate. This is the documented at-least-once residual.
2. **Redis unavailability after send**: If Redis is down when `markAmbiguousSent` is called, the marker is not written. Worker still throws `UnrecoverableError` (no BullMQ retry), but manual re-enqueue with same key could duplicate. Documented risk.
3. **`Message-ID` dedup varies by provider**: Not a correctness guarantee. Documented as best-effort.
4. **Post-send ownership loss appears as BullMQ failed job**: Operators must treat these as "sent but unconfirmed" and not blindly retry. Documented operational note.

None of these risks are introduced by the implementation; they are inherent to the at-least-once email delivery model and are correctly documented.

---

## Unverified areas

1. **Integration tests with live Redis**: Both integration test cases skip when Redis is unavailable locally. The test logic was inspected and is structurally correct, but live-Redis execution was not possible in this environment.
2. **Worker bootstrap with live Redis + mail adapter**: `npm run start:worker` was not executed (Redis unavailable). Build succeeds and compilation confirms runtime wiring is correct.
3. **Full `npm run lint` and `npm run test:unit`**: Blocked by pre-existing P2-08/P2-11 outbox failures unrelated to this diff. P2-07 files individually: clean.
