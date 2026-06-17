---
issue_id: P0-01
status: approved
owner: human-approval-required
---

# P0-01 — Зробити lease email idempotency безпечним для довгих jobs

## Source issue

`docs/agent-backlog/NESTJS_STARTER_KIT_REQUIRED_FIXES.md` — section **#1. Зробити lease email idempotency безпечним для довгих jobs** (`P0-01`).

Related verification scenario: backlog **V-03** (email job longer than execution lease).

## Current behavior

1. `EmailProcessor` calls `IJobExecutionStore.acquire(idempotencyKey, 300)` once before render/send.
2. `EXECUTION_TTL_SECONDS = 300` is hardcoded in `apps/worker/src/processors/email.processor.ts`.
3. During `mailTemplates.render()` and `mail.send()` the Redis ownership key is not renewed.
4. `RedisJobExecutionStore` stores the ownership token under `job-execution:{key}` with Redis `EX` TTL. No `extend` API exists.
5. `complete()` and `release()` already use compare-and-set Lua semantics; only lease renewal is missing.
6. `IJobExecutionStore` has `acquire`, `complete`, `release` — no `extend`.

Confirmed in current branch (2026-06-17): defect still present; issue is **not stale**.

## Confirmed root cause

Email worker idempotency relies on a fixed-TTL Redis key as an ownership lease, but the lease is acquired once and never heartbeated. If render or SMTP exceeds the TTL, Redis deletes the key while the first worker is still executing. A retry or concurrent delivery can then `acquire()` the same `idempotencyKey` and perform a duplicate side effect.

## Dependency/runtime flow

```text
BullMQ EMAIL queue job (payload.idempotencyKey?)
  -> EmailProcessor.process()
       -> IJobExecutionStore.acquire(key, leaseTtl)  [Redis SET NX EX]
       -> MailTemplateService.render()               [no lease renewal today]
       -> IEmailGateway.send()                       [external side effect]
       -> IJobExecutionStore.complete(key, token)    [Lua CAS -> "completed"]
     on error:
       -> IJobExecutionStore.release(key, token)      [Lua CAS DEL]

DI:
  WorkerModule
    -> IdempotencyModule (TOKENS.JobExecutionStore -> RedisJobExecutionStore)
    -> InfrastructureConfigModule (AppConfigService)
    -> EmailProcessor
```

Existing heartbeat precedents in the same codebase:

- `libs/infrastructure/src/idempotency/idempotency.service.ts` — `compareAndExpire` + `lockLost` flag.
- `libs/infrastructure/src/locks/redis-distributed-lock.ts` — `extend()` + interval `ttlMs / 3`.

`RedisService.compareAndExpire()` already implements the atomic extend primitive needed by the store.

## Goal

Make email job idempotency safe for executions longer than the initial lease TTL by adding a renewable ownership lease with fencing token, configurable TTL/heartbeat, and tests that prove a second delivery cannot send while the first execution is still active.

## Scope

1. Extend `IJobExecutionStore` with `extend(key, ownershipToken, ttlSeconds)`.
2. Implement `extend` in `RedisJobExecutionStore` using atomic compare-and-expire.
3. Add typed, env-backed job-execution configuration for worker lease TTL and heartbeat interval.
4. Update `EmailProcessor` to run a heartbeat during execution, detect ownership loss, and abort before `mail.send()` when the lease is lost.
5. Add unit tests for `extend` and an integration test aligned with backlog **V-03**.

## Out of scope

- P0-02 (Outbox lease heartbeat).
- P2-02 (checking/handling `complete()` boolean result and post-send ownership loss) — note as follow-up; this plan only prevents duplicate send **before** side effect.
- Extracting a shared heartbeat utility across idempotency service, distributed lock, and email processor (optional future cleanup).
- Broad README/EXAMPLES rewrites (P2-03 / P3-02); only `.env.example` keys needed for new configuration.
- Changing HTTP idempotency (`IIdempotencyService`) behavior.
- API/Cron entrypoint changes beyond shared config schema if env vars are added globally.

## Files to create

| Path                                                                  | Responsibility                                                                                                        |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `libs/contracts/src/idempotency/job-execution.options.ts`             | Typed `JobExecutionOptions` contract (`leaseTtlSeconds`, `heartbeatIntervalSeconds`, `completedRetentionTtlSeconds`). |
| `libs/infrastructure/src/idempotency/job-execution.options.schema.ts` | Zod env parsing + `mapJobExecutionEnvToOptions()` mirroring outbox options pattern.                                   |
| `apps/worker/src/processors/email.processor.int-spec.ts`              | Integration test: job longer than lease TTL, second delivery with same key, gateway called once (V-03).               |

