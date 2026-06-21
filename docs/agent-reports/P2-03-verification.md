# P2-03 — Independent verification

## Verdict

**approved**

## Scope checked

Verified against `git diff`, `git status`, and direct file inspection. Changes are confined to the approved plan scope:

| File                                                            | Status   | Plan alignment                               |
| --------------------------------------------------------------- | -------- | -------------------------------------------- |
| `libs/infrastructure/src/redis/redis.service.ts`                | Modified | `scanKeys` async generator + `unlink` helper |
| `libs/infrastructure/src/cache/redis-cache.gateway.ts`          | Modified | `forgetByPattern` uses SCAN batches + UNLINK |
| `libs/contracts/src/cache/cache-gateway.ts`                     | Modified | JSDoc only; signature unchanged              |
| `README.md`                                                     | Modified | §5.6 `forgetByPattern` documentation         |
| `libs/infrastructure/src/cache/redis-cache.gateway.spec.ts`     | Created  | Unit tests per plan                          |
| `libs/infrastructure/src/cache/redis-cache.gateway.int-spec.ts` | Created  | V-08 integration test per plan               |

**Not modified (confirmed):** `cache.module.ts`, `infrastructure.module.ts`, composition roots, tokens, or unrelated modules.

No unrelated refactors, dependency changes, or `package-lock.json` edits observed.

## Root-cause assessment

**Root cause addressed — not symptom suppression.**

Original defect: `forgetByPattern` called `this.redis.del(this.prefix + pattern)`, which performs a single-key `DEL` on a literal name (e.g. `app:user:*`) without glob expansion.

Fix: `forgetByPattern` now builds `match = this.prefix + pattern`, iterates `RedisService.scanKeys(match)` (cursor-based `SCAN MATCH … COUNT …`), and batch-deletes discovered keys via `RedisService.unlink`. Literal single-key `del(match)` is no longer used.

```26:31:libs/infrastructure/src/cache/redis-cache.gateway.ts
  async forgetByPattern(pattern: string): Promise<void> {
    const match = this.prefix + pattern;

    for await (const batch of this.redis.scanKeys(match)) {
      await this.redis.unlink(...batch);
    }
  }
```

```26:37:libs/infrastructure/src/redis/redis.service.ts
  async *scanKeys(match: string, count = 100): AsyncGenerator<string[]> {
    let cursor = '0';

    do {
      const [nextCursor, keys] = await this.redis.scan(cursor, 'MATCH', match, 'COUNT', count);
      cursor = nextCursor;

      if (keys.length > 0) {
        yield keys;
      }
    } while (cursor !== '0');
  }
```

## Acceptance criteria matrix

| #   | Criterion                                                                                   | Status     | Evidence                                                                                                                                                                                                                               |
| --- | ------------------------------------------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `forgetByPattern('user:*')` removes `app:user:1`, `app:user:2`, etc. (not literal key only) | **Passed** | Unit test mocks scan returning `app:user:1/2/3` and asserts `unlink` called per batch; integration test seeds `app:cache:p2-03:a/b`, calls `forgetByPattern('cache:p2-03:*')`, asserts both removed while `app:cache:other:c` remains. |
| 2   | Uses cursor-based `SCAN MATCH` — no blocking `KEYS`                                         | **Passed** | `scanKeys` uses `this.redis.scan(…, 'MATCH', …, 'COUNT', …)`; `rg '\.keys\('` on cache and `redis.service.ts` paths returns no matches; no `redis.keys()` usage in infrastructure cache/redis layers.                                  |
| 3   | Prefix `app:` applied exactly once                                                          | **Passed** | Gateway: `const match = this.prefix + pattern`; unit test asserts `scanKeys` called with `'app:user:*'` when pattern is `'user:*'`.                                                                                                    |
| 4   | Concurrent key creation documented as best-effort                                           | **Passed** | Contract JSDoc: "keys created concurrently during the scan may survive"; README §5.6: "Інвалідація best-effort: ключі, створені під час сканування, можуть залишитися."                                                                |
| 5   | Unit tests cover scan batching and prefix construction                                      | **Passed** | `redis-cache.gateway.spec.ts`: 2 tests — batched unlink across 2 scan batches + prefix assertion; empty-scan no-op. `npm run test:unit` — 2 passed.                                                                                    |
| 6   | V-08 integration scenario passes when Redis available                                       | **Passed** | `redis-cache.gateway.int-spec.ts` implements V-08 scenario; `npm run test:int` — 1 passed (Redis available locally).                                                                                                                   |
| 7   | README §5.6 documents `forgetByPattern`                                                     | **Passed** | Method added to list; glob/prefix semantics; SCAN/UNLINK description; `await cache.forgetByPattern('users:*')` example.                                                                                                                |
| 8   | No DI / composition-root changes beyond adapter and Redis helper                            | **Passed** | `cache.module.ts` unchanged (`git diff` empty); `InfrastructureModule` not in diff; same `TOKENS.CacheGateway` / `useExisting` registration.                                                                                           |

