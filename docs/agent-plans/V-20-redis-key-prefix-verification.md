---
issue_id: V-20
status: approved
owner: human-approval-required
---

# V-20 — Redis keys use configured global namespace/key prefix

## Source issue

`docs/agent-backlog/NESTJS_STARTER_KIT_REQUIRED_FIXES.md` — verification backlog row **V-20**:

> Redis keys use configured global namespace/key prefix

**Linked defect:** **P2-14** (`docs/agent-backlog/NESTJS_STARTER_KIT_REQUIRED_FIXES.md` — section P2-14; implementation plan `docs/agent-plans/P2-14-centralized-redis-key-prefix.md`).

**Investigation (2026-06-22, branch `main`):** verification scenario is **not stale**. The underlying architectural defect from P2-14 is still present in production code. V-20 cannot return `approved` until P2-14 is implemented and independently verified.

## Current behavior

1. **`RedisModuleOptions`** (`libs/infrastructure/src/redis/redis.module-options.ts`) exposes only connection fields (`host`, `port`, `password`, `db`, `connectTimeoutMs`). No `keyPrefix`, `namespace`, or equivalent.

2. **`RedisModule`** (`libs/infrastructure/src/redis/redis.module.ts`) creates a raw `ioredis` client without namespace configuration and exports `REDIS_CLIENT` + `RedisService`. No `RedisKeyBuilder` provider exists.

3. **`RedisService`** (`libs/infrastructure/src/redis/redis.service.ts`) forwards caller-supplied keys unchanged to `ioredis` for every method (`get`, `set`, `del`, `scanKeys`, `eval`, `incrementWithTtl`, `completeIdempotency`, etc.).

4. **Feature adapters build local prefixes independently:**

   | Adapter             | File                                                                                   | Local key pattern (today)                                                   |
   | ------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
   | Cache               | `libs/infrastructure/src/cache/redis-cache.gateway.ts`                                 | `app:${key}` (hardcoded `private readonly prefix = 'app:'`)                 |
   | Distributed lock    | `libs/infrastructure/src/locks/redis-distributed-lock.ts`                              | `lock:${key}` via **`REDIS_CLIENT`** (bypasses `RedisService`)              |
   | JWT token store     | `libs/infrastructure/src/auth/redis-jwt-token-store.service.ts`                        | `auth:refresh-token:`, `auth:refresh-family:`, `auth:revoked-access-token:` |
   | Session store       | `libs/infrastructure/src/auth/redis-session-store.service.ts`                          | `sessions:${sessionId}`                                                     |
   | HTTP idempotency    | `libs/infrastructure/src/idempotency/idempotency.service.ts`                           | `idem:${scope}:${key}:lock` / `:result`                                     |
   | Job execution lease | `libs/infrastructure/src/idempotency/redis-job-execution.store.ts`                     | `job-execution:${key}`                                                      |
   | Rate limiter        | `libs/infrastructure/src/rate-limiter/rate-limiter.guard.ts` → `redis-rate-limiter.ts` | `${keyPrefix}:${req.ip}` (e.g. `auth:login:127.0.0.1`)                      |

5. **Environment/config** — `.env.example`, `env.schema.ts`, `infrastructure-config.module.ts`, `app-config.service.ts`, and `mapAppConfigToRedisOptions` expose Redis connection settings only; no `REDIS_KEY_PREFIX` or `keyPrefix`.

6. **Composition roots** (`apps/api/src/api.module.ts`, `apps/worker/src/worker.module.ts`, `apps/cron/src/cron.module.ts`, `libs/infrastructure/src/infrastructure.module.ts`) wire `RedisModule.forRootAsync({ useFactory: mapAppConfigToRedisOptions })` with connection options only.

7. **JWT family revocation Lua** (`redis-jwt-token-store.service.ts`, `revokeRefreshTokenFamily`) concatenates keys inside the script (`ARGV[1] .. currentTokenId`), which would bypass any future ioredis-native `keyPrefix` — P2-14 must centralize prefixing in `RedisService.eval` and/or refactor this script.

