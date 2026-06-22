---
issue_id: P2-14
status: approved
owner: human-approval-required
---

# P2-14 — Add centralized Redis namespace/key prefix

## Source issue

`docs/agent-backlog/NESTJS_STARTER_KIT_REQUIRED_FIXES.md` — section **P2-14. Додати централізований Redis namespace/key prefix**.

Related backlog grouping: **Contracts/configuration** (`P2-02`, `P2-03`, `P2-08`, `P2-14`).

## Current behavior

1. **`RedisModuleOptions`** (`libs/infrastructure/src/redis/redis.module-options.ts`) exposes only connection fields (`host`, `port`, `password`, `db`, `connectTimeoutMs`). No `keyPrefix`, `namespace`, or equivalent.
2. **`RedisModule`** (`libs/infrastructure/src/redis/redis.module.ts`) creates a raw `ioredis` client without `keyPrefix` and exports `REDIS_CLIENT` + `RedisService`.
3. **`RedisService`** (`libs/infrastructure/src/redis/redis.service.ts`) forwards caller-supplied keys unchanged to `ioredis` for every method (`get`, `set`, `del`, `scanKeys`, `eval`, etc.).
4. **Feature adapters build local prefixes independently:**

   | Adapter             | File                                                                                   | Local key pattern (today)                                                   |
   | ------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
   | Cache               | `libs/infrastructure/src/cache/redis-cache.gateway.ts`                                 | `app:${key}`                                                                |
   | Distributed lock    | `libs/infrastructure/src/locks/redis-distributed-lock.ts`                              | `lock:${key}` (via `REDIS_CLIENT`, bypasses `RedisService`)                 |
   | JWT token store     | `libs/infrastructure/src/auth/redis-jwt-token-store.service.ts`                        | `auth:refresh-token:`, `auth:refresh-family:`, `auth:revoked-access-token:` |
   | Session store       | `libs/infrastructure/src/auth/redis-session-store.service.ts`                          | `sessions:${sessionId}`                                                     |
   | HTTP idempotency    | `libs/infrastructure/src/idempotency/idempotency.service.ts`                           | `idem:${scope}:${key}:lock` / `:result`                                     |
   | Job execution lease | `libs/infrastructure/src/idempotency/redis-job-execution.store.ts`                     | `job-execution:${key}`                                                      |
   | Rate limiter        | `libs/infrastructure/src/rate-limiter/rate-limiter.guard.ts` → `redis-rate-limiter.ts` | `${keyPrefix}:${req.ip}` (e.g. `auth:login:127.0.0.1`, default `rate:…`)    |

5. **Environment/config** — `.env.example`, `env.schema.ts`, `infrastructure-config.module.ts`, and `AppConfigService` expose Redis connection settings only; no namespace variable.
6. **Documentation** lists Redis auth/cache key shapes as fixed literals (README §5.4, §Auth Redis state) with no multi-tenant / shared-Redis guidance.

**Investigation (2026-06-22, branch `main`, uncommitted backlog doc edits present):** architectural risk confirmed. Issue is **not stale**.

## Confirmed root cause

The starter kit treats Redis key namespaces as adapter-local implementation details instead of a portable module contract on `RedisModule`. There is no single builder or normalization layer, and one adapter (`RedisDistributedLock`) bypasses `RedisService` entirely by injecting `REDIS_CLIENT`. Changing project/environment isolation therefore requires editing multiple infrastructure adapters.

## Dependency/runtime flow

### Current (problematic)

```text
Composition root
  -> RedisModule.forRootAsync({ host, port, db, ... })   // no namespace
       -> REDIS_CLIENT (raw ioredis)
       -> RedisService (pass-through keys)

Feature adapters (each adds its own prefix locally)
  -> RedisCacheGateway           -> app:${key}
  -> RedisDistributedLock        -> lock:${key}          (direct REDIS_CLIENT)
  -> RedisJwtTokenStore          -> auth:…
  -> RedisSessionStore           -> sessions:…
  -> RedisIdempotencyService     -> idem:…
  -> RedisJobExecutionStore     -> job-execution:…
  -> RateLimiterGuard            -> auth:login:${ip} / rate:…
       -> RedisRateLimiter       -> incrementWithTtl(raw key)
```

