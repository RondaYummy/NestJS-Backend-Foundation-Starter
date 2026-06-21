---
issue_id: P2-03
status: approved
owner: human-approval-required
---

# P2-03 — Implement real `forgetByPattern()`

## Source issue

`docs/agent-backlog/NESTJS_STARTER_KIT_REQUIRED_FIXES.md` — section **P2-03. Реалізувати справжній `forgetByPattern()`**.

Related documentation mismatch: backlog table **§5** — “Pattern invalidation docs vs literal `DEL`” → `P2-03`.

Related verification scenario: backlog **V-08** — “Redis pattern invalidation via SCAN without blocking KEYS”.

## Current behavior

1. `RedisCacheGateway.forgetByPattern(pattern)` calls `this.redis.del(this.prefix + pattern)` where `prefix = 'app:'`.
2. Redis `DEL` removes a **single literal key** named exactly `app:<pattern>`. It does **not** expand glob characters (`*`, `?`, `[…]`).
3. Example: `forgetByPattern('user:*')` attempts `DEL app:user:*` — which only deletes a key literally named `app:user:*`, not keys such as `app:user:1`, `app:user:2`.
4. All other cache methods (`get`, `set`, `del`, `remember`) prepend `app:` once to a logical key supplied by the caller.
5. `ICacheGateway.forgetByPattern` exists in the public contract, but **no in-repo consumer** currently injects `TOKENS.CacheGateway` or calls `forgetByPattern`.
6. README **§5.6** documents `get` / `set` / `del` / `remember` but omits `forgetByPattern`; README **§20.4** lists `forgetByPattern` as a planned cache integration-test area.
7. No cache unit or integration tests exist today (`*.spec.ts` / `*.int-spec.ts` under `libs/infrastructure/src/cache/`).
8. `RedisService` exposes no `SCAN`, `UNLINK`, or cursor helpers; repository-wide search finds **zero** `scan(` / `scanStream` usage.

**Investigation (2026-06-21, current branch):** defect confirmed — `redis-cache.gateway.ts` lines 26–28 still perform literal `DEL`. Issue is **not stale**.

## Confirmed root cause

`forgetByPattern` was implemented with the same code path as `del()` (single-key `DEL`) while the method name and contract imply Redis glob-style pattern invalidation. The gateway never invokes cursor-based `SCAN MATCH …` followed by batched deletion.

## Dependency/runtime flow

```text
Future use case / service
  -> @Inject(TOKENS.CacheGateway) ICacheGateway
       -> CacheModule.register({ imports: [redisModule] })
            -> RedisCacheGateway.forgetByPattern(logicalPattern)
                 -> RedisService.del('app:' + logicalPattern)   // bug: literal DEL only
                      -> ioredis client DEL
```

**DI registration (unchanged by this fix):**

```text
InfrastructureModule.forRoot()
  -> RedisModule.forRootAsync(...)
  -> CacheModule.register({ imports: [redisModule] })
       providers: RedisCacheGateway, { provide: TOKENS.CacheGateway, useExisting: RedisCacheGateway }
       exports: TOKENS.CacheGateway, RedisCacheGateway
```

**Prefix semantics (must stay consistent):**

| Caller argument | Stored Redis key (set/get/del) | SCAN match for forgetByPattern |
| --------------- | ------------------------------ | ------------------------------ |
| `users:42`      | `app:users:42`                 | N/A (single key via `del`)     |
| `users:*`       | N/A                            | `app:users:*`                  |

Prefix `app:` must be applied **exactly once** — callers pass the logical pattern **without** the `app:` prefix, matching `get` / `set` / `del`.

## Goal

Make `forgetByPattern(pattern)` delete all Redis keys whose names match `app:<pattern>` using non-blocking cursor-based `SCAN`, batched `UNLINK` (or `DEL` if human chooses), and documented best-effort semantics under concurrent writes. Align README contract documentation with actual behavior and add tests covering **V-08**.

## Scope

1. Implement cursor-based pattern deletion in the cache gateway (preferred over renaming — see open questions).
2. Add minimal Redis primitive helpers on `RedisService` for iterative `SCAN MATCH` and batched deletion (keep ioredis usage centralized).
3. Apply `app:` prefix exactly once when building the SCAN match pattern.
4. Document pattern semantics and concurrent-write behavior (contract JSDoc + README **§5.6**).
5. Add unit tests with mocked `RedisService`.
6. Add optional Redis integration test aligned with **V-08** (skip when Redis unavailable, same pattern as existing `*.int-spec.ts` files).

## Out of scope