8. **Documentation** (README §5.4, auth Redis key sections) lists key shapes as fixed literals with no multi-project / shared-Redis namespace guidance.

## Confirmed root cause

Same as P2-14: Redis key namespaces are adapter-local implementation details instead of a portable module contract on `RedisModule`. There is no single builder or normalization layer, and `RedisDistributedLock` bypasses `RedisService` by injecting `REDIS_CLIENT` directly. Changing project/environment isolation requires editing multiple infrastructure adapters rather than composition-root configuration.

## Dependency/runtime flow

### Current (broken — V-20 would fail today)

```text
Composition root
  -> RedisModule.forRootAsync({ host, port, db, ... })   // no keyPrefix
       -> REDIS_CLIENT (raw ioredis)
       -> RedisService (pass-through keys)

Feature adapters (each adds its own prefix locally)
  -> RedisCacheGateway           -> app:${key}
  -> RedisDistributedLock        -> lock:${key}          (direct REDIS_CLIENT ❌)
  -> RedisJwtTokenStore          -> auth:…
  -> RedisSessionStore           -> sessions:…
  -> RedisIdempotencyService     -> idem:…
  -> RedisJobExecutionStore     -> job-execution:…
  -> RateLimiterGuard            -> auth:login:${ip} / rate:…
       -> RedisRateLimiter       -> incrementWithTtl(raw key)
```

### Expected after P2-14 (V-20 pass condition)

```text
Composition root
  -> RedisModule.forRootAsync({ …, keyPrefix: config.redis().keyPrefix })
       -> RedisKeyBuilder(keyPrefix)          // single namespace builder
       -> RedisService(builder + client)     // prefixes all logical keys
       -> REDIS_CLIENT (connection only; no ioredis keyPrefix)

Feature adapters
  -> pass logical keys with feature segment only (lock:, auth:, idem:, …)
  -> never prepend global project namespace themselves
  -> RedisService emits physical keys: {keyPrefix}:lock:…, {keyPrefix}:auth:…, etc.
```

**Physical key examples** (assuming default `REDIS_KEY_PREFIX=app`):

| Feature       | Logical key (adapter)          | Physical Redis key                 |
| ------------- | ------------------------------ | ---------------------------------- |
| Cache         | `user:1`                       | `app:user:1`                       |
| Lock          | `lock:outbox-cron`             | `app:lock:outbox-cron`             |
| JWT refresh   | `auth:refresh-token:abc`       | `app:auth:refresh-token:abc`       |
| Session       | `sessions:sid-1`               | `app:sessions:sid-1`               |
| Idempotency   | `idem:api:req-1:lock`          | `app:idem:api:req-1:lock`          |
| Job execution | `job-execution:welcome:user-1` | `app:job-execution:welcome:user-1` |
| Rate limit    | `auth:login:127.0.0.1`         | `app:auth:login:127.0.0.1`         |

## Goal

Independently confirm — with code inspection, unit-test evidence, and optional runtime Redis inspection — that all Redis-backed infrastructure uses one configurable global namespace applied centrally via `RedisModule` / `RedisService`, that namespace can be changed at the composition root without editing feature adapters, and that tests and documentation cover the contract.

## Scope

| Activity                     | Responsibility        | Notes                                                                                              |
| ---------------------------- | --------------------- | -------------------------------------------------------------------------------------------------- |
| Implement centralized prefix | **P2-14 implementer** | `RedisKeyBuilder`, `RedisService` prefixing, adapter refactors, config, docs, tests                |
| Independent verification     | **V-20 verifier**     | Inspect diff, run commands, grep for bypass paths, write `docs/agent-reports/V-20-verification.md` |

## Out of scope

- Implementing the P2-14 fix (separate approved plan).
- **BullMQ queue key prefix alignment** — BullMQ uses a separate connection (`InfrastructureBullMqModule`) and its own `bull:…` schema; out of V-20 unless human expands scope.
- **Automatic migration of existing Redis data** — document as consumer rollout concern only.
- **PostgreSQL session store or non-Redis adapters.**
- **P2-02 / P2-03 / P2-08** — unrelated configuration/registry work.
- Marking P2-14 or V-20 resolved in backlog INDEX without implementation + verification evidence.

