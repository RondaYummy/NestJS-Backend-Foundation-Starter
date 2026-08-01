# NestJS Starter Kit — required fixes

This file is the source of truth for confirmed bugfix issues.

**Baseline evidence:** `docs/agent-reports/full-review-2026-07-28.md` (branch `main`, 2026-07-28).

## Issue template

```markdown
## P0-00. Short issue title

**Severity:** Critical | High | Medium | Low
**Classification:** Confirmed defect

### Evidence

### Root cause

### Required change

### Acceptance criteria
```

Add an issue here only after reproducing it in the current branch. Add the same stable ID to `INDEX.md`, then follow the planning, approval, implementation and independent-verification workflow from `AGENTS.md`.

---

# Priority backlog

## P1 — High

| ID      | Classification   | Title                                                                  |
| ------- | ---------------- | ---------------------------------------------------------------------- |
| `P1-01` | Confirmed defect | Fix Redis session user-index TTL overwrite                             |
| `P1-02` | Confirmed defect | Purge Redis sessions and JWT refresh families on password change/reset |
| `P1-03` | Confirmed defect | Harden idempotency so side effects are not re-run after lock loss      |
| `P1-04` | Likely defect    | Make JWT refresh-family revoke atomic                                  |

---

## P1-01. Fix Redis session user-index TTL overwrite

**Severity:** High  
**Classification:** Confirmed defect  
**Source:** full-review-2026-07-28

### Evidence

- `libs/infrastructure/src/auth/redis-session-store.service.ts` — `RedisSessionStore.create`
- After `sadd(userIndexKey, sessionId)` the store always calls `expire(userIndexKey, ttlSeconds)` using only the **new** session TTL.
- Session list/revoke flows depend on that index: `listByUserId` → `RedisSessionManagementService.listForUser` / `revokeAll` / `revokeOthers`.
- Direct cookie auth via `get(sessionId)` still works when the index key expires early, so devices remain authenticated while invisible to management APIs.

```ts
await this.redisService.set(sessionKey, JSON.stringify(record), ttlSeconds);
await this.redisService.sadd(userIndexKey, sessionId);
await this.redisService.expire(userIndexKey, ttlSeconds);
```

### Root cause

User-index TTL is set to the newest member’s TTL instead of the maximum remaining TTL among index members (or an equivalent durable index strategy). A shorter-lived session (or any future caller with a smaller TTL) can expire the index while longer-lived session keys remain.

### Required change

1. Stop blindly applying `EXPIRE` with the latest session TTL.
2. Prefer one of: ZSET scored by absolute expiry; `EXPIRE` to `max(currentIndexTtl, newTtl)`; no index TTL + prune-on-read.
3. Ensure `listByUserId` / `revokeAll` / `revokeOthers` remain correct under mixed TTLs.
4. Add unit tests covering two sessions with different TTLs where the shorter one must not drop the longer one from the index.

### Acceptance criteria

- **AC-01:** Creating a second session with a shorter TTL does not remove longer-lived sessions from `listByUserId` before their keys expire.
- **AC-02:** `revokeAll(userId)` deletes every still-valid session key for that user when those sessions were previously indexed.
- **AC-03:** Unit coverage exists for mixed-TTL index behavior.
- **AC-04:** No public HTTP contract change unless intentionally documented.

---

## P1-02. Purge Redis sessions and JWT refresh families on password change/reset

**Severity:** High  
**Classification:** Confirmed defect  
**Source:** full-review-2026-07-28

### Evidence

- `libs/domain/src/entities/user.entity.ts` — `User.changePassword` bumps `authVersion`.
- `libs/application/src/use-cases/auth/change-password.usecase.ts` — updates user + `createAuthSession` only; no session/JWT family purge.
- `libs/application/src/use-cases/auth/reset-password.usecase.ts` — same pattern.
- Verification rejects stale credentials when `resolveAccessUser` / `resolveSessionUser` are wired, but:
  - old session records remain in Redis and can still appear in `GET /v1/sessions`;
  - `revokeAll` cannot delete index-orphaned sessions (amplifies P1-01);
  - JWT refresh family keys linger until TTL;
  - portable consumers that omit `resolveAccessUser` keep accepting old access JWTs until expiry.

### Root cause

Password-credential rotation relies solely on `authVersion` freshness checks and does not eagerly revoke stored session/refresh artifacts. Session listing and bulk revoke APIs therefore diverge from “all prior credentials are dead” product expectation after password change/reset.

### Required change

