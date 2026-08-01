---
issue_id: P1-01
status: approved
owner: human-approval-required
---

# P1-01 — Fix Redis session user-index TTL overwrite

## Source issue

- Backlog: `docs/agent-backlog/NESTJS_STARTER_KIT_REQUIRED_FIXES.md` § P1-01
- Index: `docs/agent-backlog/INDEX.md` — P1-01 | High | Confirmed defect
- Review evidence: `docs/agent-reports/full-review-2026-07-28.md` (session user-index TTL overwrite)

## Current behavior

Confirmed on the current branch in `libs/infrastructure/src/auth/redis-session-store.service.ts` (`RedisSessionStore.create`):

1. Session payload is written to `sessions:{sessionId}` with the caller-supplied `ttlSeconds`.
2. The session id is added to the per-user SET `sessions:user:{userId}` via `sadd`.
3. The store **always** calls `expire(userIndexKey, ttlSeconds)` using only the **new** session’s TTL.

```ts
await this.redisService.set(sessionKey, JSON.stringify(record), ttlSeconds);
await this.redisService.sadd(userIndexKey, sessionId);
await this.redisService.expire(userIndexKey, ttlSeconds);
```

Downstream effects:

- `listByUserId` reads only that SET (then prunes missing session keys).
- `RedisSessionManagementService.listForUser` / `revokeOthers` / `revokeAll` all depend on `listByUserId`.
- Cookie auth via `get(sessionId)` still works if the index expired early, so devices remain authenticated while invisible to session-management APIs.

Existing unit coverage in `redis-session-store.service.spec.ts` asserts the blind `expire(..., 3600)` behavior and does not cover mixed TTLs.

Default `SessionAuthTokenService.createAuthSession` always passes `AUTH_SESSION_TTL_SECONDS`, so production traffic with a single fixed TTL may not reproduce the bug day-to-day. The store API still accepts arbitrary `ttlSeconds`, and any shorter subsequent create (custom adapter caller, config change across process lifetime, or future sliding/short-lived sessions) can truncate the index. The backlog correctly treats this as a confirmed store defect.

## Confirmed root cause

User-index key TTL is overwritten with the newest member’s TTL instead of being extended to at least the maximum remaining lifetime needed to cover indexed sessions.

A shorter-lived session (or any create with a smaller TTL than the index’s remaining TTL) can expire `sessions:user:{userId}` while longer-lived `sessions:{sessionId}` keys remain. Those sessions become index orphans: reachable by cookie/`get`, invisible to list/revoke-all.

## Dependency/runtime flow

```text
SessionAuthTokenService.createAuthSession
  → ISessionStore.create(record, sessionTtlSeconds)
    → RedisSessionStore.create
      → RedisService.set / sadd / expire
        → Redis keys: sessions:{id}, sessions:user:{userId}

List / revoke path:
  SessionsController / use cases
    → ISessionManagementService (RedisSessionManagementService)
      → ISessionStore.listByUserId / get / delete
        → RedisSessionStore.listByUserId (SMEMBERS + prune)
```

Composition (unchanged by this fix):

- `AuthModule` registers `{ provide: TOKENS.SessionStore, useExisting: RedisSessionStore }` (and async factory equivalent).
- `apps/api/src/composition/auth-application.module.ts` wires `RedisSessionManagementService(sessionStore)` when `AUTH_DRIVER=session`.

`RedisService` already exposes `ttl` and `expire`; no new Redis client methods are required for the recommended approach.

## Goal

Ensure the per-user session index remains valid for at least as long as any still-indexed session key, so `listByUserId` / `revokeAll` / `revokeOthers` remain complete under mixed TTLs, without changing the public HTTP API or `ISessionStore` method signatures.

## Scope

- Fix index TTL update logic inside `RedisSessionStore.create` only (plus tests and minimal docs that describe the corrected key semantics).
- Prefer the smallest correct strategy that preserves the existing SET index shape: **`EXPIRE` to `max(currentIndexTtl, newTtl)`** with correct handling of Redis TTL sentinels (`-1` no expiry, `-2` missing key).
- Unit tests proving a shorter second create does not schedule an index expiry earlier than the longer remaining TTL.
- Keep `listByUserId` prune-on-read behavior as-is (already correct for stale members).

## Out of scope