### Target

```text
Composition root
  -> RedisModule.forRootAsync({ …, keyPrefix: config.redis().keyPrefix })
       -> RedisKeyBuilder(keyPrefix)          // single namespace builder
       -> RedisService(builder + client)     // prefixes all logical keys
       -> REDIS_CLIENT (unchanged connection; no ioredis keyPrefix)

Feature adapters
  -> pass logical keys with feature segment only (cache:, lock:, auth:, …)
  -> never prepend global project namespace themselves
  -> RedisService emits physical keys: {keyPrefix}:lock:…, {keyPrefix}:auth:…, etc.
```

**Note:** `RedisDistributedLock` must stop using `REDIS_CLIENT` directly so all lock keys pass through the same prefix path.

## Goal

Introduce one configurable Redis namespace (`REDIS_KEY_PREFIX` / `RedisModuleOptions.keyPrefix`) applied centrally so multiple projects or environments can share a Redis DB without key collisions, and integrators can change namespace at the composition root without editing feature adapters.

## Scope

1. Add `keyPrefix?: string` to `RedisModuleOptions` and wire it from env/config.
2. Introduce `RedisKeyBuilder` provider in the Redis module as the single namespace builder.
3. Update `RedisService` to prefix every key argument (including `eval` `KEYS` slots and `scanKeys` match patterns).
4. Refactor all Redis-backed infrastructure adapters listed above to use logical (feature-local) segments only.
5. Migrate `RedisDistributedLock` to `RedisService` (add minimal PX+NX helper needed for lock acquisition).
6. Refactor `RedisJwtTokenStore.revokeRefreshTokenFamily` Lua script to avoid in-script key concatenation that would bypass centralized prefixing.
7. Add unit tests for key construction across cache/lock/auth/job-execution/rate-limit/idempotency paths.
8. Update `.env.example`, README, and `docs/infrastructure-modules/README.md` with default namespace and multi-project Redis guidance.

## Out of scope

- **BullMQ queue key prefix** — BullMQ uses a separate connection (`InfrastructureBullMqModule`) and its own Redis key schema (`bull:…`). Aligning BullMQ `prefix` with `REDIS_KEY_PREFIX` is a follow-up; not required for P2-14 acceptance unless human expands scope.
- **Automatic migration of existing Redis data** — deploy will invalidate prior unprefixed keys; document as acceptable breaking change for starter-kit consumers.
- **PostgreSQL session store or non-Redis adapters.**
- **P2-02 / P2-03 / P2-08** — unrelated configuration/registry work.
- **Using ioredis native `keyPrefix` option** — rejected for this fix because Lua scripts (notably JWT family revocation) perform in-script key concatenation; native client prefixing does not reliably prefix `ARGV`-built keys.

## Files to create

| Path                                                      | Responsibility                                                                                |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `libs/infrastructure/src/redis/redis-key-builder.ts`      | Normalize configured namespace; `buildKey(...segments)`; `buildPattern(...segments)` for SCAN |
| `libs/infrastructure/src/redis/redis-key-builder.spec.ts` | Namespace normalization, segment joining, empty/default prefix behavior                       |
| `libs/infrastructure/src/redis/redis.service.spec.ts`     | Verify `RedisService` applies builder to get/set/eval/scanKeys                                |

## Files to modify