- Renaming `forgetByPattern` to `del()` **unless** human explicitly chooses the rename path over SCAN implementation (would be a breaking contract change).
- Making cache key prefix configurable (`CacheModule.forRootAsync`) — separate portability concern.
- Adding Application-layer cache invalidation call sites — no consumers exist yet.
- Replacing `redis.keys()` usage in `apps/worker/src/processors/email.processor.int-spec.ts` (test cleanup helper, unrelated).
- Broader README sync tracked under `P3-02` beyond the `forgetByPattern` / pattern-invalidation mismatch tied to this issue.
- `CacheModule`, `InfrastructureModule`, or composition-root DI changes (none expected).
- Blocking `KEYS` command usage anywhere.

## Files to create

| Path                                                            | Responsibility                                                                                                                                                                                        |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `libs/infrastructure/src/cache/redis-cache.gateway.spec.ts`     | Unit tests: prefix applied once; SCAN match string; batched unlink/del calls; no literal single-key `del` for patterns; empty scan result is no-op.                                                   |
| `libs/infrastructure/src/cache/redis-cache.gateway.int-spec.ts` | Integration test (**V-08**): seed multiple `app:test:forget:*` keys, call `forgetByPattern('test:forget:*')`, assert matching keys removed and non-matching keys remain; skip when Redis unavailable. |

## Files to modify

| Path                                                   | Symbol / responsibility                                                                                                                                                                                                                    |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `libs/infrastructure/src/redis/redis.service.ts`       | Add cursor-based helpers, e.g. `scanKeys(match: string, count?: number): AsyncGenerator<string[]>` (wrapping `SCAN MATCH … COUNT …`, never `KEYS`) and `unlink(...keys: string[]): Promise<number>` (or `delMany` if human chooses `DEL`). |
| `libs/infrastructure/src/cache/redis-cache.gateway.ts` | `RedisCacheGateway.forgetByPattern(pattern)` — build `match = this.prefix + pattern`, iterate `scanKeys(match)`, batch-delete returned keys; do not call single-key `del(match)`.                                                          |
| `libs/contracts/src/cache/cache-gateway.ts`            | JSDoc on `forgetByPattern`: logical pattern without `app:` prefix; glob semantics; best-effort under concurrent key creation.                                                                                                              |
| `README.md`                                            | **§5.6** — add `forgetByPattern(pattern: string)` to the methods list with brief pattern-invalidation semantics and example (e.g. invalidate all user cache entries).                                                                      |

## Files to delete

None.

## Contract and DI changes

### `ICacheGateway` (signature unchanged)

```ts
// libs/contracts/src/cache/cache-gateway.ts
forgetByPattern(pattern: string): Promise<void>;
```

No token changes. `TOKENS.CacheGateway` registration in `cache.module.ts` stays the same. Behavior becomes correct pattern invalidation; this is a **bugfix**, not a breaking signature change.

### Documented semantics (add JSDoc / README)

- `pattern` is a **logical** glob pattern relative to the gateway prefix, e.g. `users:*`, not `app:users:*`.
- Deletion is **best-effort**: keys created concurrently during the scan may survive; keys outside the match must not be deleted.
- Errors from Redis propagate to the caller (consistent with other cache methods).

### DI

No new providers, tokens, or module exports.

## Implementation steps

1. **Human decision gate** — confirm implement-SCAN path (recommended) vs rename-to-`del` path before coding (see open questions).
2. **`RedisService` scan/delete helpers**
   - Implement private or public cursor loop using `this.redis.scan(cursor, 'MATCH', match, 'COUNT', batchSize)` (ioredis API).
   - Yield key batches until cursor returns `'0'`.
   - Implement `unlink(...keys)` delegating to `this.redis.unlink(...keys)`; no-op on empty array.
   - Do **not** expose or use `KEYS`.
3. **`RedisCacheGateway.forgetByPattern`**
   - Compute `const match = this.prefix + pattern`.
   - Iterate scan batches; for each non-empty batch, call `unlink` (or `delMany`).
   - Optionally use a fixed batch size constant (e.g. `100`) aligned with human decision.
4. **Contract documentation**
   - Add JSDoc to `forgetByPattern` in `cache-gateway.ts`.
5. **README alignment**
   - Extend **§5.6** method list and add one invalidation example.
6. **Unit tests** (`redis-cache.gateway.spec.ts`)
   - Mock `RedisService` with async generator for `scanKeys` and spy on `unlink`.
   - Assert `forgetByPattern('user:*')` scans `app:user:*` and unlinks discovered keys in batches.
   - Assert literal `del('app:user:*')` is **not** used.
   - Assert zero keys scanned → zero unlink calls.
7. **Integration test** (`redis-cache.gateway.int-spec.ts`, **V-08**)
   - Connect to Redis from env (reuse localhost defaults from other tests if present).
   - Seed keys: `app:cache:p2-03:a`, `app:cache:p2-03:b`, `app:cache:other:c`.
   - Call `forgetByPattern('cache:p2-03:*')`.
   - Assert `a` and `b` absent; `other:c` present.
   - Clean up test keys in `afterEach` / `afterAll`.