- P1-02 (password change/reset session/JWT purge) and any other backlog issues.
- Migrating the index from SET to ZSET (acceptable alternative only if a human rejects max-TTL; not the default plan).
- Removing index TTL entirely (unbounded Redis retention for inactive user indexes).
- Shortening index TTL on `delete` when the longest-lived member is removed (optimization, not required by AC).
- Sliding session TTL / activity-based refresh of session keys.
- HTTP/OpenAPI changes, composition-root rewiring, new contracts/tokens, or `RedisService` API expansion (unless a human chooses ZSET).
- Backfilling / repairing sessions already orphaned by the bug in deployed Redis.

## Files to create

- None (implementation-only change to existing store + specs). Plan artifact is this file.

## Files to modify

| Path                                                               | Symbol / responsibility                                                                                                                                         |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `libs/infrastructure/src/auth/redis-session-store.service.ts`      | `RedisSessionStore.create` — after `sadd`, set index expiry to `max(remainingTtl, ttlSeconds)` instead of blindly `expire(..., ttlSeconds)`.                    |
| `libs/infrastructure/src/auth/redis-session-store.service.spec.ts` | Update the existing `create` expectation; add mixed-TTL coverage for AC-01/AC-03; extend Redis mock typing if needed for `ttl` on the index key.                |
| `libs/contracts/src/auth/session-store.service.ts`                 | Doc comment on logical keys only — clarify that `sessions:user:{userId}` TTL must cover the longest remaining indexed session (no interface signature change).  |
| `README.md`                                                        | Optional one-line clarification under the session Redis key layout (`sessions:user:{userId}`) that index TTL is not blindly replaced by the newest session TTL. |
| `docs/agent-plans/INDEX.md`                                        | Register this plan row (`proposed`).                                                                                                                            |

## Files to delete

- None.

## Contract and DI changes

- **`ISessionStore`**: no method signature or token changes.
- **`TOKENS.SessionStore`**: unchanged.
- **Composition roots** (`AuthModule`, `auth-application.module.ts`): no provider/import changes.
- **Public HTTP / OpenAPI**: none (AC-04).
- Documentation-only contract comment update describing corrected index TTL semantics.

## Implementation steps

1. In `RedisSessionStore.create`, keep `set` + `sadd` unchanged.
2. Replace unconditional `expire(userIndexKey, ttlSeconds)` with:
   - `const currentTtl = await this.redisService.ttl(userIndexKey);`
   - If `currentTtl < 0` (Redis: `-2` key missing after race, or `-1` key exists with no expiry — typical right after first `sadd` on a new key): call `expire(userIndexKey, ttlSeconds)` so a newly created index always gets a finite TTL.
   - Else: `expire(userIndexKey, Math.max(currentTtl, ttlSeconds))`.
3. Do not change `get`, `delete`, or `listByUserId` behavior in this issue.
4. Update unit tests:
   - Existing create test: mock index `ttl` as `-1` (fresh SET) and expect `expire(..., ttlSeconds)` once; or mock a remaining TTL and assert `max`.
   - **Mixed TTL (AC-01 / AC-03):** first `create(..., 3600)` with index `ttl === -1` → `expire(..., 3600)`; second `create(..., 60)` with index `ttl` mocked as e.g. `3000` → expect `expire(..., 3000)` (not `60`).
   - Optionally assert a longer second TTL extends the index (`ttl` remaining `100`, new `3600` → `expire(..., 3600)`).
5. Align the `ISessionStore` file-level key comment (and optionally README key layout) with the new semantics.
6. Do not mark the backlog issue resolved; leave resolution to verification + human acceptance.

### Recommended strategy rationale

| Option                                | Verdict for this plan                                                                                                |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `max(currentIndexTtl, newTtl)` on SET | **Chosen** — minimal diff, uses existing `RedisService.ttl` / `expire`, preserves SET + prune-on-read, satisfies AC. |
| ZSET scored by absolute expiry        | Larger change (new Redis helpers, rewrite list/delete); only if human prefers exact per-member expiry tracking.      |
| No index TTL + prune-on-read          | Correct for visibility, but leaves empty/stale user SETs indefinitely — poor portable-starter Redis hygiene.         |

## Migration and rollout concerns