## Files to create

| File                                      | Symbol / responsibility                                                        |
| ----------------------------------------- | ------------------------------------------------------------------------------ |
| `docs/agent-reports/V-20-verification.md` | Independent verification report (verifier output; not created during planning) |

**Prerequisite from P2-14 (implementer creates):**

| File                                                      | Symbol / responsibility                                           |
| --------------------------------------------------------- | ----------------------------------------------------------------- |
| `libs/infrastructure/src/redis/redis-key-builder.ts`      | `RedisKeyBuilder` — normalize prefix; `buildKey` / `buildPattern` |
| `libs/infrastructure/src/redis/redis-key-builder.spec.ts` | Namespace normalization and segment joining                       |
| `libs/infrastructure/src/redis/redis.service.spec.ts`     | Verify prefix applied to get/set/eval/scanKeys                    |

## Files to modify

None during verification planning. Verifier inspects changes from P2-14:

| File                                                                                     | What to verify                                                                                              |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `libs/infrastructure/src/redis/redis.module-options.ts`                                  | `keyPrefix?: string` on `RedisModuleOptions`                                                                |
| `libs/infrastructure/src/redis/redis.module.ts`                                          | Registers/exports `RedisKeyBuilder`; wires into `RedisService`                                              |
| `libs/infrastructure/src/redis/redis.service.ts`                                         | Prefixes all key args; `eval` prefixes first `numKeys` only; lock helper (`setPxIfNotExists` or equivalent) |
| `libs/infrastructure/src/config/env.schema.ts`                                           | `REDIS_KEY_PREFIX` with validated default                                                                   |
| `libs/infrastructure/src/config/infrastructure-config.module.ts`                         | Maps `REDIS_KEY_PREFIX` → `redis.keyPrefix`                                                                 |
| `libs/infrastructure/src/config/app-config.service.ts`                                   | `redis().keyPrefix`                                                                                         |
| `libs/infrastructure/src/config/create-starter-kit-module-options.ts`                    | `mapAppConfigToRedisOptions` includes `keyPrefix`                                                           |
| `.env.example`                                                                           | Documents `REDIS_KEY_PREFIX`                                                                                |
| `libs/infrastructure/src/cache/redis-cache.gateway.ts`                                   | No hardcoded `app:`; logical keys only                                                                      |
| `libs/infrastructure/src/locks/redis-distributed-lock.ts`                                | Uses `RedisService`, not `REDIS_CLIENT`                                                                     |
| `libs/infrastructure/src/auth/redis-jwt-token-store.service.ts`                          | Feature segments only; family-revocation script does not bypass prefix                                      |
| `libs/infrastructure/src/auth/redis-session-store.service.ts`                            | Feature segments only                                                                                       |
| `libs/infrastructure/src/idempotency/idempotency.service.ts`                             | Feature segments only                                                                                       |
| `libs/infrastructure/src/idempotency/redis-job-execution.store.ts`                       | Feature segments only                                                                                       |
| `libs/infrastructure/src/rate-limiter/redis-rate-limiter.ts`                             | Relies on prefixed `RedisService`                                                                           |
| `libs/infrastructure/src/redis/redis.module.spec.ts`                                     | Boots with `keyPrefix`; resolves `RedisKeyBuilder`                                                          |
| Adapter specs (`redis-cache.gateway.spec.ts`, `redis-job-execution.store.spec.ts`, etc.) | Assert namespaced keys for all six feature areas                                                            |
| `README.md`, `docs/infrastructure-modules/README.md`                                     | Default namespace and shared-Redis guidance                                                                 |

## Files to delete

None.

## Contract and DI changes

