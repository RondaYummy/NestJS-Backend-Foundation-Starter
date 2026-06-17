---
issue_id: P0-01
status: approved
owner: human-approval-required
---

# P0-01 — Make email worker idempotency atomic

## Source issue

Backlog section: `docs/agent-backlog/NESTJS_STARTER_KIT_REQUIRED_FIXES.md` → `## 1. Зробити idempotency email worker атомарною` (indexed as `P0-01` in `docs/agent-backlog/INDEX.md`).

**Classification:** Confirmed defect (P0 / High).

## Current behavior

`EmailProcessor` guards templated email jobs with a two-step Redis check before and after the SMTP side effect:

```text
isCompleted(idempotencyKey)
  -> mail.send()
    -> markCompleted(idempotencyKey, retentionTtl)
```

Relevant symbols today:

| File                                                               | Symbol                     | Responsibility                                                  |
| ------------------------------------------------------------------ | -------------------------- | --------------------------------------------------------------- |
| `libs/contracts/src/idempotency/job-execution-store.ts`            | `IJobExecutionStore`       | Contract with `isCompleted()`, `markCompleted()`                |
| `libs/infrastructure/src/idempotency/redis-job-execution.store.ts` | `RedisJobExecutionStore`   | Redis adapter using `exists()` then `set()`                     |
| `apps/worker/src/processors/email.processor.ts`                    | `EmailProcessor.process()` | Only consumer of `IJobExecutionStore`                           |
| `libs/infrastructure/src/idempotency/idempotency.module.ts`        | `IdempotencyModule`        | Registers `TOKENS.JobExecutionStore` → `RedisJobExecutionStore` |
| `libs/contracts/src/tokens.ts`                                     | `TOKENS.JobExecutionStore` | DI token (unchanged)                                            |

`RedisJobExecutionStore` implementation:

- `isCompleted(key)` → `RedisService.exists('job-execution:${key}')`
- `markCompleted(key, ttlSeconds)` → `RedisService.set('job-execution:${key}', 'completed', ttlSeconds)`

`EmailProcessor` only applies idempotency when `payload.idempotencyKey` is present. Today that applies to `TemplatedEmailJob` (`libs/contracts/src/mail/email-job.ts`); `RawEmailJob` has no idempotency key.

Producer of idempotency keys:

- `libs/infrastructure/src/events/handlers/user-registered.handler.ts` → `UserRegisteredEventHandler.handle()` sets `idempotencyKey: \`user-registered:${event.id}:welcome\`` when enqueueing welcome email jobs.

Composition roots:

- `apps/worker/src/worker.module.ts` imports `IdempotencyModule` and registers `EmailProcessor`.
- `apps/api/src/api.module.ts` and `libs/infrastructure/src/infrastructure.module.ts` also import `IdempotencyModule`, but neither injects `TOKENS.JobExecutionStore`.

No unit or integration tests currently exist for this flow (`jest.unit.config.ts` matches `**/*.spec.ts`; repository has zero spec files).

## Confirmed root cause

`isCompleted()` and `markCompleted()` are separate, non-atomic Redis operations with the external side effect (`mail.send()`) between them.

Two worker processes can both observe `isCompleted() === false` and both send the email:

```text
Worker A -> isCompleted = false
Worker B -> isCompleted = false
Worker A -> send email
Worker B -> send email
Worker A -> markCompleted
Worker B -> markCompleted
```

**Issue status:** Still present on `main` (working tree clean at planning time). Grep confirms `isCompleted` / `markCompleted` only in the contract, Redis adapter, and `EmailProcessor`.

## Dependency/runtime flow

```text
Outbox / domain event handler
  -> IQueueGateway.add(QUEUES.EMAIL, payload with idempotencyKey)
    -> BullMQ EMAIL queue
      -> EmailProcessor.process()
        -> IJobExecutionStore (TOKENS.JobExecutionStore)
        -> IEmailGateway.send()
        -> MailTemplateService.render() (templated jobs only)
```

Redis primitives already available in `RedisService` (`libs/infrastructure/src/redis/redis.service.ts`):

