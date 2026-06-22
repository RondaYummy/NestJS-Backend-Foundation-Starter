# P2-14 — Independent verification

## Verdict

**approved**

## Scope checked

- **Plan:** `docs/agent-plans/P2-14-centralized-redis-key-prefix.md` (`status: approved`)
- **Implementation report:** `docs/agent-reports/P2-14-implementation.md`
- **Staged diff:** 19 files — aligns with approved plan plus one documented out-of-plan compile fix

| Area | Result |
| ---- | ------ |
| Planned new files (`redis-key-builder.ts`, `redis-key-builder.spec.ts`, `redis.service.spec.ts`) | Present |
| Planned infrastructure changes (redis module/service/options, config, cache, locks, JWT store, docs) | Present |
| Out-of-plan change (`apps/worker/src/processors/email.processor.int-spec.ts`) | Documented deviation — `RedisService` now requires `RedisKeyBuilder`; test uses empty prefix to preserve raw-key assertions; no production behavior change |
| Unrelated backlog issues | Not mixed in |
| BullMQ prefix alignment | Correctly deferred per plan out-of-scope |

## Root-cause assessment

**Original defect:** Redis key namespaces were adapter-local; no portable `RedisModule` contract; `RedisDistributedLock` bypassed `RedisService` via `REDIS_CLIENT`; JWT family revocation used in-Lua key concatenation that would bypass native ioredis prefixing.

**Fix quality:** Root cause addressed, not symptom-only.

```text
Composition root (mapAppConfigToRedisOptions → config.redis())
  -> RedisModule.forRootAsync({ …, keyPrefix })
       -> RedisKeyBuilder(options.keyPrefix)
       -> RedisService(REDIS_CLIENT, RedisKeyBuilder)   // prefixes all logical keys
       -> REDIS_CLIENT (connection only; no ioredis keyPrefix)

Feature adapters
  -> pass logical feature segments only (lock:, auth:, sessions:, idem:, job-execution:, rate keys)
  -> RedisService emits physical keys: {prefix}{logicalKey}
```

Confirmed in code:

- `RedisCacheGateway` no longer owns `app:` prefix; passes caller keys through unchanged.
- `RedisDistributedLock` injects `RedisService` (not `REDIS_CLIENT`) and uses `setPxIfNotExists` with logical `lock:` segment.
- `RedisJwtTokenStore.revokeRefreshTokenFamily` replaced Lua ARGV concatenation with TypeScript GET/DEL flow.
- `RedisService.eval` prefixes only the first `numKeys` arguments; `scanKeys` returns logical keys.
- `mapAppConfigToRedisOptions` returns full `config.redis()` shape including `keyPrefix`, wiring all entrypoints that use it.

`REDIS_CLIENT` remains exported for connection-level consumers (e.g. health ping). No feature adapter injects `REDIS_CLIENT` for key-bearing operations.

## Acceptance criteria matrix

| Criterion | Status | Evidence |
| --------- | ------ | -------- |
| All Redis keys pass through one namespace builder | **passed** | Only `RedisKeyBuilder`/`RedisService` apply global prefix; grep shows no `prefix = 'app:'` in adapters; cache `app:` removed |
| Namespace changeable without editing feature adapters | **passed** | `redis.module.spec.ts` boots with `keyPrefix: 'tenant-a'` → `tenant-a:lock:outbox-cron`; adapters unchanged except cache prefix removal |
| Default namespace safe for local dev and documented | **passed** | `env.schema.ts` default `REDIS_KEY_PREFIX=app`; `.env.example` documented; README §5.4 + env table + rollout note |
| Tests cover cache/lock/auth/job-execution/rate-limit key construction | **passed** | `redis-key-builder.spec.ts` table-driven cases for all six areas; `redis.service.spec.ts` covers eval/scan/unlock/setPxIfNotExists; adapter specs assert logical keys at boundary |

## Dependency and DI verification

| Check | Result |
| ----- | ------ |
| `RedisModuleOptions.keyPrefix?: string` | Present |
| `RedisKeyBuilder` registered from `MODULE_OPTIONS_TOKEN` | Present |
| `RedisKeyBuilder` exported alongside `RedisService` | Present |
| `RedisService` constructor requires `RedisKeyBuilder` | Present |
| `AppConfigService.redis().keyPrefix` | Present |
| `REDIS_KEY_PREFIX` in env schema → `infrastructure-config.module.ts` | Present |
| Composition roots use `mapAppConfigToRedisOptions` | Unchanged call sites; now pass `keyPrefix` via `config.redis()` |
| ioredis native `keyPrefix` not used | Confirmed — prefixing centralized in `RedisService` |

## Commands executed

| Command | Result | Conclusion |
| ------- | ------ | ---------- |
| `npx jest --config jest.unit.config.ts libs/infrastructure/src/redis/redis-key-builder.spec.ts libs/infrastructure/src/redis/redis.service.spec.ts libs/infrastructure/src/cache/redis-cache.gateway.spec.ts libs/infrastructure/src/idempotency/redis-job-execution.store.spec.ts libs/infrastructure/src/redis/redis.module.spec.ts --runInBand` | Exit 0 — 5 suites, 32 passed | Targeted P2-14 tests pass |
| `npm run build` | Exit 0 | All four entrypoints compile |
| `npm run lint` | Exit 0 | No lint errors |
| `npx jest --config jest.unit.config.ts libs/infrastructure/src/redis --runInBand` | Exit 0 — 3 suites, 21 passed | Full redis unit folder green |

## Findings

No blocking defects found.

**Non-blocking observations:**

1. **Documented deviation:** `email.processor.int-spec.ts` updated for `RedisService` constructor signature; acceptable compile fix with empty `RedisKeyBuilder()` to preserve existing integration assertions.
2. **`redis-job-execution.store.spec.ts` unchanged:** still asserts logical keys at adapter boundary; physical prefixing covered in `redis-key-builder.spec.ts` and `redis.service.spec.ts` per plan allowance.
3. **Breaking migration:** deploy orphans prior unprefixed Redis keys; README documents flush/migrate requirement — expected per plan.

## Documentation alignment

- `.env.example` — `REDIS_KEY_PREFIX=app` with shared-Redis comment
- `README.md` §5.4 — `RedisKeyBuilder`, logical vs physical keys, breaking-change rollout note, auth key shapes with prefix
- `docs/infrastructure-modules/README.md` — `RedisModule` examples include `keyPrefix`

Documentation matches implementation.

## Remaining risks

- **Breaking Redis key migration** on first deploy or prefix change — documented; consumers must flush or migrate.
- **BullMQ keys** remain on separate namespace (`bull:…`) — explicitly out of scope; follow-up if shared-Redis isolation is required for queues.
- **Empty `REDIS_KEY_PREFIX`** allowed but collision-prone — documented in tests and README.

## Unverified areas

| Item | Reason |
| ---- | ------ |
| `npx jest libs/infrastructure/src/cache/redis-cache.gateway.int-spec.ts --runInBand` | Optional per plan; requires live Redis — not executed |
| `npm run start:api` bootstrap | Optional per plan; requires PostgreSQL + Redis — not executed |

These optional checks do not block approval; core acceptance criteria are met via unit tests and static DI trace.
