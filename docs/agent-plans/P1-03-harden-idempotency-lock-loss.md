---
issue_id: P1-03
status: proposed
owner: human-approval-required
---

# P1-03 — Harden idempotency so side effects are not re-run after lock loss

## Source issue

- Backlog ID: `P1-03`
- Index: `docs/agent-backlog/INDEX.md` — High / Confirmed defect
- Full section: `docs/agent-backlog/NESTJS_STARTER_KIT_REQUIRED_FIXES.md` — “P1-03. Harden idempotency so side effects are not re-run after lock loss”
- Review evidence: `docs/agent-reports/full-review-2026-07-28.md`
- Branch at planning time: `main` (unrelated staged docs for TASK-001/TASK-002 and backlog; no production code changes for this issue yet)

## Current behavior

`RedisIdempotencyService.execute` (`libs/infrastructure/src/idempotency/idempotency.service.ts`):

1. Reads `idem:<scope>:<key>:result`; on hit, returns stored response (hash mismatch → `IDEMPOTENCY_KEY_REUSED`).
2. Acquires `idem:<scope>:<key>:lock` via `SET NX EX 30` with a UUID token; starts a 10s heartbeat that extends TTL only while the token still owns the lock.
3. Double-checks the result key, then runs `handler()` **before** any durable result write.
4. If `lockLost` is true after the handler returns, or `RedisService.completeIdempotency` returns `false`, throws `ConflictError('IDEMPOTENCY_LOCK_LOST', …)` **without** storing the handler outcome.
5. `finally` clears the heartbeat and, when `lockCompleted` is false, calls `compareAndDelete` on the lock (no-op if ownership already lost).

`IdempotencyInterceptor` wraps `@Idempotent()` HTTP handlers with this `execute` path. Redis errors on get/set/eval continue to reject (fail-closed). There are **no** unit tests for `RedisIdempotencyService`. `EXAMPLES.md` §7 describes happy-path replay but does **not** document lock-loss / unknown-outcome retry semantics.

## Confirmed root cause

The side-effecting `handler()` can complete successfully while the outcome is never written to the result key. After lock expiry/loss, a client retry with the same key+hash acquires a fresh lock and re-enters the handler. The only Redis keys today are `:lock` and `:result`; nothing durable marks “execution already ran / outcome unknown,” so lock loss after success is indistinguishable from “never started.”

Root cause **still present** in current `main` (verified by reading `RedisIdempotencyService.execute` and `RedisService.completeIdempotency`).

## Dependency/runtime flow

```text
HTTP @Idempotent() endpoint
  -> IdempotencyInterceptor (Idempotency-Key, scope, requestHash, ttlSeconds=86400)
    -> TOKENS.IdempotencyService (RedisIdempotencyService)
      -> RedisService.get / setIfNotExists / compareAndExpire / completeIdempotency / compareAndDelete
        -> Redis keys: idem:<scope>:<key>:lock | :result
  -> ConflictError -> GlobalExceptionFilter -> HTTP 409
```

Composition: `IdempotencyModule.register` in `apps/api/src/api.module.ts` (and Worker for `JobExecutionStore` only — **out of scope** for this HTTP/API idempotency path).

Contract: `IIdempotencyService` in `libs/contracts/src/idempotency/idempotency-service.ts` — single `execute` method; no DI token change required for the recommended fix.

## Goal

Close the “successful side effect without durable idempotency outcome” window as far as Redis semantics allow:

1. Prevent a second `handler()` execution for the same key after a prior successful handler when the result was not stored, unless the client is given an explicit conflict/unknown outcome.
2. Preserve happy-path replay (stored result, no re-run).
3. Document accurate client retry semantics.
4. Keep Redis failures fail-closed (never silent fail-open).

## Scope

- Harden `RedisIdempotencyService.execute` completion / lock-loss path.
- Add Redis Lua/helpers needed for atomic reserve (fence) + best-effort result persistence.
- Add unit tests for lock-loss-after-success, happy-path complete/replay, and unchanged hash-collision behavior.
- Update `EXAMPLES.md` (and briefly align `README.md` §5.17 key layout / retry notes) with the retry contract.
- Extend redis key-builder example table with the new fence key pattern if added.

## Out of scope

- `IJobExecutionStore` / `RedisJobExecutionStore` / `EmailProcessor` (separate worker claim path; already has `sent-ambiguous`).
- PostgreSQL durable idempotency implementation.
- Changing `IdempotencyInterceptor` scope/hash/TTL policy or `@Idempotent()` placement on auth routes.
- P1-04 JWT refresh-family revoke and any other backlog issues.
- Weakening fail-closed Redis error behavior into silent fail-open.
- Making financial exactly-once guarantees beyond Redis best-effort + fence semantics.

## Files to create

| Path                                                              | Symbol / responsibility                                                                                                                                                                                                                                   |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `libs/infrastructure/src/idempotency/idempotency.service.spec.ts` | Unit tests for `RedisIdempotencyService.execute`: happy-path complete + replay; lock lost after handler success (no second handler); `completeIdempotency` false after success; hash collision `IDEMPOTENCY_KEY_REUSED`; Redis error remains fail-closed. |