- **Verifier expectation after P2-14:** `RedisModuleOptions.keyPrefix?: string`; `AppConfigService.redis().keyPrefix: string`; env `REDIS_KEY_PREFIX`.
- **Behavioral change:** all `RedisService` key parameters are logical; physical prefix applied internally.
- **Additive export:** `RedisKeyBuilder` from `RedisModule` (if P2-14 exports it).
- **`@contracts/*`:** no change — ports remain key-agnostic.
- **Breaking Redis data migration:** deploy invalidates prior unprefixed keys — document only; not a V-20 blocker if documented.

## Implementation steps

V-20 is a verification issue. Steps below are for the **independent verifier** after P2-14 implementation is complete.

### Prerequisite gate

1. Confirm **P2-14 plan** frontmatter is `status: approved`.
2. Confirm P2-14 implementation exists (inspect `git diff`; read `docs/agent-reports/P2-14-implementation.md` if present, but do not trust it without code inspection).
3. If P2-14 is not implemented, stop and return verdict **`changes-required`** with note: underlying defect still open.

### Step 1 — Scope and diff review

1. Run `git status` and `git diff`.
2. Confirm only P2-14-scoped files changed (primarily `libs/infrastructure/src/redis/**`, affected adapters, config, docs, tests).
3. Confirm no unrelated refactors in BullMQ, Auth DI (P1-06/P1-07), or Cron composition (P2-13/V-19).

### Step 2 — Static namespace contract review

1. **Single prefix owner:** grep confirms global prefix applied only in `RedisKeyBuilder` / `RedisService`:

   ```bash
   rg "private readonly prefix = 'app:'" libs/infrastructure/src
   rg "REDIS_CLIENT" libs/infrastructure/src/locks
   ```

   **Expected after fix:** no `app:` constant in cache adapter; `redis-distributed-lock.ts` does not inject `REDIS_CLIENT`.

2. **`RedisService.eval`:** verify first `numberOfKeys` arguments are passed through `toPhysicalKey` (or equivalent); ARGV values (tokens, TTLs) untouched.

3. **`scanKeys` / cache `forgetByPattern`:** logical patterns (e.g. `user:*`) become physical `app:user:*` (or configured prefix).

4. **JWT family revocation:** no in-Lua `ARGV[1] .. tokenId` key concatenation that bypasses centralized prefixing.

5. **Composition roots:** `mapAppConfigToRedisOptions` / entrypoint factories pass `keyPrefix` from config into `RedisModule.forRootAsync`.

### Step 3 — Namespace configurability check

1. In `redis.module.spec.ts` (or equivalent), confirm boot with `keyPrefix: 'tenant-a'` produces expected physical keys in service/builder tests.
2. Confirm feature adapter source does **not** read `REDIS_KEY_PREFIX` or `process.env` directly — namespace flows only through `RedisModule` registration.
3. Confirm changing `REDIS_KEY_PREFIX` in `.env.example` / README is sufficient guidance; no adapter edits required for a new namespace.

### Step 4 — Targeted unit verification (mandatory)

Run:

```bash
npm ci
npx jest libs/infrastructure/src/redis/redis-key-builder.spec.ts --runInBand
npx jest libs/infrastructure/src/redis/redis.service.spec.ts --runInBand
npx jest libs/infrastructure/src/redis/redis.module.spec.ts --runInBand
npx jest libs/infrastructure/src/cache/redis-cache.gateway.spec.ts --runInBand
npx jest libs/infrastructure/src/idempotency/redis-job-execution.store.spec.ts --runInBand
```

**Expected:** all pass; specs assert namespaced physical keys (or logical keys at adapter boundary with mocked `RedisService` receiving prefixed keys).

**Per-feature coverage matrix (must exist in Jest specs):**

| Area               | Minimum evidence                                   |
| ------------------ | -------------------------------------------------- |
| Cache              | Namespaced get/set/scan/unlink                     |
| Lock               | `lock:` segment + global prefix via `RedisService` |
| Auth (JWT/session) | `auth:` / `sessions:` segments + prefix            |
| Job execution      | `job-execution:` + prefix                          |
| Rate limit         | `auth:login:` or `rate:` + prefix                  |
| Idempotency        | `idem:` lock/result keys + prefix                  |

