# P2-03 — Implementation report

## Verdict

implemented

## Approved plan

`docs/agent-plans/P2-03-implement-real-forget-by-pattern.md` — SCAN-based pattern invalidation path, `status: approved`.

Human decisions applied per plan recommendation:

- **Fix strategy:** (b) real cursor-based `SCAN MATCH` invalidation (not rename-to-`del`).
- **`UNLINK` vs `DEL`:** `UNLINK` for batched deletion.
- **Scan batch size:** fixed default `100` on `RedisService.scanKeys`.
- **Safety guard:** none — caller responsibility (per open question default).
- **Concurrent semantics:** documented best-effort only (no second pass).
- **Integration test Redis URL:** `REDIS_HOST` / `REDIS_PORT` env with localhost defaults (same pattern as `email.processor.int-spec.ts`).

## Changed files

| Path                                                                  | Change                                                                                                      |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `libs/infrastructure/src/redis/redis.service.ts`                      | Added `scanKeys(match, count?)` async generator and `unlink(...keys)` helper                                |
| `libs/infrastructure/src/cache/redis-cache.gateway.ts`              | `forgetByPattern` iterates `scanKeys('app:' + pattern)` and batch-`unlink`s keys; no literal single-key `del` |
| `libs/contracts/src/cache/cache-gateway.ts`                         | JSDoc on `forgetByPattern`: logical glob pattern, best-effort concurrent semantics, error propagation       |
| `README.md`                                                           | §5.6 — added `forgetByPattern` to method list, pattern semantics, and invalidation example                  |
| `libs/infrastructure/src/cache/redis-cache.gateway.spec.ts`           | **Created** — unit tests for prefix, scan batches, unlink calls, no literal `del`                           |
| `libs/infrastructure/src/cache/redis-cache.gateway.int-spec.ts`       | **Created** — V-08 integration test with Redis skip when unavailable                                        |

**Not modified (per plan):** `CacheModule`, `InfrastructureModule`, composition roots, tokens.

## Completed steps

1. **`RedisService` scan/delete helpers** — `scanKeys` wraps `SCAN MATCH … COUNT …`; `unlink` no-ops on empty array; no `KEYS` usage.
2. **`RedisCacheGateway.forgetByPattern`** — builds `match = prefix + pattern`, iterates scan batches, calls `unlink` per batch.
3. **Contract documentation** — JSDoc on `ICacheGateway.forgetByPattern`.
4. **README alignment** — §5.6 method list and invalidation example.
5. **Unit tests** — prefix construction, batched unlink, empty scan no-op, no literal `del`.
6. **Integration test (V-08)** — seeds matching and non-matching keys; asserts selective deletion; cleanup in `afterEach`.
7. **Verification** — targeted and full commands executed (see below).

## Deviations

None.

## Commands executed

| Command                                                                                        | Result                          | Conclusion                                              |
| ---------------------------------------------------------------------------------------------- | ------------------------------- | ------------------------------------------------------- |
| `npm run test:unit -- libs/infrastructure/src/cache/redis-cache.gateway.spec.ts`               | Exit 0 — 2 passed               | Unit tests pass                                         |
| `npm run build`                                                                                | Exit 0                          | All four entrypoints compile                            |
| `npm run test:int -- libs/infrastructure/src/cache/redis-cache.gateway.int-spec.ts`            | Exit 0 — 1 passed               | **V-08 pass** — Redis available locally                 |
| `npx eslint` (P2-03 changed files only)                                                        | Exit 0                          | No lint errors in P2-03 scope                           |
| `npm run lint`                                                                                 | Exit 1 — 4 pre-existing errors  | Unrelated outbox files (tracked under P2-11)            |
| `npm run test:unit`                                                                            | Exit 1 — 1 pre-existing failure | `outbox-processor.options.schema.spec.ts` unrelated     |
| `rg '\.keys\(' libs/infrastructure/src/cache libs/infrastructure/src/redis/redis.service.ts`   | No matches                      | No blocking `KEYS` in implementation                    |

## Command results

### Targeted tests (P2-03 scope)

```
redis-cache.gateway.spec: 2 passed
redis-cache.gateway.int-spec (V-08): 1 passed
```

### Build

```
nest build api && nest build worker && nest build cron && nest build migrations — exit 0
```

## Acceptance criteria self-check

| # | Criterion                                                                 | Status |
| - | ------------------------------------------------------------------------- | ------ |
| 1 | `forgetByPattern('user:*')` removes `app:user:1`, `app:user:2`, etc.      | **Pass** — integration test + SCAN/UNLINK wiring |
| 2 | Uses cursor-based `SCAN MATCH` — no blocking `KEYS`                       | **Pass** — `RedisService.scanKeys` only |
| 3 | Prefix `app:` applied exactly once                                        | **Pass** — unit test asserts `scanKeys('app:user:*')` |
| 4 | Concurrent key creation documented as best-effort                           | **Pass** — contract JSDoc + README |
| 5 | Unit tests cover scan batching and prefix construction                    | **Pass** — 2 unit tests |
| 6 | V-08 integration scenario passes when Redis available                     | **Pass** — 1 integration test |
| 7 | README §5.6 documents `forgetByPattern` pattern semantics                 | **Pass** |
| 8 | No DI / composition-root changes beyond adapter and Redis helper layer    | **Pass** |

## Remaining risks

| Risk                              | Notes                                                                 |
| --------------------------------- | --------------------------------------------------------------------- |
| Large key sets                    | Batched SCAN + UNLINK with COUNT 100; operational guidance in README  |
| Over-broad patterns (e.g. `*`)    | Caller responsibility; no guard added per plan open question            |
| Redis < 4.0 without `UNLINK`      | Deployment docs should confirm Redis 4.0+ (plan risk table)           |
| Duplicate keys across SCAN passes | Redundant UNLINK is idempotent                                        |

## Unverified areas

- Manual Redis CLI spot-check (optional per plan) — not executed.
- Full `npm run lint` and `npm run test:unit` suite — blocked by pre-existing outbox failures unrelated to P2-03 (see P2-11).
- Integration test skip path when Redis unavailable — not re-run in this session (Redis was available and test passed).
