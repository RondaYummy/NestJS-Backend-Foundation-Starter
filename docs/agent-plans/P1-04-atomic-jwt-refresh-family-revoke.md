---
issue_id: P1-04
status: approved
owner: human-approval-required
---

# P1-04 — Make JWT refresh-family revoke atomic

## Source issue

- Backlog index: `docs/agent-backlog/INDEX.md` — **P1-04** (High / Likely defect)
- Full definition: `docs/agent-backlog/NESTJS_STARTER_KIT_REQUIRED_FIXES.md` § P1-04
- Review evidence: `docs/agent-reports/full-review-2026-07-28.md` (non-atomic `revokeRefreshTokenFamily`)
- Post-P1-02 note: `docs/agent-reports/P1-02-implementation.md` explicitly left P1-04 open; single-family revoke gained an extra record `GET` + user-index `SREM` and remains non-atomic

## Current behavior

`RedisJwtTokenStore.revokeRefreshTokenFamily` in `libs/infrastructure/src/auth/redis-jwt-token-store.service.ts` (lines 167–185) performs **multiple sequential Redis round-trips**:

1. `GET auth:refresh-family:{familyId}` → current refresh `tokenId`
2. When cursor present:
   - `GET auth:refresh-token:{tokenId}` → refresh record JSON (to recover `userId`)
   - `DEL auth:refresh-token:{tokenId}`
   - best-effort `SREM auth:refresh-families:user:{userId} {familyId}` (P1-02 index hygiene)
3. `DEL auth:refresh-family:{familyId}` (always)

By contrast, `saveRefreshToken` and `rotateRefreshToken` in the same class already mutate token + family + user-index keys inside a single `redis.eval` Lua script.

Callers (unchanged by this fix):

- `JwtAuthTokenService.rotateAuthSession` — on failed rotate (reuse / revoke detection), calls `revokeRefreshTokenFamily(parsed.familyId)`
- `JwtAuthTokenService.revoke` — logout path calls `revokeRefreshTokenFamily(refreshPayload.familyId)`
- `RedisJwtTokenStore.revokeAllRefreshTokenFamilies` — loops `revokeRefreshTokenFamily` per indexed family, then deletes the user index key

Public port `IJwtTokenStore.revokeRefreshTokenFamily(familyId: string): Promise<void>` in `libs/contracts/src/auth/jwt-token-store.service.ts` remains the contract surface (JSDoc already documents best-effort per-user index removal).

Existing unit coverage in `libs/infrastructure/src/auth/redis-jwt-token-store.service.spec.ts` asserts the **current non-atomic** `get` / `del` / `srem` sequence and must be rewritten for the Lua path.

## Confirmed root cause

Family revoke is a multi-key Redis mutation without a single atomic script/transaction. Concurrent `rotateRefreshToken` vs `revokeRefreshTokenFamily` can tear the family cursor:

**Primary race (orphan refresh token):**

1. Revoke `GET`s family cursor pointing at token **A**
2. Rotate completes atomically: deletes **A**, writes token **B**, sets family → **B**
3. Revoke deletes **A** (already gone), optionally SREMs the index, then deletes the family key
4. Token **B** remains in Redis with no family cursor → orphan usable refresh token / inconsistent family state

Atomic rotate alone cannot close this window while revoke remains non-atomic. P1-02 made the window **wider** (extra `GET` + optional `SREM` between reading the cursor and deleting the family key) but did not change the root cause.

**Re-validation (this planning pass):** root cause **still present** on `main` — `revokeRefreshTokenFamily` still uses `this.redis.get` / `del` / `srem`, not `eval`.

## Dependency/runtime flow

```text
API logout / refresh reuse detection / password-change revoke-all
  → JwtAuthTokenService.revoke | rotateAuthSession | revokeAllForUser
    → IJwtTokenStore.revokeRefreshTokenFamily(familyId)
      → RedisJwtTokenStore (today: get/del/srem; target: RedisService.eval)
        → Redis keys:
           auth:refresh-family:{familyId}              (cursor = active tokenId)
           auth:refresh-token:{tokenId}                (RefreshTokenRecord JSON)
           auth:refresh-families:user:{userId}         (SET of familyId; P1-02)
```

