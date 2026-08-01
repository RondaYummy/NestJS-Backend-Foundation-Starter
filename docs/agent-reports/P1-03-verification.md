# P1-03 — Independent verification

## Verdict

approved

## Scope checked

- **Issue:** P1-03 — Harden idempotency so side effects are not re-run after lock loss (`docs/agent-backlog/INDEX.md`, `NESTJS_STARTER_KIT_REQUIRED_FIXES.md`).
- **Plan:** `docs/agent-plans/P1-03-harden-idempotency-lock-loss.md` — frontmatter `status: approved`.
- **Staged diff (actual git):** matches the approved plan file set:
  - `libs/infrastructure/src/idempotency/idempotency.service.ts` (+ new `idempotency.service.spec.ts`)
  - `libs/infrastructure/src/redis/redis.service.ts` (+ `redis.service.spec.ts`, `redis-key-builder.spec.ts`)
  - `EXAMPLES.md`, `README.md`
  - docs only: plan + `docs/agent-reports/P1-03-implementation.md`
- **Out of scope preserved:** no `IJobExecutionStore` / worker claim changes; no `IIdempotencyService` signature change; no `IdempotencyModule` / DI token changes; no `package-lock.json`; no P1-04 or other backlog code.
- **Open questions:** resolved per plan recommendations (`IDEMPOTENCY_OUTCOME_UNKNOWN` + 409; fence value = `requestHash`; `lockTtlSeconds` port alignment left out of scope).

## Root-cause assessment

**Root cause (confirmed in issue/plan):** after successful `handler()`, lock loss / failed `completeIdempotency` threw without storing a result, cleared the lock, and left no durable “execution ran / outcome unknown” marker — so a retry could re-enter `handler()`.

**Fix addresses root cause (not only symptoms):**

1. **Fence before handler:** `acquireIdempotencyLockWithFence` atomically `SET NX` lock + `SET` fence (`requestHash`, TTL = result TTL) before `handler()`.
2. **Post-success path:** owned `completeIdempotency(..., fenceKey)` stores result and deletes lock+fence; on ownership loss, `persistIdempotencyResultBestEffort` best-effort stores result (and clears fence on write); on persist failure → `IDEMPOTENCY_OUTCOME_UNKNOWN` with fence retained.
3. **Re-entry blocked:** `assertFenceAllowsExecution` refuses a second `handler` when fence exists without result (`IDEMPOTENCY_OUTCOME_UNKNOWN` / hash mismatch → `IDEMPOTENCY_KEY_REUSED`).
4. **Wait path:** concurrent waiters that see lock gone + fence without result until timeout get `IDEMPOTENCY_OUTCOME_UNKNOWN`, not a bare in-progress code that invites blind re-execution.
5. **Handler failure:** lock + fence cleared so deliberate retry can re-run.
6. **Fail-closed:** Redis get/acquire errors still propagate before `handler` (covered by unit test).

`IDEMPOTENCY_LOCK_LOST` is no longer emitted from infrastructure code (grep clean under `libs/`).

## Acceptance criteria matrix

| Criterion | Result | Evidence |
| --- | --- | --- |
| **AC-01** Simulated lock-loss after successful handler does not allow a second handler execution for same key+hash without explicit conflict/unknown outcome | **passed** | Code: fence retained on persist failure; `assertFenceAllowsExecution` blocks re-entry. Unit: `best-effort persists after lock loss and blocks a second handler when store fails` — second `execute` does not call `handler`, throws `IDEMPOTENCY_OUTCOME_UNKNOWN`. |
| **AC-02** Happy-path idempotent replay returns stored result without re-running handler | **passed** | Unit: `stores result on happy path and replays without re-running handler` — `handler` call count = 1; `completeIdempotency` invoked with fence key. |
| **AC-03** Unit tests cover lock-loss-after-success and happy-path replay | **passed** | `idempotency.service.spec.ts` covers both (+ hash reuse, fail-closed, fence clear on handler failure, best-effort success). Redis helper specs cover lock+fence acquire, best-effort persist, complete-with-fence. Targeted Jest: 3 suites / 33 tests passed. |
| **AC-04** `EXAMPLES.md` (or equivalent) states retry contract accurately | **passed** | `EXAMPLES.md` §7 “Client retry contract” table documents `IDEMPOTENCY_OUTCOME_UNKNOWN` and safe/unsafe client actions; `README.md` §5.17 documents `:fence` and unknown-outcome semantics. |