- **No DB / schema migration.** Redis key names and SET member format stay the same.
- **Forward-only fix:** after deploy, new `create` calls no longer shorten the index. Sessions already dropped from an expired index remain orphaned until the session key TTL elapses or the user re-authenticates (new create re-indexes). Document as known residual for already-affected environments; no automated repair in this issue.
- **Compatibility:** existing session JSON and cookie/session id format unchanged. Custom `TOKENS.SessionStore` overrides are unaffected.
- **Default fixed TTL:** with a single `AUTH_SESSION_TTL_SECONDS`, behavior should match today’s happy path (index TTL refreshed to the same configured value), while remaining-TTL `max` still avoids accidental shortening if remaining index TTL exceeds the new absolute TTL window in edge timings.

## Targeted verification

| Command                                                                                                                                                      | Purpose                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------ |
| `npx jest libs/infrastructure/src/auth/redis-session-store.service.spec.ts --runInBand` (or project-equivalent via `node node_modules/jest/bin/jest.js ...`) | Mixed-TTL index TTL unit coverage.         |
| `npm run test:unit`                                                                                                                                          | Fast unit gate including auth store specs. |
| `npm run build` or at least `npm run build:api`                                                                                                              | Shared contracts/infrastructure compile.   |

## Full verification

| Command             | Purpose                                                |
| ------------------- | ------------------------------------------------------ |
| `npm run build`     | Full TypeScript build across entrypoints.              |
| `npm run lint`      | Lint gate for touched files.                           |
| `npm run test:unit` | Full fast unit suite.                                  |
| `npm run test:all`  | unit + module + release before merge-level confidence. |

Runtime bootstrap (`start:api`) and Redis integration (`test:int`) are **not required** to prove AC if unit tests mock `ttl`/`expire` correctly; optional smoke with Redis available: create two sessions with different TTLs (temporary test harness or temporary config) and confirm `GET /v1/sessions` still lists the longer-lived session after the shorter TTL would have expired the index under the old logic. Separate infrastructure unavailability from code failure.

## Acceptance criteria

- **AC-01:** Creating a second session with a shorter TTL does not remove longer-lived sessions from `listByUserId` before their keys expire. _(Verified via unit test asserting index `expire` uses `max(remaining, new)` and does not call `expire` with only the shorter TTL.)_
- **AC-02:** `revokeAll(userId)` deletes every still-valid session key for that user when those sessions were previously indexed. _(Covered by existing `RedisSessionManagementService` + store list/delete behavior once the index is not truncated; no management-service code change expected. Optionally add/adjust a store-level test that after mixed-TTL creates, `listByUserId` still returns both ids so revoke-all can delete both.)_
- **AC-03:** Unit coverage exists for mixed-TTL index behavior.
- **AC-04:** No public HTTP contract change unless intentionally documented — **none planned**.

## Risks

- **Non-atomic `ttl` then `expire`:** concurrent `create` calls could race and still briefly apply a suboptimal TTL. Unlikely to reintroduce systematic shortening if both use `max`; a Lua `EXPIRE` max helper would eliminate the race but is optional hardening (see open questions).
- **`-1` handling:** after first `sadd` on a new key Redis reports TTL `-1`; treating all negative TTLs as “set `ttlSeconds`” is required for correctness. Do not leave new indexes without expiry.
- **Index may outlive members:** `max` can leave the SET key alive after all members expire until index TTL elapses; `listByUserId` already prunes empty/stale members. Acceptable memory trade-off vs orphans.
- **Already-orphaned production keys** are not repaired by this fix.

## Rollback strategy

- Revert the `RedisSessionStore.create` change (and related test/doc edits). No migration to undo. Redis keys remain compatible with the previous SET layout.

## Open questions requiring human decision

1. **Strategy confirmation:** Approve the recommended `max(currentIndexTtl, newTtl)` SET approach, or explicitly request ZSET / no-index-TTL instead (would require a revised plan and likely `RedisService` API changes for ZSET)?
2. **Atomicity:** Is a non-atomic `TTL` + `EXPIRE` pair acceptable for this P1, or should the implementer add a small Lua script via `RedisService.eval` to set expire to `max(current, new)` atomically?
3. **README touch:** Include the optional one-line README key-layout clarification in the same PR, or limit docs to the `ISessionStore` comment only?
4. **Residual orphans:** Accept “no backfill” for indexes already expired in deployed environments, or should a follow-up task define a one-off repair/scan strategy (explicitly out of scope here)?