If auth specs are absent, `redis-key-builder.spec.ts` or `redis.service.spec.ts` table-driven cases mirroring adapter segment conventions are acceptable **only if** they explicitly cover auth and idempotency segments.

### Step 5 — Optional integration verification (when Redis available)

```bash
npx jest libs/infrastructure/src/cache/redis-cache.gateway.int-spec.ts --runInBand
```

With `REDIS_KEY_PREFIX=app` (or test-specific prefix), confirm:

- `SET` / `GET` use physical keys under configured namespace;
- `forgetByPattern` SCAN does not delete keys outside namespace;
- no `KEYS` command used (related V-08 constraint).

If Redis is unavailable, record under **Unverified areas** — not a project defect.

### Step 6 — Build and lint

```bash
npm run build
npm run lint
npx jest libs/infrastructure/src/redis --runInBand
```

Record exit codes. Build-only pass is **insufficient** for approval (defect is behavioral key construction, not compile-time).

### Step 7 — Documentation alignment

1. `.env.example` — `REDIS_KEY_PREFIX` documented with shared-Redis / multi-env note.
2. `README.md` §5.4 — logical vs physical keys; default `app`.
3. `docs/infrastructure-modules/README.md` — `RedisModule` example includes `keyPrefix`.
4. Auth Redis key docs show `{prefix}auth:…` form, not unprefixed literals only.

### Step 8 — Write verification report

Create `docs/agent-reports/V-20-verification.md` using structure from `.cursor/skills/change-verification/SKILL.md`:

```markdown
# V-20 — Independent verification

## Verdict

approved | changes-required | not-confirmed

## Scope checked

## Root-cause assessment

## Acceptance criteria matrix

## Namespace / key construction verification

## Commands executed

## Findings

## Documentation alignment

## Remaining risks

## Unverified areas
```

Include per-command records:

```text
Command:
Result:
Conclusion:
```

## Migration and rollout concerns

Verification is read-only. P2-14 introduces a **breaking Redis key migration**: existing unprefixed keys become orphaned after deploy. Verifier should confirm README or plan documents this; V-20 does not require live migration tooling.

## Targeted verification

| Command                                                                                      | Expected result                         |
| -------------------------------------------------------------------------------------------- | --------------------------------------- |
| `npm ci`                                                                                     | Clean install succeeds                  |
| `npx jest libs/infrastructure/src/redis/redis-key-builder.spec.ts --runInBand`               | Passes                                  |
| `npx jest libs/infrastructure/src/redis/redis.service.spec.ts --runInBand`                   | Passes; prefix on get/set/eval/scanKeys |
| `npx jest libs/infrastructure/src/cache/redis-cache.gateway.spec.ts --runInBand`             | Passes; no `app:` in adapter            |
| `npx jest libs/infrastructure/src/idempotency/redis-job-execution.store.spec.ts --runInBand` | Passes; namespaced keys                 |
| `rg "REDIS_CLIENT" libs/infrastructure/src/locks/redis-distributed-lock.ts`                  | No match (uses `RedisService`)          |
| `rg "prefix = 'app:'" libs/infrastructure/src/cache`                                         | No match                                |

## Full verification

| Command                                                                              | Expected result                                                            |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| `npm run build`                                                                      | Full monorepo compiles                                                     |
| `npm run lint`                                                                       | No new lint errors from P2-14 changes                                      |
| `npx jest libs/infrastructure/src/redis --runInBand`                                 | All Redis module tests pass                                                |
| `npm run test:unit`                                                                  | Full suite passes (or document pre-existing unrelated failures separately) |
| `npx jest libs/infrastructure/src/cache/redis-cache.gateway.int-spec.ts --runInBand` | Optional — when Redis available                                            |

## Acceptance criteria

Mapped to backlog P2-14 / V-20:

| ID    | Criterion                                                                         | Verification method                                         | Pass condition                                                                                                                 |
| ----- | --------------------------------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| AC-1  | P2-14 fix implemented and scoped correctly                                        | Diff + scope review                                         | Only planned files/symbols changed                                                                                             |
| AC-2  | All Redis keys pass through one namespace builder                                 | Code review + grep                                          | Only `RedisKeyBuilder`/`RedisService` apply global prefix; no adapter-owned `app:`; `RedisDistributedLock` uses `RedisService` |
| AC-3  | Namespace changeable without editing feature adapters                             | `redis.module.spec.ts` + config trace                       | `keyPrefix: 'tenant-a'` at module registration yields `tenant-a:lock:…` etc.                                                   |
| AC-4  | Default namespace safe for local dev and documented                               | `.env.example` + README                                     | Default `REDIS_KEY_PREFIX=app` (or human-approved alternative) documented                                                      |
| AC-5  | Tests cover cache/lock/auth/job-execution/rate-limit/idempotency key construction | Jest specs per Step 4 matrix                                | All six areas have explicit test evidence                                                                                      |
| AC-6  | `RedisService.eval` prefixes KEYS slots only                                      | Code review + `redis.service.spec.ts`                       | Lua ARGV not double-prefixed; JWT family script refactored                                                                     |
| AC-7  | `scanKeys` / pattern invalidation respects namespace                              | Cache spec + optional int-spec                              | SCAN match includes prefix; no cross-namespace deletes                                                                         |
| AC-8  | Composition roots wire `keyPrefix` from config                                    | Review `create-starter-kit-module-options.ts` + entrypoints | `mapAppConfigToRedisOptions` passes `keyPrefix`                                                                                |
| AC-9  | `npm run build` passes                                                            | Execute and record                                          | Exit 0                                                                                                                         |
| AC-10 | `npm run lint` passes                                                             | Execute and record                                          | Exit 0 or only pre-existing unrelated failures documented                                                                      |

**Verdict rules:**

- **`approved`** — AC-1 through AC-10 pass; optional int-spec passed or explicitly unverified with infra note.
- **`changes-required`** — any of AC-1–AC-8 fail, or `RedisDistributedLock` / cache still bypass centralized prefixing.
- **`not-confirmed`** — targeted specs or build could not run (missing deps, environment failure unrelated to code).

## Risks

1. **False approval from build-only checks** — `npm run build` passes on unfixed `main`; targeted Redis key specs and grep for `REDIS_CLIENT` in locks are mandatory.
2. **Double-prefix** — cache retains `app:` while `RedisService` also adds `app:` → `app:app:user:1`; unit tests must catch this.
3. **Lua eval bypass** — in-script key concatenation (JWT family revocation) skips prefix; static review of `redis-jwt-token-store.service.ts` required.
4. **ioredis native `keyPrefix`** — if implementer uses client-level prefix instead of `RedisService`, Lua/ARGV paths may still be wrong; V-20 must verify centralized approach per P2-14 plan.
5. **P2-14 not approved/implemented** — V-20 verification blocked until implementation completes.
6. **BullMQ false sense of completeness** — verifier should not approve V-20 based on BullMQ prefix unless scope expanded.

## Rollback strategy

Verification is read-only. If verdict is `changes-required`, revert to P2-14 implementer — no verifier code changes.

## Open questions requiring human decision

1. **Verification ordering** — must V-20 wait for a separate P2-14 verification report, or is V-20 the canonical namespace verification for this defect?
2. **Default `REDIS_KEY_PREFIX`** — confirm `app` vs empty string vs environment-derived default before approving AC-4.
3. **Cache key shape** — is `app:user:1` (prefix replaces adapter `app:`) acceptable, or is explicit `app:cache:user:1` required?
4. **Runtime Redis inspection** — is unit-test evidence sufficient for `approved`, or is manual `redis-cli KEYS 'tenant-a:*'` inspection mandatory when Redis is available?
5. **P2-14 plan approval** — P2-14 plan is currently `status: proposed`; confirm human approval before implementation begins.
6. **BullMQ alignment** — should V-20 fail if BullMQ `prefix` is not aligned with `REDIS_KEY_PREFIX`, or is that explicitly deferred?