1. After successful password change and reset, eagerly revoke prior auth artifacts for that user:
   - session driver: revoke all sessions for the user (via `ISessionManagementService` / store), then issue the new session;
   - JWT driver: revoke all refresh families (and optionally denylist outstanding access `jti` if already supported) before issuing new tokens.
2. Extend contracts/stores if a user→refresh-family index (or equivalent) is missing today — do not leave “revoke all families for user” unimplemented.
3. Ensure list endpoints do not return sessions whose `authVersion` is stale, even if Redis keys linger briefly.
4. Keep `authVersion` bump behavior; do not replace it with purge-only.
5. Update unit tests for change-password and reset-password use cases for both drivers where applicable.
6. Align OpenAPI/README wording if it currently implies only `authVersion` without store cleanup.

### Acceptance criteria

- **AC-01:** After change-password, prior session IDs fail verification and no longer appear as active in session list (session driver).
- **AC-02:** After change-password / reset-password, prior refresh tokens cannot rotate (JWT driver).
- **AC-03:** Newly issued auth artifacts from the same response remain valid.
- **AC-04:** Unit tests cover purge + re-issue for change-password and reset-password.
- **AC-05:** Docs/OpenAPI do not claim cleanup that the code does not perform (or vice versa).

---

## P1-03. Harden idempotency so side effects are not re-run after lock loss

**Severity:** High  
**Classification:** Confirmed defect  
**Source:** full-review-2026-07-28

### Evidence

- `libs/infrastructure/src/idempotency/idempotency.service.ts` — `RedisIdempotencyService.execute`
- Flow: acquire lock → run `handler()` → if `lockLost` or `completeIdempotency` fails → throw `IDEMPOTENCY_LOCK_LOST` without caching the result; `finally` may release the lock.
- `EXAMPLES.md` advertises idempotency for POST/PUT/PATCH as a reusable starter pattern.

### Root cause

The side-effecting handler can complete successfully while the outcome is not durably stored under the idempotency key. A client retry with the same key then re-enters the handler.

### Required change

1. Close the “success without stored result” window as far as Redis semantics allow, for example:
   - extend lock TTL / heartbeat relative to handler SLA;
   - on lock-lost after successful handler, attempt best-effort result persistence or return a conflict that must not be blindly retried as a new execution;
   - and/or reserve/complete semantics that make duplicate execution detectable.
2. Document exact client retry semantics (when safe to retry, when to treat as unknown outcome).
3. Add unit tests for: lock lost after handler success; successful complete; hash collision path unchanged.
4. Do not weaken fail-closed Redis error behavior into silent fail-open.

### Acceptance criteria

- **AC-01:** A simulated lock-loss after a successful handler does not allow a second handler execution for the same key+hash without an explicit, documented conflict/unknown outcome.
- **AC-02:** Happy-path idempotent replay returns the stored result without re-running the handler.
- **AC-03:** Unit tests cover lock-loss-after-success and happy-path replay.
- **AC-04:** `EXAMPLES.md` (or equivalent) states the retry contract accurately.

---

## P1-04. Make JWT refresh-family revoke atomic

**Severity:** High  
**Classification:** Likely defect  
**Source:** full-review-2026-07-28

### Evidence

- `libs/infrastructure/src/auth/redis-jwt-token-store.service.ts` — `revokeRefreshTokenFamily`
- Implementation is sequential non-atomic: `GET` family → `DEL` token key → `DEL` family key.
- Contrast: `rotateRefreshToken` / `saveRefreshToken` already use Lua for atomicity.
- Callers include reuse detection and logout paths in `JwtAuthTokenService`.

### Root cause

Family revoke is a multi-key Redis mutation without a single atomic script/transaction, so concurrent rotate + revoke can leave an orphan refresh token key or a torn family cursor.

### Required change

1. Replace `revokeRefreshTokenFamily` with a single Lua (or equivalent atomic) operation that reads the family cursor and deletes token + family keys together.
2. Preserve current public port `IJwtTokenStore.revokeRefreshTokenFamily`.
3. Add unit/integration-style Redis mock or script tests for concurrent rotate vs revoke where feasible.
4. Do not regress atomic rotate/reuse detection behavior.

### Acceptance criteria

- **AC-01:** `revokeRefreshTokenFamily` deletes the current family cursor and associated refresh token key atomically (single Redis script/eval path).
- **AC-02:** Existing rotate + reuse-detection tests still pass.
- **AC-03:** Regression coverage exists for revoke racing with rotate (or documented equivalent mock of atomic script behavior).

---