## Files to modify

| Path                                                         | Symbol / responsibility                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `libs/infrastructure/src/idempotency/idempotency.service.ts` | `RedisIdempotencyService.execute` (+ private helpers): introduce fence/reserve key; after successful handler attempt owned `completeIdempotency`, then best-effort persist if ownership lost; refuse re-execution when fence present without result; emit documented conflict/unknown outcome instead of allowing silent re-entry; only clear fence on pre-success failure paths. |
| `libs/infrastructure/src/redis/redis.service.ts`             | Add focused helpers (names may vary): atomic lock+fence acquire; best-effort `SET` result when lock ownership is gone (e.g. NX + read-back); optional fence delete with ownership; keep existing `completeIdempotency` for happy path.                                                                                                                                            |
| `EXAMPLES.md`                                                | §7 Idempotency: document when clients may safely retry, when to treat outcome as unknown / not re-issue as a new execution, and the relevant error codes.                                                                                                                                                                                                                         |
| `README.md`                                                  | §5.17: document third key `idem:<scope>:<key>:fence` (or chosen name) and short retry/unknown-outcome note so module docs match runtime.                                                                                                                                                                                                                                          |
| `libs/infrastructure/src/redis/redis-key-builder.spec.ts`    | Add example row for the fence logical key prefix (prefixing behavior only; no algorithm change).                                                                                                                                                                                                                                                                                  |

## Files to delete

None.

## Contract and DI changes

| Item                                                                            | Change                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `IIdempotencyService` (`libs/contracts/src/idempotency/idempotency-service.ts`) | **No required signature change.** Keep `execute({ key, scope, requestHash, ttlSeconds, handler })`. Optional later: surface `lockTtlSeconds` (already mentioned in `README.md` but absent from the interface) — **not required** for AC; only add if implementer needs configurable lock TTL without hardcoding (see open questions).                                                                                                          |
| `TOKENS.IdempotencyService`                                                     | Unchanged; still `useExisting: RedisIdempotencyService`.                                                                                                                                                                                                                                                                                                                                                                                       |
| `IdempotencyModule`                                                             | No provider/export changes expected.                                                                                                                                                                                                                                                                                                                                                                                                           |
| Public HTTP error codes                                                         | Prefer introducing `IDEMPOTENCY_OUTCOME_UNKNOWN` (still `ConflictError` → 409) for post-success unconfirmed persistence and for retries that hit a fence without a result. Keep `IDEMPOTENCY_KEY_REUSED`, `IDEMPOTENCY_REQUEST_IN_PROGRESS`, and key-validation codes unchanged. Replace post-success use of `IDEMPOTENCY_LOCK_LOST` with the unknown-outcome code (or document why `IDEMPOTENCY_LOCK_LOST` is retained — see open questions). |

## Implementation steps

1. **Reserve/fence semantics (primary AC-01 control)**
   - On successful lock acquisition (before `handler`), set durable fence key `idem:<scope>:<key>:fence` with value including `requestHash` (and optionally lock token), TTL = result `ttlSeconds` (recommended default). Prefer a single Lua/eval so lock+fence are not torn.
   - On **handler failure** (exception before successful return): delete lock (token-safe) **and** fence so a deliberate retry can re-run.
   - On **handler success**: do not clear fence until result is stored (or leave fence until TTL; result presence remains the happy-path source of truth).

2. **Post-success completion path**
   - After `handler()` resolves: if ownership still held, call existing `completeIdempotency` (SET result + DEL lock). On success, clear fence (or rely on result+TTL) and return result.
   - If `lockLost` or `completeIdempotency` returns false: **best-effort** persist result without requiring lock ownership (Lua: if result missing, SET with EX; if present, return existing payload for hash compare).
     - Persist OK / existing same hash → return stored/handler result (no throw).
     - Existing different hash → `IDEMPOTENCY_KEY_REUSED`.
     - Persist cannot be confirmed (Redis error or unexpected state) → throw `IDEMPOTENCY_OUTCOME_UNKNOWN`; **leave fence in place**.

3. **Re-entry / wait path**
   - Before running `handler` on a new attempt: if result exists → replay; if fence exists without result → do **not** run handler; throw `IDEMPOTENCY_OUTCOME_UNKNOWN` (or wait briefly for result then unknown — prefer documented conflict over re-execution).
   - Concurrent waiters (`waitForResult`): if lock disappears and fence remains without result until timeout → same unknown/conflict outcome, not a new execution.

4. **TTL / heartbeat hygiene (secondary mitigation)**
   - Keep heartbeat; ensure lock TTL and heartbeat interval remain consistent (today: 30s TTL / 10s interval). Optionally increase default lock TTL or make it a named constant shared by acquire/heartbeat so long handlers are less likely to lose the lock; do not treat longer TTL as sufficient alone.