| Path                                                                    | Symbol / responsibility                                                                         |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `libs/infrastructure/src/redis/redis.module-options.ts`                 | Add optional `keyPrefix?: string`                                                               |
| `libs/infrastructure/src/redis/redis.module.ts`                         | Register/export `RedisKeyBuilder`; inject into `RedisService` factory if needed                 |
| `libs/infrastructure/src/redis/redis.service.ts`                        | Inject `RedisKeyBuilder`; prefix all keys; add `setPxIfNotExists(key, value, ttlMs)` for locks  |
| `libs/infrastructure/src/config/env.schema.ts`                          | Add `REDIS_KEY_PREFIX` with validated default                                                   |
| `libs/infrastructure/src/config/infrastructure-config.module.ts`        | Map `REDIS_KEY_PREFIX` into `redis.keyPrefix` config shape                                      |
| `libs/infrastructure/src/config/app-config.service.ts`                  | Extend `ConfigShape['redis']` with `keyPrefix: string`                                          |
| `.env.example`                                                          | Document `REDIS_KEY_PREFIX`                                                                     |
| `libs/infrastructure/src/cache/redis-cache.gateway.ts`                  | Remove hardcoded `app:`; pass logical cache keys (unchanged caller keys) through `RedisService` |
| `libs/infrastructure/src/cache/redis-cache.gateway.spec.ts`             | Update expected physical keys with namespace                                                    |
| `libs/infrastructure/src/cache/redis-cache.gateway.int-spec.ts`         | Use configured namespace in test setup / assertions                                             |
| `libs/infrastructure/src/locks/redis-distributed-lock.ts`               | Inject `RedisService`; use `setPxIfNotExists`; logical segment `lock:`                          |
| `libs/infrastructure/src/auth/redis-jwt-token-store.service.ts`         | Keep `auth:…` segments; refactor family-revocation script to avoid Lua prefix concat            |
| `libs/infrastructure/src/auth/redis-session-store.service.ts`           | Logical segment `sessions:` (no global prefix)                                                  |
| `libs/infrastructure/src/idempotency/idempotency.service.ts`            | Logical segment `idem:…` (no change to segment shape)                                           |
| `libs/infrastructure/src/idempotency/redis-job-execution.store.ts`      | Logical segment `job-execution:`                                                                |
| `libs/infrastructure/src/idempotency/redis-job-execution.store.spec.ts` | Expect namespaced keys                                                                          |
| `libs/infrastructure/src/rate-limiter/rate-limiter.guard.ts`            | No segment change; keys still `auth:login:${ip}` etc. — prefix applied downstream               |
| `libs/infrastructure/src/rate-limiter/redis-rate-limiter.ts`            | No local prefix; relies on prefixed `RedisService`                                              |
| `libs/infrastructure/src/redis/redis.module.spec.ts`                    | Boot module with `keyPrefix`; resolve `RedisKeyBuilder`                                         |
| `README.md`                                                             | §5.4 Redis module + auth Redis key docs + env table                                             |
| `docs/infrastructure-modules/README.md`                                 | RedisModule example with `keyPrefix`; multi-project note                                        |

## Files to delete

None.

## Contract and DI changes

