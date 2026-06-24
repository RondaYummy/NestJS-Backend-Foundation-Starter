# V-20 — Independent verification

## Verdict

**approved**

## Scope checked

V-20 is a verification backlog item. The underlying fix was delivered by **P2-14** (plan `docs/agent-plans/P2-14-centralized-redis-key-prefix.md` — `status: approved`; implementation report `docs/agent-reports/P2-14-implementation.md`).

This session performed read-only verification on `main` with no production code changes.

| Area | Result |
| ---- | ------ |
| P2-14 plan approved | Confirmed |
| P2-14 implementation present on branch | Confirmed — `RedisKeyBuilder`, centralized `RedisService` prefixing, config wiring, adapter refactors, tests, docs |
| Verification scope | P2-14-scoped Redis namespace files only; no unrelated BullMQ/Auth/Cron refactors |
| BullMQ prefix alignment | Correctly deferred per V-20 / P2-14 out-of-scope |

**Note:** `docs/agent-backlog/INDEX.md` is staged for deletion on the working tree — unrelated to V-20; does not affect this verdict.

## Root-cause assessment

**Original defect:** Redis key namespaces were adapter-local implementation details; no portable `RedisModule` contract; `RedisDistributedLock` bypassed `RedisService` via `REDIS_CLIENT`; JWT family revocation used in-Lua key concatenation that would bypass native ioredis prefixing.

**Fix quality (confirmed in code):** Root cause addressed, not symptom-only.

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

Static checks:

- `rg "private readonly prefix = 'app:'" libs/infrastructure/src` — **no matches**
- `rg "REDIS_CLIENT" libs/infrastructure/src/locks` — **no matches**
- `RedisCacheGateway` passes caller keys through unchanged (no local `app:` prefix)
- `RedisDistributedLock` injects `RedisService`; uses `setPxIfNotExists` with logical `lock:` segment
- `RedisJwtTokenStore.revokeRefreshTokenFamily` uses TypeScript GET/DEL flow (no in-Lua `ARGV .. tokenId` concatenation)
- `RedisService.eval` prefixes only the first `numKeys` arguments; `scanKeys` returns logical keys
- Feature adapters do not read `REDIS_KEY_PREFIX` or `process.env` directly — namespace flows through `InfrastructureConfigModule` → `AppConfigService` → `RedisModule`

## Acceptance criteria matrix

| ID | Criterion | Result | Evidence |
| -- | --------- | ------ | -------- |
| AC-1 | P2-14 fix implemented and scoped correctly | **passed** | P2-14 artifacts on `main`; scope matches approved plan |
| AC-2 | All Redis keys pass through one namespace builder | **passed** | Only `RedisKeyBuilder`/`RedisService` apply global prefix; no adapter-owned `app:`; lock uses `RedisService` |
| AC-3 | Namespace changeable without editing feature adapters | **passed** | `redis.module.spec.ts` boots with `keyPrefix: 'tenant-a'` → `tenant-a:lock:outbox-cron` |
| AC-4 | Default namespace safe for local dev and documented | **passed** | `env.schema.ts` default `REDIS_KEY_PREFIX=app`; `.env.example` L17–18; README §5.4 + env table + rollout note |
| AC-5 | Tests cover cache/lock/auth/job-execution/rate-limit/idempotency key construction | **passed** | `redis-key-builder.spec.ts` table-driven cases for all six areas; `redis.service.spec.ts` covers eval/scan/unlock/setPxIfNotExists; adapter specs assert logical keys at boundary |
| AC-6 | `RedisService.eval` prefixes KEYS slots only | **passed** | Code review + `redis.service.spec.ts` eval assertions; JWT family script refactored |
| AC-7 | `scanKeys` / pattern invalidation respects namespace | **passed** | `redis.service.spec.ts` scan/unlink; `redis-cache.gateway.spec.ts` logical pattern flow; int-spec passed |
| AC-8 | Composition roots wire `keyPrefix` from config | **passed** | `mapAppConfigToRedisOptions` returns `config.redis()` including `keyPrefix`; `infrastructure-config.module.ts` maps `REDIS_KEY_PREFIX` |
| AC-9 | `npm run build` passes | **passed** | Exit 0 — all four entrypoints compile |
| AC-10 | `npm run lint` passes | **passed** | Exit 0 |

## Namespace / key construction verification