8. **Verification** — run targeted then full commands listed below.

## Migration and rollout concerns

- **Behavior change only** for callers relying on the broken literal-`DEL` semantics (unlikely — that behavior deleted at most one wrongly named key).
- Correct pattern invalidation may delete **more** keys than before; this is the intended fix.
- No database migrations, env vars, or deployment-order changes.
- Redis **4.0+** supports `UNLINK`; confirm target Redis version in deployment docs if `UNLINK` is chosen.

## Targeted verification

| Command / scenario                                                                                                                | Expected result                                                                                                          |
| --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `npm run test:unit -- libs/infrastructure/src/cache/redis-cache.gateway.spec.ts`                                                  | Pass; proves SCAN + batch delete wiring and prefix semantics.                                                            |
| `npm run build` (or `npm run build:api` if only infrastructure libs changed — prefer full `npm run build` for shared lib changes) | Compile succeeds.                                                                                                        |
| **V-08** — Redis available: `npm run test:int -- libs/infrastructure/src/cache/redis-cache.gateway.int-spec.ts`                   | Pass; glob keys removed, unrelated keys preserved; no `KEYS` in implementation.                                          |
| **V-08** — Redis unavailable                                                                                                      | Integration test skips gracefully (document skip reason in test output).                                                 |
| Manual spot-check (optional, Redis CLI)                                                                                           | After `forgetByPattern('user:*')`, `SCAN 0 MATCH app:user:* COUNT 100` returns no keys that existed before invalidation. |

## Full verification

| Command             | Expected result                                                                                      |
| ------------------- | ---------------------------------------------------------------------------------------------------- |
| `npm run build`     | All entrypoints compile.                                                                             |
| `npm run lint`      | Zero warnings/errors.                                                                                |
| `npm run test:unit` | Full unit suite passes including new cache spec.                                                     |
| `npm run test:int`  | Integration suite passes or skips only for infrastructure-unavailable cases with explicit messaging. |

## Acceptance criteria

1. `forgetByPattern('user:*')` removes Redis keys such as `app:user:1`, `app:user:2`, not only a literal `app:user:*` key.
2. Implementation uses cursor-based `SCAN MATCH app:<pattern> COUNT <batch>` — **no** blocking `KEYS`.
3. Prefix `app:` is applied exactly once (caller supplies logical pattern without prefix).
4. Concurrent key creation behavior is documented (best-effort invalidation).
5. Unit tests cover scan batching and prefix construction.
6. **V-08** integration scenario passes when Redis is available.
7. README **§5.6** documents `forgetByPattern` pattern semantics (resolves linked doc mismatch).
8. No DI / composition-root changes required beyond the adapter and Redis helper layer.

## Risks

| Risk                                            | Mitigation                                                                                                |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Large key sets cause long-running invalidation  | Batched `SCAN` + `UNLINK`; fixed `COUNT`; document operational guidance.                                  |
| Over-broad pattern (e.g. `*`) deletes many keys | Document caller responsibility; optional guard rejecting empty or overly broad patterns (human decision). |
| `UNLINK` unavailable on older Redis             | Confirm minimum Redis version; fall back to batched `DEL` if human approves.                              |
| Integration test flakiness without Redis        | Skip pattern consistent with `drizzle-outbox-processor.int-spec.ts`.                                      |
| Duplicate keys across SCAN iterations           | De-dupe batch before unlink or tolerate redundant `UNLINK` (idempotent).                                  |

## Rollback strategy

1. Revert commits touching `redis-cache.gateway.ts`, `redis.service.ts`, tests, and README.
2. Redeploy previous artifact — no schema or env rollback needed.
3. Post-rollback, `forgetByPattern` returns to incorrect literal-`DEL` behavior (known defect).

## Open questions requiring human decision

1. **Primary fix strategy** — Backlog allows either (a) rename to `del()` and drop pattern semantics, or (b) implement real SCAN-based invalidation. **Recommendation:** (b) — preserves `ICacheGateway` contract, satisfies **V-08**, and fixes the doc mismatch without a breaking rename. Confirm before implementation.
2. **`UNLINK` vs `DEL`** — Prefer non-blocking `UNLINK` for batches, or use `DEL` for simplicity/compatibility?
3. **Scan batch size** — Accept fixed constant `100`, or expose via future `CacheModule` options (out of scope unless required now)?
4. **Safety guard** — Reject dangerous patterns such as empty string or lone `*` that would match all `app:*` keys, or leave responsibility entirely to callers?
5. **Concurrent semantics** — Is documenting best-effort deletion sufficient, or should the implementation perform a second SCAN pass to catch keys created mid-flight (adds complexity/latency)?
6. **Integration test Redis URL** — Reuse `REDIS_HOST` / `REDIS_PORT` from env schema, or hardcode localhost defaults like other tests?