5. **Fail-closed**
   - Do not catch Redis transport/eval errors and proceed into `handler`. Propagate errors as today.

6. **Documentation**
   - Update `EXAMPLES.md` §7 with an explicit client contract table/list: safe retry after network timeout only if treating as unknown until a successful replay returns stored body; never assume “409 lock lost” means “safe to treat as never executed”; map codes to actions.
   - Align `README.md` §5.17 key list and short semantics note.

7. **Tests**
   - Mock `RedisService` methods; assert handler call counts and thrown codes for: happy complete + second call replay; simulated lock-lost after success with best-effort store; simulated lock-lost after success with store failure → fence blocks second handler; hash mismatch unchanged.

## Migration and rollout concerns

- **No DB migrations.** Redis key space gains `:fence` keys with TTL = result TTL; old deployments without fence remain vulnerable until code rolls out (acceptable for a starter hardening fix).
- **Behavior change for clients:** post-success lock-loss may return `IDEMPOTENCY_OUTCOME_UNKNOWN` instead of `IDEMPOTENCY_LOCK_LOST`, and retries that previously re-executed may now get 409 until fence/result TTL. Document as intentional.
- **No `package-lock.json` or env schema changes** expected unless optional `lockTtlSeconds` wiring is approved.
- Worker / Cron entrypoints unaffected for this HTTP idempotency path.

## Targeted verification

| Command                                                                                                 | Purpose                                                          |
| ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `npx jest --config jest.unit.config.ts libs/infrastructure/src/idempotency/idempotency.service.spec.ts` | New unit coverage for lock-loss / replay / hash collision.       |
| `npx jest --config jest.unit.config.ts libs/infrastructure/src/redis/redis-key-builder.spec.ts`         | Fence key prefix example still valid.                            |
| `npm run build` or at least `npm run build:api`                                                         | Shared infra + API compile after Redis helper / service changes. |
| `npm run lint`                                                                                          | Lint changed TS files.                                           |

## Full verification

| Command             | Purpose                                            |
| ------------------- | -------------------------------------------------- |
| `npm run build`     | Full workspace compile (shared Redis/idempotency). |
| `npm run lint`      | Lint gate.                                         |
| `npm run test:unit` | Fast unit gate including new idempotency specs.    |
| `npm run test:all`  | unit + module + release before merge.              |

Bootstrap of API is optional for this change (logic is unit-testable with mocked Redis); if performed, treat missing Redis as infrastructure unavailability, not a code defect.

## Acceptance criteria

- **AC-01:** A simulated lock-loss after a successful handler does not allow a second handler execution for the same key+hash without an explicit, documented conflict/unknown outcome.
- **AC-02:** Happy-path idempotent replay returns the stored result without re-running the handler.
- **AC-03:** Unit tests cover lock-loss-after-success and happy-path replay.
- **AC-04:** `EXAMPLES.md` (or equivalent) states the retry contract accurately.

## Risks

- Residual Redis window: crash between successful external side effect and any Redis write can still leave fence unset if fence is written only after handler (mitigate by setting fence **before** handler).
- Fence TTL expiry after unknown outcome can eventually allow re-execution; document that Redis idempotency is not a substitute for business-level exactly-once for financial ops (already noted in README).
- Best-effort result write without lock ownership could race with a theoretical second writer if fence acquisition is buggy — atomic lock+fence acquire is mandatory.
- Clients currently treating `IDEMPOTENCY_LOCK_LOST` as “retry freely” will need to follow the new documented contract.

## Rollback strategy

- Revert the commit(s) touching `idempotency.service.ts`, `redis.service.ts`, docs, and the new spec.
- Orphan `:fence` keys expire via TTL; no migration rollback required.
- No schema or lockfile rollback expected.

## Open questions requiring human decision

1. **Error code naming:** Introduce `IDEMPOTENCY_OUTCOME_UNKNOWN` for post-success unconfirmed persistence and fence-without-result retries, or keep/reuse `IDEMPOTENCY_LOCK_LOST` with updated documentation only? **Recommendation:** introduce `IDEMPOTENCY_OUTCOME_UNKNOWN` and stop using `IDEMPOTENCY_LOCK_LOST` for the post-success path so clients can distinguish “in progress / lock churn” messaging from “do not treat as never executed.”
2. **HTTP status for unknown outcome:** Keep `ConflictError` → 409, or map unknown outcome to `ServiceUnavailableError` → 503? **Recommendation:** keep 409 for consistency with existing idempotency conflicts unless product owners prefer 503 for “retry later with same key after backoff.”
3. **Optional contract field `lockTtlSeconds`:** README already documents it but the TypeScript port does not. Include aligning the port + interceptor in this fix, or leave as docs-only drift for a later task? **Recommendation:** out of scope unless needed for testing longer handlers; use internal constants in this fix.
4. **Fence value format:** store only `requestHash`, or `requestHash` + lock token JSON? **Recommendation:** at least `requestHash` so a fence from a different payload can surface `IDEMPOTENCY_KEY_REUSED` instead of opaque unknown.