## Dependency and DI verification

```text
HTTP @Idempotent()
  -> IdempotencyInterceptor
    -> TOKENS.IdempotencyService (useExisting: RedisIdempotencyService)
      -> RedisService.acquireIdempotencyLockWithFence / completeIdempotency(fence?) /
         persistIdempotencyResultBestEffort / deleteIdempotencyFence / …
  -> ConflictError -> GlobalExceptionFilter -> HTTP 409
```

- `IdempotencyModule.register` providers/exports unchanged (`apps/api` and `apps/worker` composition untouched for this fix).
- `IIdempotencyService.execute` signature unchanged.
- `completeIdempotency` optional `fenceKey` is backward-compatible; only `RedisIdempotencyService` passes it.
- New error code still uses `ConflictError` → `HttpStatus.CONFLICT` (409) in `global-exception.filter.ts`.

## Commands executed

| Command | Result | Conclusion |
| --- | --- | --- |
| `npx jest --config jest.unit.config.ts libs/infrastructure/src/idempotency/idempotency.service.spec.ts libs/infrastructure/src/redis/redis.service.spec.ts libs/infrastructure/src/redis/redis-key-builder.spec.ts` | **pass** — 3 suites, 33 tests | Targeted AC-01/02/03 coverage green |
| `npm run build` | **fail** — `Access is denied.` (npm/nest wrapper) | Host wrapper issue; not treated as P1-03 code defect |
| `npm run build:api` / `build:worker` / `build:cron` / `build:migrations` | **pass** (each exit 0) | Full workspace compile verified via entrypoint builds |
| `npm run lint` | **fail** — `Access is denied.` (npm eslint wrapper) | Host wrapper issue |
| `node node_modules/eslint/bin/eslint.js . --max-warnings=0` | **pass** | Lint gate satisfied via direct eslint |
| `npm run test:unit` | **pass** — 40 suites, 248 tests | Unit gate including new specs |
| `npm run test:release` | **pass** — 1 suite, 12 tests | Release policy unaffected |
| `npm run test:all` | **fail** — after unit pass, `apps/cron/src/cron.module.spec.ts`: `ioredis_1.default is not a constructor` (BullMQ) | Pre-existing / unrelated to P1-03 (no cron/BullMQ changes in diff) |

API bootstrap against live Redis was not required (plan: unit-testable with mocks).

## Findings

1. **No AC failures.** Fence/reserve + best-effort persist + fence-without-result refusal close the original re-execution window for the documented failure modes.
2. **Non-blocking gaps (do not fail ACs):**
   - No dedicated unit test for `waitForResult` fence-timeout → `IDEMPOTENCY_OUTCOME_UNKNOWN` (implementation present; AC-03 minimum is lock-loss + happy replay).
   - If best-effort persist finds an **existing** result, Lua returns it without `DEL` fence → orphan fence until TTL; result-first read still makes replay correct.
3. **`npm run test:module` / `test:all` failure** is CronModule/BullMQ ioredis mock noise, unrelated to this diff — do not treat as a P1-03 regression.

## Documentation alignment

- `EXAMPLES.md` §7 retry contract matches runtime codes and “do not treat as never executed” guidance.
- `README.md` §5.17 documents three-key layout including `:fence`.
- Pre-existing README `lockTtlSeconds?` on the TypeScript port remains (explicitly out of scope in the approved plan); not an AC-04 failure.

## Remaining risks

- Residual crash after side effects but before any Redis write completing fence/result still possible in extreme kill windows; fence-before-handler minimizes the worse “silent re-run” case.
- Fence TTL expiry can eventually allow re-execution; Redis idempotency remains best-effort, not financial exactly-once (documented).
- Clients that previously treated lock-loss as “safe to treat as never executed” must follow `IDEMPOTENCY_OUTCOME_UNKNOWN`.
- Merge gate `test:all` is red on this host due to unrelated Cron module spec.

## Unverified areas

- Live Redis / API HTTP E2E for real lock TTL expiry under load.
- Explicit HTTP response-body assertion for `IDEMPOTENCY_OUTCOME_UNKNOWN` (relies on existing `ConflictError` → 409 filter; not re-tested via HTTP).
- Dedicated automated coverage of the concurrent waiter fence-timeout branch.
