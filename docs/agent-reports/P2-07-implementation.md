# P2-07 — Implementation report

## Verdict

implemented

## Approved plan

`docs/agent-plans/P2-07-email-complete-false-after-send.md` (`status: approved`)

## Changed files

| Path                                                                    | Change                                                                                                                                 |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `libs/infrastructure/src/idempotency/job-execution.errors.ts`           | **Created** — `ExecutionOwnershipLostError` with `before-send` / `after-send` phase context                                            |
| `libs/contracts/src/idempotency/job-execution-store.ts`                 | Added `markAmbiguousSent(key, ttlSeconds)` to `IJobExecutionStore`                                                                     |
| `libs/infrastructure/src/idempotency/redis-job-execution.store.ts`      | Implemented `markAmbiguousSent()` via unconditional Redis `set` to `sent-ambiguous`                                                    |
| `libs/infrastructure/src/idempotency/redis-job-execution.store.spec.ts` | Unit test for `markAmbiguousSent()` key/value/TTL                                                                                      |
| `libs/contracts/src/mail/email-gateway.ts`                              | Added optional `messageId?: string` to `IEmailGateway.send()` input                                                                    |
| `libs/infrastructure/src/mail/smtp-mail.adapter.ts`                     | Passes `messageId` to nodemailer `sendMail()`                                                                                          |
| `libs/infrastructure/src/mail/null-mail.adapter.ts`                     | Signature parity for optional `messageId`                                                                                              |
| `apps/worker/src/processors/email.processor.ts`                         | Post-send `complete()` check, `sideEffectCommitted` flag, conditional `release()`, `markAmbiguousSent` + `UnrecoverableError` handling |
| `apps/worker/src/processors/email.processor.spec.ts`                    | **Created** — unit tests for post-send complete failure, ownership loss paths, pre-send `release()`                                    |
| `apps/worker/src/processors/email.processor.int-spec.ts`                | Integration test: post-send complete failure writes `sent-ambiguous` and blocks duplicate send                                         |
| `README.md`                                                             | §5.17 job execution store — `sent-ambiguous` state, post-send failure model, at-least-once wording                                     |
| `EXAMPLES.md`                                                           | Email idempotency flow — ambiguous marker, `UnrecoverableError`, no exactly-once claim                                                 |

## Completed steps

1. **Error type** — `ExecutionOwnershipLostError` with `phase`, `idempotencyKey`, `jobId`, `reason`.
2. **Contract extension** — `IJobExecutionStore.markAmbiguousSent()`.
3. **Store implementation** — `RedisJobExecutionStore.markAmbiguousSent()` + unit test.
4. **Email gateway** — optional `messageId` on contract and both adapters.
5. **`EmailProcessor` refactor** — `sideEffectCommitted`; pre-send `ExecutionOwnershipLostError`; post-send `handlePostSendCompletionFailure()` with warn log, best-effort `markAmbiguousSent`, `UnrecoverableError`; conditional `release()`; deterministic `Message-ID` from idempotency key.
6. **Unit tests** — four cases covering post-send complete false, post-send ownership loss, pre-send ownership loss, and pre-send send failure.
7. **Integration test** — invalidates Redis token after send; asserts `sent-ambiguous` marker and no second `mail.send()`.
8. **Documentation** — README and EXAMPLES updated for at-least-once semantics and mitigated post-send failure behavior.

## Deviations

None.

## Commands executed

| Command                                                                          | Result                                                                                                                                  |
| -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run build:worker`                                                           | Pass (after adding `override` to `ExecutionOwnershipLostError.name`)                                                                    |
| `npm run build`                                                                  | Pass                                                                                                                                    |
| `npm run test:unit -- redis-job-execution.store.spec.ts email.processor.spec.ts` | Pass (13 tests)                                                                                                                         |
| `npm run test:int -- email.processor.int-spec.ts`                                | Pass (2 tests; Redis unavailable — integration cases skipped gracefully)                                                                |
| `npx eslint` on P2-07 changed files                                              | Pass                                                                                                                                    |
| `npm run lint`                                                                   | Fail — pre-existing errors in `outbox-processor.defaults.ts` and `outbox-processor.options.schema.ts` (P2-08/P2-11 scope, not modified) |
| `npm run test:unit`                                                              | Fail — 1 pre-existing failure in `outbox-processor.options.schema.spec.ts` (expects `handlerTimeoutMs: 300_000`, receives `0`)          |
| `npm run start:worker`                                                           | Fail — Redis unavailable after 5 startup attempts (infrastructure unavailable, not a code defect)                                       |

## Command results

- **P2-07 targeted build/tests:** pass with runtime evidence.
- **P2-07 changed files lint:** clean.
- **Full lint / full unit suite:** blocked by pre-existing outbox failures outside P2-07 diff.
- **Worker bootstrap:** compiled and reached Redis connectivity check; failed only because local Redis is not running.

## Acceptance criteria self-check

| Criterion                                                                                      | Status                                            |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `EmailProcessor` checks boolean return of `complete()` after successful send                   | Met                                               |
| Post-send `ownershipLost` detected before `complete()` and handled like `complete() === false` | Met — unit test                                   |
| Post-send failure writes `sent-ambiguous` via `markAmbiguousSent()` with retention TTL         | Met — unit + int test (int skipped without Redis) |
| Post-send failure throws `UnrecoverableError`; pre-send uses `release()` and allows retry      | Met — unit tests                                  |
| `ExecutionOwnershipLostError` with structured logging (`idempotencyKey`, `jobId`)              | Met                                               |
| Deterministic SMTP `Message-ID` from idempotency key when present                              | Met — unit test assertion                         |
| Documentation states at-least-once, not exactly-once                                           | Met — README + EXAMPLES                           |
| Unit test: no `release()` when send succeeded but `complete()` returned false                  | Met                                               |
| Integration test: subsequent job with same key does not send after ambiguous marker            | Met when Redis available; skipped locally         |
| `npm run build` passes                                                                         | Met                                               |
| `npm run lint` passes (full repo)                                                              | Not met — pre-existing outbox lint debt           |

## Remaining risks

- Residual crash window if process dies after SMTP send but before `markAmbiguousSent()` completes — documented at-least-once behavior.
- If `markAmbiguousSent()` fails (Redis down), job still fails via `UnrecoverableError` but duplicate risk remains on manual re-enqueue with same key.
- `Message-ID` dedup varies by provider — documented as best-effort hint only.
- Post-send ownership loss surfaces as **failed** BullMQ job — operators must not blindly retry.

## Unverified areas

- Integration tests with live Redis (skipped in this environment).
- Full-repo `npm run lint` and `npm run test:unit` green status (blocked by unrelated pre-existing outbox failures).
- Worker bootstrap with Redis + mail adapter running (Redis unavailable locally).