`RedisService.eval` prefixes only `KEYS[...]` via `RedisKeyBuilder.toPhysicalKey`; `ARGV` values are not prefixed. Any Lua that builds token / user-index keys from the family cursor or JSON `userId` must therefore derive the physical key prefix from `KEYS[1]` (the already-prefixed family key), not hardcode unprefixed `auth:refresh-token:` / `auth:refresh-families:user:` strings as if they were already physical.

Composition / DI: `AuthModule` registers `RedisJwtTokenStore` as `TOKENS.JwtTokenStore` (`libs/infrastructure/src/auth/auth.module.ts`). No registration change is required.

## Goal

Make `revokeRefreshTokenFamily` a single atomic Redis Lua/`eval` operation that reads the family cursor, deletes the associated refresh-token key and family key together, and preserves P1-02 best-effort removal of `familyId` from the per-user index when `userId` can be recovered from the token record — without changing the public port or regressing atomic rotate / reuse-detection behavior.

## Scope

- Replace the non-atomic GET/GET/DEL/SREM/DEL path in `RedisJwtTokenStore.revokeRefreshTokenFamily` with one Lua script executed via `RedisService.eval`.
- Preserve `IJwtTokenStore.revokeRefreshTokenFamily` signature and void return.
- Preserve P1-02 semantics: when the refresh-token record yields a non-empty `userId`, `SREM` that `familyId` from `auth:refresh-families:user:{userId}` **inside the same script**.
- Update existing store unit tests (and add race-relevant script assertions) for the atomic path.
- Re-run existing JWT auth / rotate unit tests to confirm no regression.

## Out of scope

- Changing `rotateRefreshToken` / `saveRefreshToken` Lua scripts (unless a blocker is discovered; then stop and revise this plan).
- Changing `IJwtTokenStore` or `JwtAuthTokenService` orchestration.
- Making `revokeAllRefreshTokenFamilies` itself a single multi-family Lua script (it may keep looping atomic per-family revoke + final index `DEL`).
- Access-token blacklist (`revokeAccessToken` / `isAccessTokenRevoked`).
- Session-driver auth paths.
- P1-03 (idempotency lock loss) and other backlog issues.
- Adding a live Redis integration test suite (optional enhancement only; AC-03 allows mock/script coverage).
- Extracting shared Lua script constants/modules across the store (keep local inline scripts consistent with existing save/rotate style).
- Redis Cluster hash-slot redesign (save/rotate already touch cross-slot keys; same residual constraint).

## Files to create

None. The store unit spec already exists at `libs/infrastructure/src/auth/redis-jwt-token-store.service.spec.ts` (added by P1-02).

## Files to modify

| Path                                                                 | Symbol / change                                                                                                                                                                                                                                                                                                                        |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `libs/infrastructure/src/auth/redis-jwt-token-store.service.ts`      | `revokeRefreshTokenFamily` — replace sequential `get`/`del`/`srem` with one Lua `eval` (family key as `KEYS[1]`; derive physical token + user-index keys from family-key prefix + cursor/`userId`; always delete family key; best-effort `SREM` when record has `userId`). Remove `readUserId` if it becomes dead code after the move. |
| `libs/infrastructure/src/auth/redis-jwt-token-store.service.spec.ts` | Rewrite `revokeRefreshTokenFamily*` expectations for single `eval`; update `revokeAllRefreshTokenFamilies*` so per-family revoke is asserted via `eval` (not interleaved `get`/`del`); add AC-01 / AC-03 / key-prefix script assertions.                                                                                               |
| `docs/agent-plans/INDEX.md`                                          | Keep the **P1-04** row; ensure status remains `proposed` (already listed). No other plan rows.                                                                                                                                                                                                                                         |

## Files to delete

None (unless `readUserId` is inlined solely for the old TypeScript path — then delete that private method only as dead-code cleanup tied to this change).

## Contract and DI changes

- **Contracts:** none. Keep `IJwtTokenStore.revokeRefreshTokenFamily` as-is (including JSDoc about best-effort index removal).
- **DI / composition:** none. `RedisJwtTokenStore` and `TOKENS.JwtTokenStore` wiring unchanged.
- **Public HTTP API / OpenAPI:** none.

## Implementation steps