- `setIfNotExists(key, value, ttlSeconds)` — `SET ... NX EX`
- `compareAndDelete(key, expectedValue)` — Lua compare-and-delete
- `compareAndExpire(key, expectedValue, ttlSeconds)` — Lua compare-and-expire

`RedisIdempotencyService` (`libs/infrastructure/src/idempotency/idempotency.service.ts`) already implements a similar lock/heartbeat/complete pattern for HTTP idempotency, but `IJobExecutionStore` is a separate, simpler contract used only by the email worker.

## Goal

Replace the non-atomic `isCompleted()` / `markCompleted()` contract with an atomic execution-claim model so that at most one worker can perform the email side effect for a given idempotency key at a time, while still allowing retry after failure and suppressing re-execution during the completed retention period.

## Scope

1. Breaking change to `IJobExecutionStore` contract (`acquire` / `complete` / `release`).
2. Atomic Redis implementation in `RedisJobExecutionStore`.
3. `EmailProcessor` flow update with acquire-before-send, complete-on-success, release-on-failure.
4. Failure-model documentation in `README.md` and `EXAMPLES.md` (per source issue item 9).
5. Targeted unit tests for the Redis adapter (and optionally `EmailProcessor` orchestration).

## Out of scope

- `IIdempotencyService` / HTTP `IdempotencyInterceptor` changes.
- `P2-03` full documentation alignment (`MODULES_OVERVIEW_NON_TECH.md`, broader Outbox idempotency narrative).
- PostgreSQL-backed job execution store.
- Changes to `UserRegisteredEventHandler` idempotency key format.
- Heartbeat-based lock extension (defer unless human approves; see open questions).
- `RawEmailJob` idempotency (not part of current defect; templated jobs are the demonstrated case).

## Files to create

| Path                                                                    | Purpose                                                                                                                             |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `libs/infrastructure/src/idempotency/redis-job-execution.store.spec.ts` | Unit tests for `RedisJobExecutionStore.acquire()`, `complete()`, `release()` including concurrent-acquire and wrong-token scenarios |

Optional (recommended if time permits):

| Path                                                 | Purpose                                                                                                     |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `apps/worker/src/processors/email.processor.spec.ts` | Unit test verifying `EmailProcessor.process()` calls acquire → send → complete and releases on send failure |

## Files to modify

| Path                                                               | Symbol / area                                                                 | Change                                                                                                       |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `libs/contracts/src/idempotency/job-execution-store.ts`            | `IJobExecutionStore`                                                          | Replace `isCompleted()` / `markCompleted()` with `acquire()`, `complete()`, `release()` per backlog contract |
| `libs/infrastructure/src/idempotency/redis-job-execution.store.ts` | `RedisJobExecutionStore`                                                      | Implement atomic claim via `SET NX EX`; ownership-safe `complete()` and `release()` via Lua                  |
| `apps/worker/src/processors/email.processor.ts`                    | `EmailProcessor.process()`                                                    | Acquire before side effect; complete after success; release in error path when still owner                   |
| `README.md`                                                        | Section `5.17. Idempotency Module` and/or email worker idempotency subsection | Document job-execution claim model, Redis key shape, TTL semantics, crash/retry behavior                     |
| `EXAMPLES.md`                                                      | Email / idempotency example section                                           | Document expected `idempotencyKey` usage and worker claim flow for templated email jobs                      |

## Files to delete

None.

## Contract and DI changes

### `IJobExecutionStore` (breaking, internal to this repo)

Replace:

```ts
isCompleted(key: string): Promise<boolean>;
markCompleted(key: string, ttlSeconds: number): Promise<void>;
```

With:

```ts
acquire(key: string, ttlSeconds: number): Promise<string | null>;
complete(key: string, ownershipToken: string, ttlSeconds: number): Promise<boolean>;
release(key: string, ownershipToken: string): Promise<void>;
```

Semantics:

| Method     | Success                                                                                                               | Failure / no-op                                                 |
| ---------- | --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `acquire`  | Returns ownership token (UUID) when `SET job-execution:{key} {token} NX EX {ttl}` succeeds                            | Returns `null` when key already exists (completed or in-flight) |
| `complete` | Atomically sets value to `completed` with retention TTL only if current value equals `ownershipToken`; returns `true` | Returns `false` if token mismatch or key missing                |
| `release`  | Deletes key only if current value equals `ownershipToken` (idempotent no-op otherwise)                                | Must not delete another worker's claim                          |

Redis key prefix remains `job-execution:{key}` (backward compatible key namespace; value format changes from only `completed` to `{uuid}` during execution).

### DI

- `TOKENS.JobExecutionStore` — no change.
- `IdempotencyModule` — no provider registration change (`useClass: RedisJobExecutionStore`).
- No new tokens or modules required.

### Implementation notes for `RedisJobExecutionStore`

- `acquire`: generate token with `randomUUID()`; use `RedisService.setIfNotExists`.
- `release`: reuse `RedisService.compareAndDelete`.
- `complete`: add a small Lua script (either inline via `RedisService.eval` or as a new `RedisService.compareAndSetCompleted` helper). Suggested script:

```lua
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("set", KEYS[1], "completed", "EX", ARGV[2])
end
return nil
```

Return `true` when SET succeeds.

Prefer extending `RedisService` only if the Lua script is reusable; otherwise keep script local to `RedisJobExecutionStore` to minimize scope.

### `EmailProcessor.process()` target flow

```text
if no idempotencyKey -> send without claim (unchanged for RawEmailJob)

token = acquire(idempotencyKey, executionTtlSeconds)
if token is null -> return (already completed or another worker owns execution)

try:
  render template (if applicable)
  mail.send(...)
  complete(idempotencyKey, token, completedRetentionTtlSeconds)
catch:
  release(idempotencyKey, token)
  rethrow
```

Constants (proposed defaults pending human approval):

- `completedRetentionTtlSeconds`: keep current `30 * 24 * 60 * 60` (30 days).
- `executionTtlSeconds`: `300` (5 minutes) — covers typical email render + SMTP latency without heartbeat.

## Implementation steps

1. **Update contract** — `libs/contracts/src/idempotency/job-execution-store.ts`: define `acquire`, `complete`, `release`; remove `isCompleted`, `markCompleted`.
2. **Rewrite Redis adapter** — `libs/infrastructure/src/idempotency/redis-job-execution.store.ts`:
   - `acquire()` using `setIfNotExists` + `randomUUID()`.
   - `release()` using `compareAndDelete`.
   - `complete()` using ownership-check Lua → set `completed` with retention TTL.
3. **Update email processor** — `apps/worker/src/processors/email.processor.ts`:
   - Replace early `isCompleted` guard with `acquire`.
   - Wrap send path in `try/catch/finally` semantics: `complete` on success, `release` on error before rethrow.
   - Extract TTL constants (private `readonly` or module-level) for execution vs retention.
4. **Add unit tests** — `redis-job-execution.store.spec.ts`:
   - Mock `RedisService` or use ioredis mock.
   - Cases: acquire success; acquire returns null when key exists; complete with valid token; complete rejects wrong token; release only when owner; concurrent acquire (only one token).
5. **Document failure model** — `README.md` + `EXAMPLES.md`:
   - Redis key `job-execution:{idempotencyKey}`.
   - States: absent → in-flight (token) → completed.
   - Concurrent workers: second acquire returns null, no duplicate send.
   - Failure before complete: release allows BullMQ retry.
   - Crash after send but before complete: execution TTL expiry allows retry (at-least-once; possible duplicate if SMTP succeeded but complete failed — document explicitly).
   - Completed retention prevents re-execution for configured period.
6. **Verify consumers** — grep confirms only `EmailProcessor` uses `IJobExecutionStore`; no further call-site updates.

## Migration and rollout concerns

- **Breaking contract change** within the monorepo only; no external consumers.
- **Redis key compatibility**: existing `completed` keys continue to block `acquire` (NX fails) — correct behavior. In-flight keys from old code are unlikely; if any exist with value `completed`, behavior is unchanged.
- **Deploy order**: deploy worker + infrastructure together; API does not call `IJobExecutionStore` directly.
- **No database migration**.
- **No env var changes** required for minimal fix (TTL constants in code).