## Files to modify

| Path                                                                    | Symbol / responsibility                                                                                                                                                       |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `libs/contracts/src/idempotency/job-execution-store.ts`                 | `IJobExecutionStore` — add `extend(...)`.                                                                                                                                     |
| `libs/infrastructure/src/idempotency/redis-job-execution.store.ts`      | `RedisJobExecutionStore.extend()` — delegate to `RedisService.compareAndExpire()` on `job-execution:{key}`.                                                                   |
| `libs/infrastructure/src/idempotency/redis-job-execution.store.spec.ts` | Unit tests for `extend` success/failure paths.                                                                                                                                |
| `apps/worker/src/processors/email.processor.ts`                         | Replace hardcoded TTL; start/stop heartbeat in `try/finally`; guard `mail.send()` on ownership loss; inject config.                                                           |
| `libs/infrastructure/src/config/env.schema.ts`                          | Add `JOB_EXECUTION_LEASE_TTL_SECONDS`, `JOB_EXECUTION_HEARTBEAT_INTERVAL_SECONDS`, `JOB_EXECUTION_COMPLETED_RETENTION_TTL_SECONDS` with validation (`heartbeat < lease / 2`). |
| `libs/infrastructure/src/config/infrastructure-config.module.ts`        | Map new env fields into config shape via `mapJobExecutionEnvToOptions()`.                                                                                                     |
| `libs/infrastructure/src/config/app-config.service.ts`                  | `ConfigShape.jobExecution` + `jobExecution()` accessor.                                                                                                                       |
| `.env.example`                                                          | Document new env vars with defaults matching current behavior (300s lease, 100s heartbeat, 30d retention).                                                                    |

## Files to delete

None.

## Contract and DI changes

### Contract

```ts
export interface IJobExecutionStore {
  acquire(key: string, ttlSeconds: number): Promise<string | null>;
  extend(key: string, ownershipToken: string, ttlSeconds: number): Promise<boolean>;
  complete(key: string, ownershipToken: string, ttlSeconds: number): Promise<boolean>;
  release(key: string, ownershipToken: string): Promise<void>;
}
```

### New typed options

```ts
export interface JobExecutionOptions {
  leaseTtlSeconds: number;
  heartbeatIntervalSeconds: number;
  completedRetentionTtlSeconds: number;
}
```

### DI

- `IdempotencyModule` — **no registration change**; `RedisJobExecutionStore` implements extended interface.
- `EmailProcessor` — inject `AppConfigService` (already available via `InfrastructureConfigModule` in `WorkerModule`).
- No new tokens required unless implementer prefers a dedicated `JobExecutionOptions` provider; default plan uses `AppConfigService.jobExecution()`.

## Implementation steps

1. **Contracts**
   - Add `job-execution.options.ts`.
   - Add `extend` to `IJobExecutionStore`.

2. **Infrastructure store**
   - Implement `RedisJobExecutionStore.extend()`:
     ```ts
     return this.redis.compareAndExpire(this.buildKey(key), ownershipToken, ttlSeconds);
     ```
   - Add unit tests: extend returns `true` when token matches; `false` when key missing or token mismatched.

3. **Configuration**
   - Add env schema fields with defaults preserving current production-like behavior:
     - `JOB_EXECUTION_LEASE_TTL_SECONDS` default `300`
     - `JOB_EXECUTION_HEARTBEAT_INTERVAL_SECONDS` default `100`
     - `JOB_EXECUTION_COMPLETED_RETENTION_TTL_SECONDS` default `2592000` (30 days)
   - Validate `heartbeatIntervalSeconds >= 1` and `heartbeatIntervalSeconds <= Math.floor(leaseTtlSeconds / 2)`.
   - Wire through `infrastructure-config.module.ts` and `AppConfigService.jobExecution()`.
   - Update `.env.example`.