1. **Confirm baseline still matches the issue** (re-validated at this plan time): `revokeRefreshTokenFamily` remains non-atomic GET → optional GET record → DEL token → optional SREM → DEL family; save/rotate remain Lua.
2. **Implement atomic revoke Lua** in `RedisJwtTokenStore.revokeRefreshTokenFamily`:
   - Pass `numberOfKeys = 1` and logical `familyKey` (`auth:refresh-family:{familyId}`) so `RedisService.eval` applies the configured key prefix.
   - Pass `familyId` as `ARGV[1]` for the `SREM` member (ARGV is not key-prefixed — correct for a SET member).
   - Script behavior:
     - Locate the literal marker `auth:refresh-family:` inside `KEYS[1]`; substring before the marker is the Redis key-prefix (empty when no module prefix).
     - `GET KEYS[1]` → `currentTokenId`
     - If present: derive `{prefix}auth:refresh-token:{currentTokenId}`, `GET` the record, `DEL` the token key; if JSON decodes (`cjson.decode` via `pcall`) with a non-empty string `userId`, `SREM {prefix}auth:refresh-families:user:{userId} ARGV[1]`
     - Always `DEL KEYS[1]` (family key), including when cursor is missing (idempotent revoke)
     - If marker is missing (should not happen with current key helpers): still `DEL KEYS[1]` and return a failure status — do not invent alternate key schemes
     - Return a simple status (e.g. `1`) for consistency with other scripts; TypeScript may ignore the return value to preserve `Promise<void>`
   - Do **not** pass unprefixed token-key or index-key strings in `ARGV` (would break when `RedisModule` `keyPrefix` is set).
   - Do **not** reintroduce TypeScript-side `get`/`del`/`srem` around the script (that would reopen the race and defeat AC-01).
3. **Do not change callers** (`JwtAuthTokenService.rotateAuthSession` / `revoke` / `revokeAllForUser`) or the port.
4. **Update `redis-jwt-token-store.service.spec.ts`**:
   - Mock `RedisService` (`eval`, and ensure `get`/`del`/`srem` are **not** used by `revokeRefreshTokenFamily` after the fix).
   - AC-01: `revokeRefreshTokenFamily('family-1')` calls `eval` exactly once with `1` key and `auth:refresh-family:family-1`, and `ARGV` containing `family-1`.
   - Assert script text: `GET` on `KEYS[1]`; deletes a derived `auth:refresh-token:` key; `cjson.decode` (or equivalent) + `SREM` on derived `auth:refresh-families:user:`; always `DEL`s the family key.
   - Preserve P1-02 coverage intent: script includes best-effort index `SREM`; missing/corrupt record still deletes token + family without requiring `SREM`.
   - AC-03: at least one test that encodes the race contract in script terms — e.g. assert revoke is a single `eval` (atomic boundary), and that rotate still uses its own multi-key `eval` unchanged; prefer clear mock/script assertions over a flaky concurrency harness.
   - Update `revokeAllRefreshTokenFamilies` tests to expect per-family `eval` + final index `del`, not the old `get`/`del` chain.
5. **Regression check for AC-02:** run existing JWT auth unit specs (`jwt-auth-token.service.spec.ts`) and auth module specs; do not weaken rotate success/failure semantics.
6. **Run verification commands** listed below; record results in the implementation report.

## Migration and rollout concerns

- No database migrations.
- No env/config changes.
- Redis data shape unchanged (same key names; family cursor value = tokenId; user index SET membership unchanged).
- Deploy is backward-compatible: old and new revoke delete the same keys and attempt the same index `SREM`; only atomicity improves.
- No dual-write or feature flag required.
- Requires Redis Lua `cjson` (standard in supported Redis builds used with ioredis). If a target Redis build lacked `cjson`, stop and revise — do not silently drop index cleanup.

## Targeted verification

```bash
npm run test:unit -- --testPathPatterns="redis-jwt-token-store.service.spec|jwt-auth-token.service.spec|auth.module.spec"
npm run build
```

Optional (if Redis is available and implementer adds an int-spec — not required by this plan):

```bash
npm run test:int -- --testPathPatterns="redis-jwt-token-store"
```

## Full verification

```bash
npm run build
npm run lint
npm run test:unit
```

If API bootstrap is used for smoke only: no API contract change; bootstrap is optional and not required to prove AC-01–AC-03.