| Area                       | Change                                                                                                                                                              |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RedisModuleOptions`       | **Additive:** optional `keyPrefix?: string`                                                                                                                         |
| `RedisModule` exports      | **Additive:** export `RedisKeyBuilder` (for tests/advanced composition; feature adapters should prefer `RedisService`)                                              |
| `RedisService` public API  | **Behavioral:** all key parameters are logical keys; physical prefix applied internally. **Additive:** `setPxIfNotExists` (or equivalent) for millisecond TTL locks |
| `AppConfigService.redis()` | **Additive:** `keyPrefix: string`                                                                                                                                   |
| Env                        | **Additive:** `REDIS_KEY_PREFIX`                                                                                                                                    |
| `@contracts/*`             | **No change** — ports remain key-agnostic                                                                                                                           |

**Recommended default (pending human confirmation):** `REDIS_KEY_PREFIX=app`

- Preserves today's cache key shape when cache drops its local `app:` and passes logical keys unchanged (`user:1` → `app:user:1`).
- Other features gain namespace isolation (`lock:…` → `app:lock:…`, `auth:…` → `app:auth:…`).

## Implementation steps

1. **Define namespace contract**
   - Add `keyPrefix?: string` to `RedisModuleOptions`.
   - Implement `RedisKeyBuilder`:
     - normalize prefix (trim; if non-empty ensure exactly one trailing `:`);
     - `buildKey(...segments: string[]): string` → `{prefix}{segment1}:{segment2}:…`;
     - `buildPattern(...segments: string[]): string` for SCAN (preserve caller `*` wildcards in final segment);
     - reject segments containing `:` at the adapter boundary optional guard (document convention: one segment per argument).

2. **Wire configuration**
   - Add `REDIS_KEY_PREFIX` to `env.schema.ts` (default `app`; allow empty string for no namespace — document risk).
   - Map through `infrastructure-config.module.ts` → `AppConfigService.redis().keyPrefix`.
   - Update `.env.example` with comment explaining shared-Redis / multi-env usage.

3. **Register builder in Redis module**
   - Provide `RedisKeyBuilder` from `MODULE_OPTIONS_TOKEN`.
   - Inject into `RedisService`.
   - Export `RedisKeyBuilder` alongside `RedisService`.

4. **Centralize prefixing in `RedisService`**
   - Private helper `toPhysicalKey(logicalKey: string)` and `toPhysicalPattern(logicalPattern: string)`.
   - Apply to every public method accepting keys (`get`, `set`, `del`, `exists`, `ttl`, `incr`, `expire`, `setIfNotExists`, `compareAndDelete`, `compareAndExpire`, `incrementWithTtl`, `completeIdempotency`, `eval`, `scanKeys`, `unlink`).
   - For `eval(script, numKeys, ...args)`: prefix the first `numKeys` arguments only; leave token/TTL ARGV values untouched.

5. **Add lock acquisition helper**
   - Implement `setPxIfNotExists(key, value, ttlMs)` on `RedisService` using `SET key value PX ttl NX`.

6. **Refactor `RedisDistributedLock`**
   - Replace `@Inject(REDIS_CLIENT)` with `RedisService`.
   - Use logical keys `lock:${key}`; acquisition via `setPxIfNotExists`; release/extend via `RedisService.eval`.

7. **Refactor feature adapters (remove global prefix ownership)**
   - **Cache:** delete `private readonly prefix = 'app:'`; call `RedisService` with caller keys directly; `forgetByPattern` passes logical pattern (e.g. `user:*`).
   - **Auth JWT / session / idempotency / job execution / rate limiter:** keep existing feature segments; remove any redundant project-level prefix if present after service centralization.

8. **Fix JWT family revocation Lua**
   - Replace in-Lua `ARGV[1] .. currentTokenId` pattern with either:
     - (preferred) two-step TypeScript flow: `GET` family → `DEL` token key + `DEL` family key using `RedisService`; or
     - multi-KEY Lua where all keys are listed in `KEYS[]` and receive centralized prefix via `RedisService.eval`.
   - Add/adjust unit coverage around `revokeRefreshTokenFamily`.

9. **Update tests**
   - `redis-key-builder.spec.ts`: default prefix, custom prefix, empty prefix, pattern building.
   - `redis.service.spec.ts`: mock builder/client; verify prefix applied once (no double prefix).
   - Update existing adapter specs (`redis-cache.gateway.spec.ts`, `redis-job-execution.store.spec.ts`, auth specs if present) to assert logical keys at adapter boundary and/or namespaced keys at mock `RedisService` boundary.
   - Add focused examples for each acceptance area (cache, lock, auth, job-execution, rate-limit, idempotency) — can live in `redis-key-builder.spec.ts` as table-driven cases mirroring adapter segment conventions.

10. **Documentation**
    - README §5.4: document `REDIS_KEY_PREFIX`, `RedisKeyBuilder`, logical vs physical keys.
    - README auth Redis key section: show keys as `{prefix}auth:…`.
    - `docs/infrastructure-modules/README.md`: extend RedisModule example; note multi-project shared Redis setup.

## Migration and rollout concerns

- **Breaking Redis key migration:** after deploy, existing unprefixed keys (e.g. `lock:outbox-cron`, `auth:refresh-token:…`) will not match new namespaced keys (e.g. `app:lock:outbox-cron`). Acceptable for starter kit; document that consumers must flush or migrate Redis data on namespace introduction/change.
- **Default `app` + cache refactor:** cache keys remain `app:<logicalKey>` when callers pass the same logical keys as today — lowest cache-specific breakage.
- **Session/JWT/logout during rollout:** active sessions and refresh families stored under old keys become invalid after prefix change — same as any Redis key migration; TTLs bound exposure.
- **Empty prefix:** allow but document collision risk for shared Redis; useful for single-tenant local dev only.

## Targeted verification

| Command                                                                                      | Purpose                        |
| -------------------------------------------------------------------------------------------- | ------------------------------ |
| `npx jest libs/infrastructure/src/redis/redis-key-builder.spec.ts --runInBand`               | Namespace builder rules        |
| `npx jest libs/infrastructure/src/redis/redis.service.spec.ts --runInBand`                   | Central prefix application     |
| `npx jest libs/infrastructure/src/cache/redis-cache.gateway.spec.ts --runInBand`             | Cache key construction         |
| `npx jest libs/infrastructure/src/idempotency/redis-job-execution.store.spec.ts --runInBand` | Job-execution keys             |
| `npx jest libs/infrastructure/src/redis/redis.module.spec.ts --runInBand`                    | Module wiring with `keyPrefix` |

Optional when Redis is available locally:

| Command                                                                              | Purpose                     |
| ------------------------------------------------------------------------------------ | --------------------------- |
| `npx jest libs/infrastructure/src/cache/redis-cache.gateway.int-spec.ts --runInBand` | SCAN/delete under namespace |

## Full verification

| Command                                                                                                                                                | Expected result                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------ |
| `npm run build`                                                                                                                                        | Pass — shared infrastructure / contracts compile |
| `npm run lint`                                                                                                                                         | Pass                                             |
| `npx jest libs/infrastructure/src/redis --runInBand`                                                                                                   | Pass                                             |
| `npx jest libs/infrastructure/src/cache/redis-cache.gateway.spec.ts libs/infrastructure/src/idempotency/redis-job-execution.store.spec.ts --runInBand` | Pass                                             |

Optional bootstrap (PostgreSQL + Redis available):

| Command             | Expected result                               |
| ------------------- | --------------------------------------------- |
| `npm run start:api` | Boots; no DI errors from Redis module changes |

## Acceptance criteria

| Criterion                                                             | Verification                                                                                                                                                                                               |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| All Redis keys pass through one namespace builder                     | Code review: only `RedisKeyBuilder`/`RedisService` apply global prefix; grep for hardcoded `app:` removed from cache adapter; `RedisDistributedLock` no longer uses raw `REDIS_CLIENT` for key-bearing ops |
| Namespace changeable without editing feature adapters                 | `RedisModule.forRoot({ …, keyPrefix: 'tenant-a' })` in composition root / module spec produces `tenant-a:lock:…` etc.; adapter source unchanged except removal of local global prefix                      |
| Default namespace safe for local dev and documented                   | `.env.example` + README state default `REDIS_KEY_PREFIX=app` and shared-Redis guidance                                                                                                                     |
| Tests cover cache/lock/auth/job-execution/rate-limit key construction | Jest specs listed in targeted verification include segment cases for all six areas                                                                                                                         |

## Risks

| Risk                                                                     | Mitigation                                                                                                                  |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| Double-prefix if adapter retains old `app:` after service adds namespace | Remove cache `app:` constant; code review + unit tests                                                                      |
| Lua `eval` keys not prefixed consistently                                | Centralize prefixing only in `RedisService.eval` for first `numKeys` args; refactor JWT family script away from ARGV concat |
| `scanKeys` pattern mismatch after prefix move                            | Use `buildPattern` helper; update cache int-spec                                                                            |
| Breaking existing Redis data on deploy                                   | Document in README rollout note                                                                                             |
| Empty `REDIS_KEY_PREFIX` reintroduces collision risk                     | Allow but warn in docs; default non-empty                                                                                   |

## Rollback strategy

Revert the commit(s). Restore prior adapter-local prefixes. Flush Redis or tolerate mixed key namespaces during rollback window.

## Open questions requiring human decision

1. **Default `REDIS_KEY_PREFIX`:** confirm `app` vs empty string vs `NODE_ENV`-derived value.
2. **Cache segment rename:** keep logical keys identical to today (`app:user:1` via prefix only) vs introduce explicit `cache:` segment (`app:cache:user:1`) — latter is clearer but breaks existing cache keys.
3. **BullMQ alignment:** should `InfrastructureBullMqModule` accept the same prefix (Bull `prefix` option) in this issue or a separate follow-up?
4. **Export surface:** is exporting `RedisKeyBuilder` from the public module API required for integrators, or should it remain internal with only `RedisService` as the consumer-facing API?
