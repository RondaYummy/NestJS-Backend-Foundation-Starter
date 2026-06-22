# P2-14 — Implementation report

## Verdict

implemented

## Approved plan

`docs/agent-plans/P2-14-centralized-redis-key-prefix.md` (`status: approved`)

## Changed files

| Path | Change |
| ---- | ------ |
| `libs/infrastructure/src/redis/redis-key-builder.ts` | **Created** — single namespace builder |
| `libs/infrastructure/src/redis/redis-key-builder.spec.ts` | **Created** — normalization, patterns, adapter segment cases |
| `libs/infrastructure/src/redis/redis.service.spec.ts` | **Created** — prefix application for get/set/eval/scan/unlink/setPxIfNotExists |
| `libs/infrastructure/src/redis/redis.module-options.ts` | Added `keyPrefix?: string` |
| `libs/infrastructure/src/redis/redis.module.ts` | Register/export `RedisKeyBuilder`; wire into module |
| `libs/infrastructure/src/redis/redis.service.ts` | Inject `RedisKeyBuilder`; prefix all key args; add `setPxIfNotExists` |
| `libs/infrastructure/src/config/env.schema.ts` | Added `REDIS_KEY_PREFIX` (default `app`) |
| `libs/infrastructure/src/config/infrastructure-config.module.ts` | Map `REDIS_KEY_PREFIX` → `redis.keyPrefix` |
| `libs/infrastructure/src/config/app-config.service.ts` | Extended `redis()` shape with `keyPrefix` |
| `libs/infrastructure/src/cache/redis-cache.gateway.ts` | Removed local `app:` prefix |
| `libs/infrastructure/src/cache/redis-cache.gateway.spec.ts` | Assert logical keys at adapter boundary |
| `libs/infrastructure/src/cache/redis-cache.gateway.int-spec.ts` | Construct `RedisService` with `RedisKeyBuilder('app')` |
| `libs/infrastructure/src/locks/redis-distributed-lock.ts` | Switched from `REDIS_CLIENT` to `RedisService` |
| `libs/infrastructure/src/auth/redis-jwt-token-store.service.ts` | Replaced family-revocation Lua ARGV concat with TypeScript GET/DEL flow |
| `libs/infrastructure/src/redis/redis.module.spec.ts` | Boot with `keyPrefix: 'tenant-a'`; resolve `RedisKeyBuilder` |
| `.env.example` | Document `REDIS_KEY_PREFIX=app` |
| `README.md` | §5.4 namespace docs, cache/auth key shapes, env table, rollout note |
| `docs/infrastructure-modules/README.md` | RedisModule examples with `keyPrefix`; multi-project guidance |

## Completed steps

1. Defined `RedisModuleOptions.keyPrefix` and `RedisKeyBuilder` (normalize prefix, `buildKey`, `buildPattern`, `toPhysicalKey`, `toLogicalKey`).
2. Wired `REDIS_KEY_PREFIX` through env schema → `InfrastructureConfigModule` → `AppConfigService.redis().keyPrefix`.
3. Registered and exported `RedisKeyBuilder` in `RedisModule`; injected into `RedisService`.
4. Centralized prefixing in `RedisService` for all key-bearing methods; `eval` prefixes first `numKeys` args only; `scanKeys` returns logical keys.
5. Added `setPxIfNotExists` for millisecond TTL lock acquisition.
6. Refactored `RedisDistributedLock` to use `RedisService` with logical `lock:` segment.
7. Removed cache adapter-owned `app:` prefix; auth/session/idempotency/job-execution/rate-limiter already used feature segments only.
8. Refactored `revokeRefreshTokenFamily` away from in-Lua key concatenation.
9. Added/updated unit tests per plan targeted verification list.
10. Updated `.env.example`, README, and infrastructure module docs.

## Deviations

| Item | Reason |
| ---- | ------ |
| `apps/worker/src/processors/email.processor.int-spec.ts` | **Compile fix only** — `RedisService` constructor now requires `RedisKeyBuilder`. Test uses empty prefix to preserve existing raw-key assertions. Not in approved file list; no behavioral change to production code. |

No other deviations from approved scope.

## Commands executed

```bash
npx jest --config jest.unit.config.ts libs/infrastructure/src/redis/redis-key-builder.spec.ts libs/infrastructure/src/redis/redis.service.spec.ts libs/infrastructure/src/cache/redis-cache.gateway.spec.ts libs/infrastructure/src/idempotency/redis-job-execution.store.spec.ts libs/infrastructure/src/redis/redis.module.spec.ts --runInBand
npm run build
npm run lint
npx jest --config jest.unit.config.ts libs/infrastructure/src/redis --runInBand
```

## Command results

| Command | Result | Conclusion |
| ------- | ------ | ---------- |
| Targeted P2-14 unit tests (5 suites) | Exit 0 — 32 passed | Namespace builder, service prefixing, cache, job-execution, module wiring verified |
| `npm run build` | Exit 0 | All entrypoints compile with new Redis DI |
| `npm run lint` | Exit 0 | No new lint issues |
| `npx jest --config jest.unit.config.ts libs/infrastructure/src/redis --runInBand` | Exit 0 — 21 passed | Full redis unit folder green |

## Acceptance criteria self-check

| Criterion | Status | Evidence |
| --------- | ------ | -------- |
| All Redis keys pass through one namespace builder | **Met** | Only `RedisKeyBuilder`/`RedisService` apply global prefix; cache `app:` removed; `RedisDistributedLock` no longer uses `REDIS_CLIENT` for keys |
| Namespace changeable without editing feature adapters | **Met** | `redis.module.spec.ts` uses `keyPrefix: 'tenant-a'` → `tenant-a:lock:…`; adapters pass logical segments only |
| Default namespace safe for local dev and documented | **Met** | `REDIS_KEY_PREFIX=app` in env schema, `.env.example`, README env table and §5.4 |
| Tests cover cache/lock/auth/job-execution/rate-limit key construction | **Met** | `redis-key-builder.spec.ts` table-driven cases for all six areas; adapter/service specs updated |

## Remaining risks

- **Breaking Redis key migration:** deploy with default `app` prefix orphans prior unprefixed keys (`lock:…`, `auth:…`, etc.). Documented in README §5.4; consumers must flush or migrate.
- **BullMQ prefix alignment** remains out of scope (separate follow-up per plan).
- **Empty `REDIS_KEY_PREFIX`** is allowed but documented as collision-prone for shared Redis.

## Unverified areas

- `npx jest libs/infrastructure/src/cache/redis-cache.gateway.int-spec.ts --runInBand` — not run (requires live Redis; optional per plan).
- `npm run start:api` bootstrap — not run (requires PostgreSQL + Redis infrastructure).
- Independent verification (V-20) — pending separate verifier pass.