## Acceptance criteria

- **AC-01:** `revokeRefreshTokenFamily` deletes the current family cursor and associated refresh token key atomically via a single Redis script/`eval` path (no sequential TypeScript `get` then `del` then `del`, and no TypeScript `srem` outside that script).
- **AC-02:** Existing rotate + reuse-detection related unit tests still pass (`jwt-auth-token.service.spec.ts` and related auth specs); rotate Lua behavior is not regressively altered.
- **AC-03:** Regression coverage exists for revoke racing with rotate — at minimum store unit tests proving revoke is a single atomic `eval` and asserting script semantics that close the orphan-token window; live concurrent Redis int-spec is optional.
- **AC-04 (plan hygiene):** Public port `IJwtTokenStore.revokeRefreshTokenFamily` signature unchanged; no unrelated backlog work mixed in.
- **AC-05:** With a configured Redis `keyPrefix`, revoke still deletes the correct physical token key and SREMs the correct physical user-index key (Lua derives prefix from `KEYS[1]`, matching how `eval` prefixes family keys today).
- **AC-06 (P1-02 non-regression):** When the refresh-token record contains a usable `userId`, the same atomic script removes `familyId` from `auth:refresh-families:user:{userId}`; missing/corrupt records still delete token + family keys without failing the revoke.

## Risks

- **Key-prefix derivation fragility:** Lua must locate the exact logical marker `auth:refresh-family:` inside the physical family key. If key naming conventions change later, revoke helpers must stay aligned with `getRefreshFamilyKey` / `getRefreshTokenKey` / `getUserFamilyIndexKey`. Mitigate by asserting those markers in unit tests.
- **JSON parsing in Lua:** `cjson.decode` must tolerate corrupt records via `pcall` (match today’s try/catch `readUserId` behavior). A decode bug that throws uncaught would fail the whole revoke — use `pcall` and still delete family/token keys.
- **True concurrency not exercised in CI without Redis:** unit mocks prove atomic call shape and script content, not multi-client Redis interleaving. Residual risk is low if the script is a single `EVAL` (Redis guarantees script atomicity).
- **Rotate vs revoke ordering still allows “revoke wins → rotate fails”:** that is intentional (reuse detection / logout). Atomicity prevents the orphan-token outcome, not all concurrent outcomes.
- **`revokeAllRefreshTokenFamilies` remains a loop:** concurrent rotate against a _different_ family than the one currently being revoked is fine; the per-family race is closed by this fix. Making revoke-all one giant script is out of scope.

## Rollback strategy

Revert the change to `redis-jwt-token-store.service.ts` and the corresponding spec updates. Behavior falls back to the previous non-atomic revoke; no data migration to undo.

## Open questions requiring human decision

1. **AC-03 depth:** Is mocked single-`eval` + script-content assertion sufficient for human acceptance, or is a live Redis concurrent int-spec required before marking P1-04 done? **Planner recommendation:** accept unit/script coverage as meeting AC-03; treat live Redis race as optional follow-up.
2. **Lua token/index key construction approach:** Prefer deriving physical keys from `KEYS[1]` (recommended, prefix-safe) vs extending `RedisService` to expose `toPhysicalKey` for ARGV prefixes (broader API surface). **Planner recommendation:** derive from `KEYS[1]`; do not expand `RedisService` for this fix.
3. **Index `SREM` inside the atomic script:** Backlog § P1-04 text mentions token + family only; post-P1-02 code also SREMs the user index. **Planner recommendation:** include best-effort `SREM` in the same Lua script (AC-06) so logout/reuse-detection do not reintroduce multi-round-trip races or regress index hygiene. Confirm if humans prefer dropping index cleanup from the atomic path (not recommended).

## Planning notes (supersedes prior approved draft)

- A prior plan at this path had `status: approved` but described pre-P1-02 revoke (`GET` → `DEL` token → `DEL` family only) and listed the store spec as a file **to create**.
- This rewrite resets status to **`proposed`** for fresh human approval against current `main`.
- Material deltas vs that draft: existing `redis-jwt-token-store.service.spec.ts`; user-index `GET`+`SREM` must move into Lua; `revokeAll*` tests need `eval` expectations; Jest selection uses `--testPathPatterns` (Jest 30).
