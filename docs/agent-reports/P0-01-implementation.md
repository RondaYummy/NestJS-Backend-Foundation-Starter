# P0-01 — Implementation report

## Verdict

implemented

## Approved plan

`docs/agent-plans/P0-01-lease-email-idempotency-heartbeat.md` (`status: approved`)

## Changed files

| File                                                                    | Change                                            |
| ----------------------------------------------------------------------- | ------------------------------------------------- |
| `libs/contracts/src/idempotency/job-execution.options.ts`               | **Created** — `JobExecutionOptions` contract      |
| `libs/contracts/src/idempotency/job-execution-store.ts`                 | Added `extend()` to `IJobExecutionStore`          |
| `libs/infrastructure/src/idempotency/job-execution.options.schema.ts`   | **Created** — Zod env parsing + mapper            |
| `libs/infrastructure/src/idempotency/redis-job-execution.store.ts`      | Implemented `extend()` via `compareAndExpire`     |
| `libs/infrastructure/src/idempotency/redis-job-execution.store.spec.ts` | Unit tests for `extend` success/failure           |
| `libs/infrastructure/src/config/env.schema.ts`                          | Job execution env vars + heartbeat validation     |
| `libs/infrastructure/src/config/infrastructure-config.module.ts`        | Wired `jobExecution` config shape                 |
| `libs/infrastructure/src/config/app-config.service.ts`                  | Added `jobExecution()` accessor                   |
| `apps/worker/src/processors/email.processor.ts`                         | Heartbeat, ownership-loss guard, config injection |
| `apps/worker/src/processors/email.processor.int-spec.ts`                | **Created** — V-03 integration test               |
| `.env.example`                                                          | Documented new env vars                           |

## Completed steps

1. Extended `IJobExecutionStore` with `extend(key, ownershipToken, ttlSeconds)`.
2. Implemented atomic lease renewal in `RedisJobExecutionStore`.
3. Added `JobExecutionOptions` contract and env-backed configuration (defaults: 300s lease, 100s heartbeat, 30d retention).
4. Updated `EmailProcessor` to heartbeat during execution, clear interval in `finally`, and abort before `mail.send()` when ownership is lost (with structured warning log).
5. Added unit tests for `extend` and integration test scaffold for backlog V-03.

## Deviations

None. Ownership-loss handling uses a retriable generic `Error` with `AppLogger.warn` structured context, matching the plan recommendation.

## Commands executed

```bash
npm run test:unit -- libs/infrastructure/src/idempotency/redis-job-execution.store.spec.ts
npm run test:int -- apps/worker/src/processors/email.processor.int-spec.ts
npx jest --config jest.integration.config.ts apps/worker/src/processors/email.processor.int-spec.ts --verbose
npm run build:worker
npm run build
npm run lint
npm run test:unit
npm run test:int
npx eslint apps/worker/src/processors/email.processor.int-spec.ts libs/infrastructure/src/idempotency libs/contracts/src/idempotency apps/worker/src/processors/email.processor.ts libs/infrastructure/src/config --max-warnings=0
```

## Command results

| Command                                                     | Result                                        | Conclusion                                                                                                                   |
| ----------------------------------------------------------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `npm run test:unit -- ...redis-job-execution.store.spec.ts` | Exit 0 — 8 tests passed                       | `extend` unit coverage passes                                                                                                |
| `npm run build:worker`                                      | Exit 0                                        | Worker compiles with new DI (`AppConfigService`, `AppLogger`)                                                                |
| `npm run build`                                             | Exit 0                                        | All entrypoints compile                                                                                                      |
| `npm run test:unit`                                         | Exit 0 — 14 tests passed                      | No unit regressions                                                                                                          |
| `npm run test:int`                                          | Exit 0 — 1 test passed (skipped body)         | Suite runs; see unverified areas                                                                                             |
| `npm run lint`                                              | Exit 1                                        | Pre-existing failure in `libs/infrastructure/src/mail/null-mail.adapter.ts` (`require-await`); not introduced by this change |
| Scoped eslint on changed files                              | Exit 0 (after fixing `beforeEach` async lint) | Changed files lint-clean                                                                                                     |

## Acceptance criteria self-check

- [x] `IJobExecutionStore` exposes `extend(key, ownershipToken, ttlSeconds): Promise<boolean>`.
- [x] `RedisJobExecutionStore.extend` renews TTL only when the stored value equals `ownershipToken` (atomic `compareAndExpire`).
- [x] `EmailProcessor` heartbeats during render/send and stops heartbeat in `finally`.
- [x] If ownership is lost before `mail.send()`, the processor does not send email.
- [x] Lease TTL and heartbeat interval are read from typed configuration, not hardcoded in the processor.
- [x] Unit tests cover `extend` success and failure.
- [ ] Integration test (V-03): with lease TTL 2s and 5s simulated send, duplicate delivery results in exactly one gateway call — **test present but not exercised** (Redis unavailable at `localhost:6379` during run; test skipped with warning).
- [x] `npm run build` passes.
- [ ] `npm run lint` — full-repo lint blocked by pre-existing `null-mail.adapter.ts` issue unrelated to P0-01.

## Remaining risks

- **Post-send ownership loss** (P2-02): if SMTP succeeds but `complete()` fails, a retry could still resend.
- **Heartbeat misconfiguration**: mitigated by env schema (`heartbeat <= lease / 2`).
- **Pre-send ownership loss** causes BullMQ retry; acceptable because no side effect occurred.

## Unverified areas

- V-03 integration scenario with live Redis (duplicate concurrent delivery while first job exceeds lease TTL).
- `npm run start:worker` manual scenario with shortened TTL env vars.
- Full `npm run lint` pass (blocked by unrelated pre-existing lint error).