| Feature | Logical key (adapter) | Physical key (`REDIS_KEY_PREFIX=app`) | Test evidence |
| ------- | --------------------- | ------------------------------------- | ------------- |
| Cache | `users:1` | `app:users:1` | `redis-key-builder.spec.ts` |
| Lock | `lock:outbox-cron` | `app:lock:outbox-cron` | `redis-key-builder.spec.ts`, `redis.service.spec.ts` |
| Auth (JWT) | `auth:refresh-token:jti-1` | `app:auth:refresh-token:jti-1` | `redis-key-builder.spec.ts` |
| Session | `sessions:session-1` | `app:sessions:session-1` | `redis-key-builder.spec.ts` |
| Idempotency | `idem:api:req-1:lock` | `app:idem:api:req-1:lock` | `redis-key-builder.spec.ts`, `redis.service.spec.ts` |
| Job execution | `job-execution:welcome:user-1` | `app:job-execution:welcome:user-1` | `redis-key-builder.spec.ts`, `redis-job-execution.store.spec.ts` |
| Rate limit | `auth:login:127.0.0.1` | `app:auth:login:127.0.0.1` | `redis-key-builder.spec.ts` |

## Commands executed

| Command | Result | Conclusion |
| ------- | ------ | ---------- |
| `rg "private readonly prefix = 'app:'" libs/infrastructure/src` | No matches | Cache adapter no longer owns global prefix |
| `rg "REDIS_CLIENT" libs/infrastructure/src/locks` | No matches | Lock uses `RedisService` |
| `npm run test:unit -- libs/infrastructure/src/redis/redis-key-builder.spec.ts libs/infrastructure/src/redis/redis.service.spec.ts libs/infrastructure/src/cache/redis-cache.gateway.spec.ts libs/infrastructure/src/idempotency/redis-job-execution.store.spec.ts --forceExit` | Exit 0 — 4 suites, 31 passed | Step 4 targeted unit evidence |
| `npm run test:module -- libs/infrastructure/src/redis/redis.module.spec.ts --forceExit` | Exit 0 — 1 suite, 1 passed | Configurable namespace at module registration |
| `npm run test:unit -- libs/infrastructure/src/redis --forceExit` | Exit 0 — 2 suites, 20 passed (first attempt crashed with Windows exit -1073741819; retry succeeded) | Full Redis unit folder green |
| `npm run build` | Exit 0 | All entrypoints compile |
| `npm run lint` | Exit 0 | No lint errors |
| `npm run test:int -- libs/infrastructure/src/cache/redis-cache.gateway.int-spec.ts --runInBand --forceExit` | Exit 0 — 1 suite, 1 passed | Optional runtime Redis evidence |

**Note:** Plan lists raw `npx jest` invocations; executed via `npm run test:unit` / `npm run test:module` per V-14 Jest suite split (correct scripts for unit vs module bootstrap specs).

## Findings

No blocking defects found.

**Non-blocking observations:**

1. **BullMQ keys** remain on separate namespace (`bull:…`) — explicitly out of V-20 scope.
2. **Breaking migration:** deploy orphans prior unprefixed Redis keys; README documents flush/migrate requirement — expected per plan.
3. **Adapter specs** assert logical keys at boundary; physical prefixing covered in `redis-key-builder.spec.ts` and `redis.service.spec.ts` per plan allowance.

## Documentation alignment

- `.env.example` — `REDIS_KEY_PREFIX=app` with shared-Redis comment (L17–18)
- `README.md` §5.4 — `RedisKeyBuilder`, logical vs physical keys, breaking-change rollout note, auth key shapes with prefix
- `docs/infrastructure-modules/README.md` — `RedisModule` examples include `keyPrefix`; multi-project guidance

Documentation matches implementation.

## Remaining risks

- **Breaking Redis key migration** on first deploy or prefix change — documented; consumers must flush or migrate.
- **BullMQ keys** not aligned with `REDIS_KEY_PREFIX` — follow-up if shared-Redis isolation is required for queues.
- **Empty `REDIS_KEY_PREFIX`** allowed but collision-prone — documented in tests and README.

## Unverified areas

| Item | Reason |
| ---- | ------ |
| `npm run test:all` | Not executed in this session |
| `npm run start:api` bootstrap | Optional; requires PostgreSQL + Redis — not executed |

These do not block approval; AC-1 through AC-10 pass with unit, module, integration, build, and lint evidence.