4. **EmailProcessor heartbeat protocol**
   - Read options from `AppConfigService.jobExecution()`.
   - After successful `acquire`, start `setInterval` heartbeat (pattern from `RedisIdempotencyService` / `RedisDistributedLock`):
     - call `executions.extend(idempotencyKey, ownershipToken, leaseTtlSeconds)`;
     - set `ownershipLost = true` when extend returns `false` or throws;
     - use `heartbeat.unref()`;
     - guard against overlapping ticks with `heartbeatInProgress`.
   - `clearInterval(heartbeat)` in `finally`.
   - Before `mail.send()` (and after `render()`), if `ownershipLost`, log structured warning and throw a retriable error (or domain-specific execution error) **without** calling `mail.send()`.
   - Keep existing `complete` on success and `release` on caught errors.
   - Remove module-level `EXECUTION_TTL_SECONDS` / `COMPLETED_RETENTION_TTL_SECONDS` constants.

5. **Integration test (V-03)**
   - File: `email.processor.int-spec.ts`.
   - Requires Redis (skip or fail clearly if `REDIS_HOST` unavailable — document in test).
   - Setup:
     - Real `RedisJobExecutionStore` + mocked `IEmailGateway` with configurable delay.
     - TTL = 2s, heartbeat = 1s (via test env or direct options injection).
     - First `process()` call: gateway delays 5s.
     - Concurrent/sequential second `process()` with same `idempotencyKey` while first is in-flight.
   - Assert: gateway `send` called exactly once.

## Migration and rollout concerns

- **Backward compatible contract extension**: adding `extend` to `IJobExecutionStore` is additive; only `RedisJobExecutionStore` implements it today.
- **New env vars have defaults** matching current hardcoded values; existing deployments need no `.env` change to preserve behavior for jobs shorter than 300s.
- **Operational tuning**: operators can lower TTL in test/staging to validate heartbeat behavior (V-03).
- **Redis dependency**: worker already requires Redis for idempotency; no new infrastructure.

## Targeted verification

```bash
npm run test:unit -- libs/infrastructure/src/idempotency/redis-job-execution.store.spec.ts
npm run test:int -- apps/worker/src/processors/email.processor.int-spec.ts
npm run build:worker
```

## Full verification

```bash
npm run build
npm run lint
npm run test:unit
npm run test:int
```

Optional runtime check when Redis is available:

```bash
npm run start:worker
```

(manual V-03 scenario with shortened TTL env vars).

## Acceptance criteria

- [ ] `IJobExecutionStore` exposes `extend(key, ownershipToken, ttlSeconds): Promise<boolean>`.
- [ ] `RedisJobExecutionStore.extend` renews TTL only when the stored value equals `ownershipToken` (atomic).
- [ ] `EmailProcessor` heartbeats during render/send and stops heartbeat in `finally`.
- [ ] If ownership is lost before `mail.send()`, the processor does not send email.
- [ ] Lease TTL and heartbeat interval are read from typed configuration, not hardcoded in the processor.
- [ ] Unit tests cover `extend` success and failure.
- [ ] Integration test (V-03): with lease TTL 2s and 5s simulated send, duplicate delivery results in exactly one gateway call.
- [ ] `npm run build`, `npm run lint`, and relevant tests pass.

## Risks

- **Post-send ownership loss** remains possible if SMTP succeeds but `complete()` fails or lease is lost mid-complete; duplicate retry could still resend (addressed by P2-02, not this issue).
- **Throwing on pre-send ownership loss** causes BullMQ retry; acceptable because no side effect occurred. If another worker already acquired, retry should no-op at `acquire`.
- **Heartbeat interval misconfiguration** could still allow expiry if set too close to TTL; mitigated by env schema validation.
- **Integration test flakiness** if Redis slow or unavailable; test should use conservative timings and clear skip messaging.

## Rollback strategy

1. Revert contract `extend` method and processor heartbeat logic.
2. Remove new env vars from schema (defaults are inert if unused).
3. Redeploy previous worker image.
4. No database migration involved.

## Open questions requiring human decision

1. **Ownership-loss error type**: throw generic `Error`, a new domain error (e.g. `JobExecutionOwnershipLostError`), or BullMQ `UnrecoverableError`? Recommendation: retriable generic/domain error since no side effect occurred.
2. **Shared heartbeat helper**: keep inline in `EmailProcessor` for minimal scope, or extract reusable utility now that three modules duplicate the pattern? Recommendation: inline for P0-01.
3. **P2-02 coordination**: should `complete()` failure handling be included in the same PR? Recommendation: keep separate unless human approves combined scope.
4. **Config surface**: global env vars via `AppConfigService` vs worker-only `forRoot` module options? Recommendation: env + `JobExecutionOptions` contract (consistent with current worker wiring); revisit under P1 portability tasks.