## Targeted verification

| Command                                                  | Expected result                |
| -------------------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| `rg "isCompleted                                         | markCompleted" --glob "\*.ts"` | No matches outside git history / docs after implementation                                                                                                                     |
| `rg "acquire                                             | complete                       | release" libs/contracts/src/idempotency/job-execution-store.ts libs/infrastructure/src/idempotency/redis-job-execution.store.ts apps/worker/src/processors/email.processor.ts` | All three methods present in contract, adapter, processor |
| `npm run test:unit -- redis-job-execution.store.spec.ts` | New unit tests pass            |
| `npm run build:worker`                                   | Worker entrypoint compiles     |

## Full verification

| Command                | Expected result                                                         |
| ---------------------- | ----------------------------------------------------------------------- |
| `npm run build`        | Full monorepo build passes (contracts + infrastructure + worker shared) |
| `npm run lint`         | No new lint errors                                                      |
| `npm run test:unit`    | All unit tests pass                                                     |
| `npm run start:worker` | Worker bootstraps when Redis and other infra are available              |

Runtime concurrency check (manual or scripted, requires Redis + worker):

1. Enqueue two `QUEUES.EMAIL` jobs with the same `idempotencyKey` concurrently (or run two worker replicas).
2. Confirm exactly one SMTP send occurs (mock/spy `IEmailGateway` or mail sink).
3. Confirm Redis key ends as `completed` with expected TTL.

## Acceptance criteria

Mapped to source issue:

- [ ] Two parallel workers cannot both execute the email side effect for the same `idempotencyKey`.
- [ ] A worker without the current ownership token cannot `complete()` or `release()` another worker's claim.
- [ ] Retry after failure is possible (`release` on error; subsequent `acquire` succeeds).
- [ ] A completed execution is not re-run during the configured retention period (`complete` sets long TTL; `acquire` returns null).
- [ ] Failure model documented in `README.md` and `EXAMPLES.md`.

## Risks

| Risk                                                          | Mitigation                                                                                                                                                                    |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Worker crash after SMTP success but before `complete()`       | Document as at-least-once; retention TTL on in-flight claim eventually expires allowing retry (possible duplicate). Accept for starter kit or add durable outbox dedup later. |
| `executionTtlSeconds` too short for slow SMTP/template render | Choose conservative default (300s); document tuning; defer heartbeat unless required.                                                                                         |
| `complete()` returns `false` after successful send            | Log/monitor; side effect already happened; key may expire and allow duplicate on retry — document in failure model.                                                           |
| No existing tests                                             | Add `redis-job-execution.store.spec.ts` as part of this fix.                                                                                                                  |
| Breaking `IJobExecutionStore`                                 | Safe: only `EmailProcessor` + `RedisJobExecutionStore` implement/consume it.                                                                                                  |

## Rollback strategy

1. Revert the commit(s) touching the five modified files (and delete new spec file).
2. Redeploy worker. Redis keys in `job-execution:*` namespace are harmless; old code resumes `exists` + `set` behavior.
3. No schema or env rollback needed.

## Open questions requiring human decision

1. **Execution TTL without heartbeat** — Is `300` seconds acceptable for `acquire` TTL, or should `EmailProcessor` adopt a heartbeat pattern mirroring `RedisIdempotencyService` (10s interval, 30s extension)?
2. **`RedisService` helper** — Add `compareAndSet(key, expectedValue, newValue, ttlSeconds)` to `redis.service.ts` vs keep Lua only inside `RedisJobExecutionStore`?
3. **Unit test depth** — Is `redis-job-execution.store.spec.ts` sufficient, or is `email.processor.spec.ts` required for acceptance?
4. **Documentation depth** — P0-01 requires `README.md` + `EXAMPLES.md` failure model only; confirm `MODULES_OVERVIEW_NON_TECH.md` stays out of scope (deferred to `P2-03`).
5. **`complete()` failure handling** — Should `EmailProcessor` log when `complete()` returns `false` after a successful send, or throw to surface BullMQ retry?
