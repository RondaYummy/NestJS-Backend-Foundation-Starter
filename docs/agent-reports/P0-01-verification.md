# P0-01 — Independent verification

## Verdict

**changes-required**

The P0-01 code implementation addresses the root cause and passes all functional acceptance criteria with runtime evidence. The **staged change set** bundles unrelated scope (backlog document rewrite, P2-01 artifact deletions, `null-mail.adapter.ts` lint fix) that must be separated before this issue can be approved for merge.

## Scope checked

**In scope (P0-01 production code — matches approved plan):**

| File                                                                    | Assessment                                      |
| ----------------------------------------------------------------------- | ----------------------------------------------- |
| `libs/contracts/src/idempotency/job-execution-store.ts`                 | `extend()` added                                |
| `libs/contracts/src/idempotency/job-execution.options.ts`               | Created                                         |
| `libs/infrastructure/src/idempotency/redis-job-execution.store.ts`      | `extend()` via `compareAndExpire`               |
| `libs/infrastructure/src/idempotency/redis-job-execution.store.spec.ts` | Unit tests for `extend`                         |
| `libs/infrastructure/src/idempotency/job-execution.options.schema.ts`   | Created                                         |
| `libs/infrastructure/src/config/env.schema.ts`                          | Job execution env vars + validation             |
| `libs/infrastructure/src/config/infrastructure-config.module.ts`        | `jobExecution` wiring                           |
| `libs/infrastructure/src/config/app-config.service.ts`                  | `jobExecution()` accessor                       |
| `apps/worker/src/processors/email.processor.ts`                         | Heartbeat, ownership guard, config              |
| `apps/worker/src/processors/email.processor.int-spec.ts`                | V-03 integration test                           |
| `.env.example`                                                          | New env vars documented                         |
| `docs/agent-plans/P0-01-lease-email-idempotency-heartbeat.md`           | Approved plan (replaces superseded atomic plan) |
| `docs/agent-reports/P0-01-implementation.md`                            | Implementation report                           |

**Out of scope (present in staged index):**

| File                                                      | Issue                                                                        |
| --------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `docs/agent-backlog/NESTJS_STARTER_KIT_REQUIRED_FIXES.md` | Full document rewrite/restructure (~250 lines removed), not limited to P0-01 |
| `docs/agent-plans/P2-01-outbox-runtime-configuration.md`  | Deleted — P2-01 artifact                                                     |
| `docs/agent-reports/P2-01-implementation.md`              | Deleted — P2-01 artifact                                                     |
| `docs/agent-reports/P2-01-verification.md`                | Deleted — P2-01 artifact                                                     |
| `libs/infrastructure/src/mail/null-mail.adapter.ts`       | Lint fix (`await Promise.resolve()`) — P2-05 territory, not in P0-01 plan    |
| `docs/agent-plans/P0-01-atomic-email-idempotency.md`      | Deleted superseded plan — acceptable if intentional cleanup                  |
| `docs/agent-reports/P0-01-verification.md` (prior)        | Deleted prior verification — replaced by this report                         |

**`null-mail.adapter.ts` assessment:** Not in P0-01 plan scope. The one-line `await Promise.resolve()` satisfies `@typescript-eslint/require-await` and enables full-repo lint to pass. It is a harmless no-op but should not ship bundled with P0-01. The implementation report incorrectly states the file was not modified and that lint failure is pre-existing; the staged diff shows it **was** modified.

## Root-cause assessment

**Confirmed root cause (backlog + plan):** Email worker idempotency used a fixed-TTL Redis ownership lease acquired once before render/send, with no heartbeat. Long-running jobs could outlive the TTL, allowing a retry/concurrent worker to `acquire()` the same key and duplicate the email side effect.

**Fix assessment:** Addressed correctly.

1. `IJobExecutionStore.extend()` added to the contract.
2. `RedisJobExecutionStore.extend()` delegates to atomic `RedisService.compareAndExpire()` (Lua compare-and-expire).
3. `EmailProcessor` starts a `setInterval` heartbeat after successful `acquire`, calls `extend` with the ownership token and lease TTL, sets `ownershipLost` on failure, uses `heartbeat.unref()` and `heartbeatInProgress` guard, and `clearInterval` in `finally`.
4. Before `mail.send()` (both templated and raw paths), checks `ownershipLost`, logs structured warning, throws retriable error without sending.
5. Hardcoded `EXECUTION_TTL_SECONDS` / `COMPLETED_RETENTION_TTL_SECONDS` removed; values read from `AppConfigService.jobExecution()`.

The implementation targets the root cause (lease expiry during long execution), not a symptom suppressor.

## Acceptance criteria matrix

| #   | Criterion                                                                                | Status     | Evidence                                                                                |
| --- | ---------------------------------------------------------------------------------------- | ---------- | --------------------------------------------------------------------------------------- |
| 1   | `IJobExecutionStore` exposes `extend(key, ownershipToken, ttlSeconds): Promise<boolean>` | **passed** | `libs/contracts/src/idempotency/job-execution-store.ts` line 4                          |
| 2   | `RedisJobExecutionStore.extend` renews TTL only when stored value equals token (atomic)  | **passed** | `redis-job-execution.store.ts` → `compareAndExpire`; unit tests mock `compareAndExpire` |
| 3   | `EmailProcessor` heartbeats during render/send and stops heartbeat in `finally`          | **passed** | Heartbeat starts after `acquire`, before `try`; `clearInterval` in `finally`            |
| 4   | If ownership lost before `mail.send()`, processor does not send email                    | **passed** | `ownershipLost` guard + throw before both `mail.send()` branches                        |
| 5   | Lease TTL and heartbeat interval from typed configuration, not hardcoded                 | **passed** | `config.jobExecution()`; env defaults 300/100/2592000; `.env.example` updated           |
| 6   | Unit tests cover `extend` success and failure                                            | **passed** | 2 dedicated tests in `redis-job-execution.store.spec.ts`; 8/8 unit tests pass           |
| 7   | Integration test (V-03): lease TTL 2s, 5s send, duplicate delivery → one gateway call    | **passed** | Redis available (`PONG`); test runtime ~9–12s (not vacuous skip); `sendCount === 1`     |
| 8   | `npm run build`, `npm run lint`, relevant tests pass                                     | **passed** | All commands exit 0 (see Commands executed)                                             |