## Dependency and DI verification

DI chain unchanged from approved plan:

```text
InfrastructureModule.forRoot()
  -> RedisModule.forRootAsync(...)
  -> CacheModule.register({ imports: [redisModule] })
       providers: RedisCacheGateway, { provide: TOKENS.CacheGateway, useExisting: RedisCacheGateway }
       exports: TOKENS.CacheGateway, RedisCacheGateway
```

`RedisCacheGateway` still injects `RedisService` via constructor; no new tokens or providers. Integration test wires `RedisService` directly with an ioredis client (test-only, no module change).

## Commands executed

| Command                                                                                      | Result                                                   | Conclusion                                               |
| -------------------------------------------------------------------------------------------- | -------------------------------------------------------- | -------------------------------------------------------- |
| `npm run test:unit -- libs/infrastructure/src/cache/redis-cache.gateway.spec.ts`             | Exit 0 — 2 passed                                        | Unit tests pass                                          |
| `npm run test:int -- libs/infrastructure/src/cache/redis-cache.gateway.int-spec.ts`          | Exit 0 — 1 passed                                        | V-08 integration test passes (Redis available)           |
| `npm run build`                                                                              | Exit 0 (first attempt exit -1073741819; retry succeeded) | All four entrypoints compile                             |
| `npx eslint` (P2-03 changed files only)                                                      | Exit 0                                                   | No lint errors in changed scope                          |
| `rg '\.keys\(' libs/infrastructure/src/cache libs/infrastructure/src/redis/redis.service.ts` | No matches                                               | No blocking `KEYS` command usage in implementation paths |
| `git diff libs/infrastructure/src/cache/cache.module.ts`                                     | Empty                                                    | CacheModule unchanged                                    |

**Not executed (full suite):**

| Command                    | Reason                                                                                                                                                          |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run lint`             | Plan full verification item; implementer reported pre-existing outbox failures unrelated to P2-03 (P2-11). Targeted eslint on changed files passed.             |
| `npm run test:unit` (full) | Plan full verification item; implementer reported pre-existing `outbox-processor.options.schema.spec.ts` failure unrelated to P2-03. Targeted unit test passed. |
| `npm run test:int` (full)  | Not required for approval when targeted V-08 test passed with Redis available.                                                                                  |

## Findings

No blocking defects found.

**Non-blocking observations:**

1. **Build flakiness:** First `npm run build` exited with Windows code `-1073741819`; immediate retry succeeded. Environmental, not attributable to P2-03 changes.
2. **Integration skip semantics:** When Redis is unavailable, the test returns early (passes vacuously) with a `console.warn` in `beforeAll` — consistent with plan reference pattern, not a Jest `skip`. Skip path not re-run in this verification session.
3. **No safety guard** for over-broad patterns (e.g. lone `*`) — intentional per plan open-question default (caller responsibility).

## Documentation alignment

README §5.6, contract JSDoc, and implementation behavior are aligned:

- Logical pattern without `app:` prefix
- Cursor-based SCAN + batched UNLINK
- Best-effort concurrent semantics
- Example invalidation call

Resolves backlog doc mismatch "Pattern invalidation docs vs literal `DEL`" tied to P2-03.

## Remaining risks

| Risk                                  | Notes                                                             |
| ------------------------------------- | ----------------------------------------------------------------- |
| Large key sets                        | Batched SCAN (COUNT 100) + UNLINK; operational guidance in README |
| Over-broad patterns                   | No guard; caller responsibility (per plan)                        |
| Redis < 4.0 without UNLINK            | Plan risk table; deployment should confirm Redis 4.0+             |
| Duplicate keys across SCAN iterations | Redundant UNLINK is idempotent                                    |
| Concurrent writes during scan         | Documented best-effort only; no second pass                       |

## Unverified areas

- Manual Redis CLI spot-check (optional per plan) — not executed.
- Integration test behavior when Redis unavailable — skip path not re-run; code inspection shows early-return pattern consistent with other int-spec files.
- Full `npm run lint` and full `npm run test:unit` / `npm run test:int` suites — not executed; pre-existing unrelated failures reported by implementer under P2-11.