## Dependency and DI verification

```text
WorkerModule
  imports: InfrastructureConfigModule → AppConfigService (jobExecution config)
  imports: IdempotencyModule → TOKENS.JobExecutionStore → RedisJobExecutionStore
  providers: EmailProcessor
    @Inject(TOKENS.JobExecutionStore) → IJobExecutionStore
    AppConfigService (constructor injection, no @Inject needed)
    AppLogger (constructor injection)
```

- `IdempotencyModule` registration unchanged; `RedisJobExecutionStore` satisfies extended interface.
- `EmailProcessor` does not require new tokens; uses existing `AppConfigService.jobExecution()` per plan.
- Only `RedisJobExecutionStore` implements `IJobExecutionStore` (no mock/stub gaps).

## Commands executed

| Command                                                                                                         | Result                                                                  | Conclusion                                                               |
| --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `npm run test:unit -- libs/infrastructure/src/idempotency/redis-job-execution.store.spec.ts`                    | Exit 0 — 8/8 passed                                                     | `extend` unit coverage confirmed                                         |
| `npm run build:worker`                                                                                          | Exit 0 on retry (first attempt exit -1073741819, no output — transient) | Worker compiles with new DI                                              |
| `npm run build`                                                                                                 | Exit 0                                                                  | All entrypoints compile                                                  |
| `npm run test:unit`                                                                                             | Exit 0 — 14/14 passed                                                   | No unit regressions                                                      |
| `npm run test:int -- apps/worker/src/processors/email.processor.int-spec.ts`                                    | Exit 0 — 1/1 passed                                                     | V-03 scenario exercised                                                  |
| `npx jest --config jest.integration.config.ts apps/worker/src/processors/email.processor.int-spec.ts --verbose` | Exit 0 — 1/1 passed (~9.3s)                                             | Confirms non-trivial runtime (not instant skip)                          |
| `npm run lint`                                                                                                  | Exit 0                                                                  | Full-repo lint passes (aided by out-of-scope `null-mail.adapter.ts` fix) |
| Redis probe (`ioredis` ping localhost:6379)                                                                     | `PONG`                                                                  | Integration test had live Redis; V-03 not skipped                        |
| `redis-cli ping`                                                                                                | Not available on PATH                                                   | Used Node/ioredis probe instead                                          |

## Findings

### Functional (pass)

- Heartbeat protocol matches plan: interval from config, `unref()`, overlap guard, ownership-loss flag, `finally` cleanup.
- `extend` uses existing atomic primitive consistent with idempotency service and distributed lock patterns.
- Env validation enforces `heartbeatIntervalSeconds <= floor(leaseTtlSeconds / 2)`.
- V-03 test design is sound: 2s lease, 1s heartbeat, 5s gateway delay, overlapping second `process()` — second worker fails at `acquire`, only one `send`.

### Scope / process (fail — blocks approval)

1. **P2-01 artifacts deleted** in the same staged index — violates one-issue-at-a-time discipline.
2. **Backlog document wholesale rewrite** — far exceeds P0-01 documentation needs.
3. **`null-mail.adapter.ts` modified** but omitted from implementation report changed-files table and mischaracterized as pre-existing lint failure.
4. **Implementation report claims** integration test was skipped (Redis unavailable) — independent run with Redis available exercised V-03 successfully.

### Documentation alignment

- Approved plan files-to-create/modify list is satisfied for production code.
- `.env.example` documents new vars with plan defaults.
- Implementation report acceptance self-check is partially stale (integration test and lint claims contradicted by independent verification).

## Remaining risks

- **Post-send ownership loss (P2-02):** SMTP may succeed while `complete()` fails or lease is lost mid-complete; retry could resend. Explicitly out of P0-01 scope per plan.
- **Pre-send ownership loss** throws retriable error → BullMQ retry; acceptable (no side effect).
- **Heartbeat during render only:** If ownership is lost during `render()`, send is still blocked by pre-send guard — correct.
- **No dedicated test** for `ownershipLost` path (extend returns false mid-flight); mitigated indirectly by V-03 duplicate-acquire scenario.
- **`build:worker` transient crash** on first attempt (Windows exit -1073741819); succeeded on immediate retry — monitor in CI.

## Unverified areas

- `npm run start:worker` manual scenario with shortened TTL env vars.
- Explicit integration test for ownership-loss-during-render (extend failure while first worker still running).
- CI environment confirmation (local verification only).
- Whether backlog document rewrite is intentional and approved separately from P0-01.

## Required actions before approval

1. Unstage/revert unrelated changes: P2-01 doc deletions, backlog wholesale rewrite (unless separately approved), `null-mail.adapter.ts` (or land under P2-05).
2. Update `P0-01-implementation.md` to reflect actual changed files and corrected command/evidence results.
3. Re-stage a P0-01-only diff and re-run verification on the cleaned index.
