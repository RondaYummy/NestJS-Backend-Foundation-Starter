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

## Current behavior

`RedisJwtTokenStore.revokeRefreshTokenFamily` in `libs/infrastructure/src/auth/redis-jwt-token-store.service.ts` performs three separate Redis round-trips:

1. `GET auth:refresh-family:{familyId}` → current refresh `tokenId`
2. `DEL auth:refresh-token:{tokenId}` (when cursor present)
3. `DEL auth:refresh-family:{familyId}`

By contrast, `saveRefreshToken` and `rotateRefreshToken` in the same class already mutate family + token keys inside a single `redis.eval` Lua script.

Callers (unchanged by this fix):

- `JwtAuthTokenService.rotateAuthSession` — on failed rotate (reuse / revoke detection), calls `revokeRefreshTokenFamily(parsed.familyId)`
- `JwtAuthTokenService.revoke` — logout path calls `revokeRefreshTokenFamily(refreshPayload.familyId)`

Public port `IJwtTokenStore.revokeRefreshTokenFamily(familyId: string): Promise<void>` in `libs/contracts/src/auth/jwt-token-store.service.ts` remains the contract surface.

## Confirmed root cause

Family revoke is a multi-key Redis mutation without a single atomic script/transaction. Concurrent `rotateRefreshToken` vs `revokeRefreshTokenFamily` can tear the family cursor:

**Primary race (orphan refresh token):**

1. Revoke `GET`s family cursor pointing at token **A**
2. Rotate completes atomically: deletes **A**, writes token **B**, sets family → **B**
3. Revoke deletes **A** (already gone) then deletes the family key
4. Token **B** remains in Redis with no family cursor → orphan usable refresh token / inconsistent family state

Atomic rotate alone cannot close this window while revoke remains non-atomic.

## Dependency/runtime flow

```text
API logout / refresh reuse detection
  → JwtAuthTokenService.revoke | rotateAuthSession
    → IJwtTokenStore.revokeRefreshTokenFamily(familyId)
      → RedisJwtTokenStore (RedisService.eval / get / del)
        → Redis keys:
           auth:refresh-family:{familyId}  (cursor = active tokenId)
           auth:refresh-token:{tokenId}    (RefreshTokenRecord JSON)
```

`RedisService.eval` prefixes only `KEYS[...]` via `RedisKeyBuilder.toPhysicalKey`; `ARGV` values are not prefixed. Any Lua that builds the token key from the family cursor must therefore derive the physical token key from `KEYS[1]` (the already-prefixed family key), not hardcode an unprefixed `auth:refresh-token:` string in `ARGV`.

Composition / DI: `AuthModule` registers `RedisJwtTokenStore` as `TOKENS.JwtTokenStore` (`libs/infrastructure/src/auth/auth.module.ts`). No registration change is required.

## Goal

Make `revokeRefreshTokenFamily` a single atomic Redis Lua/`eval` operation that reads the family cursor and deletes the associated refresh-token key and family key together, without changing the public port or regressing atomic rotate / reuse-detection behavior.

## Scope

- Replace the non-atomic GET/DEL/DEL path in `RedisJwtTokenStore.revokeRefreshTokenFamily` with one Lua script executed via `RedisService.eval`.
- Preserve `IJwtTokenStore.revokeRefreshTokenFamily` signature and void return.
- Add unit coverage for the store’s revoke script wiring and race-relevant behavior (mocked `eval`, or equivalent script assertions).
- Re-run existing JWT auth / rotate unit tests to confirm no regression.

## Out of scope

- Changing `rotateRefreshToken` / `saveRefreshToken` Lua scripts (unless a blocker is discovered; then stop and revise this plan).
- Changing `IJwtTokenStore` or `JwtAuthTokenService` orchestration.
- Access-token blacklist (`revokeAccessToken` / `isAccessTokenRevoked`).
- Session-driver auth paths.
- P1-02 (purge families on password change/reset) and other backlog issues.
- Adding a live Redis integration test suite (optional enhancement only; AC-03 allows mock/script coverage).
- Extracting shared Lua script constants/modules across the store (keep local inline scripts consistent with existing save/rotate style).

## Files to create

| Path                                                                 | Responsibility                                                                                                                                                                                                                  |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `libs/infrastructure/src/auth/redis-jwt-token-store.service.spec.ts` | Unit tests for `RedisJwtTokenStore`: assert revoke uses a single `eval`; script reads family cursor and deletes token + family; empty/missing family is safe; document/assert race-relevant script semantics vs rotate (AC-03). |

## Files to modify

| Path                                                            | Symbol / change                                                                                                                                                                                             |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `libs/infrastructure/src/auth/redis-jwt-token-store.service.ts` | `revokeRefreshTokenFamily` — replace sequential `get`/`del` with one Lua `eval` (family key as `KEYS[1]`; derive physical token key from family key + cursor tokenId inside Lua; always delete family key). |
| `docs/agent-plans/INDEX.md`                                     | Register this plan row (`P1-04`, status `proposed`).                                                                                                                                                        |

## Files to delete

None.

## Contract and DI changes

- **Contracts:** none. Keep `IJwtTokenStore.revokeRefreshTokenFamily` as-is.
- **DI / composition:** none. `RedisJwtTokenStore` and `TOKENS.JwtTokenStore` wiring unchanged.
- **Public HTTP API / OpenAPI:** none.

## Implementation steps

1. **Confirm baseline still matches the issue** (already validated at plan time): `revokeRefreshTokenFamily` remains non-atomic GET → optional DEL token → DEL family; save/rotate remain Lua.
2. **Implement atomic revoke Lua** in `RedisJwtTokenStore.revokeRefreshTokenFamily`:
   - Pass `numberOfKeys = 1` and logical `familyKey` (`auth:refresh-family:{familyId}`) so `RedisService.eval` applies the configured key prefix.
   - Script behavior:
     - `GET KEYS[1]` → `currentTokenId`
     - If present, build physical token key by locating the literal marker `auth:refresh-family:` inside `KEYS[1]`, taking the substring before that marker as the Redis key-prefix, then deleting `{prefix}auth:refresh-token:{currentTokenId}`
     - Always `DEL KEYS[1]` (family key), including when cursor is missing (idempotent revoke)
     - Return a simple status (e.g. `1`) for consistency with other scripts; TypeScript may ignore the return value to preserve `Promise<void>`
   - Do **not** pass unprefixed token-key strings in `ARGV` (would break when `RedisModule` `keyPrefix` is set).
3. **Do not change callers** (`JwtAuthTokenService.rotateAuthSession` / `revoke`) or the port.
4. **Add `redis-jwt-token-store.service.spec.ts`**:
   - Mock `RedisService` (`eval`, and ensure `get`/`del` are **not** used by revoke after the fix).
   - AC-01: `revokeRefreshTokenFamily('family-1')` calls `eval` exactly once with `1` key and `auth:refresh-family:family-1`.
   - Assert script text contains `GET` on `KEYS[1]`, deletes a derived `auth:refresh-token:` key, and `DEL`s the family key.
   - AC-03: add at least one test that encodes the race contract in script terms — e.g. assert revoke is a single `eval` (atomic boundary), and optionally assert rotate still uses its own three-key `eval` unchanged; if feasible with a tiny in-memory script interpreter or sequenced mock, demonstrate that revoke no longer issues interleaved `get`/`del` that could observe a mid-rotate cursor. Prefer clear mock assertions over a flaky concurrency harness.
   - Cover missing family cursor (eval still invoked; no TypeScript-side early return that reintroduces multi-round-trip logic).
5. **Regression check for AC-02:** run existing JWT auth unit specs (`jwt-auth-token.service.spec.ts`) and auth module specs; do not weaken rotate success/failure semantics.
6. **Run verification commands** listed below; record results in the implementation report.

## Migration and rollout concerns

- No database migrations.
- No env/config changes.
- Redis data shape unchanged (same key names and cursor value = tokenId).
- Deploy is backward-compatible: old and new revoke both delete the same keys; only atomicity improves.
- No dual-write or feature flag required.

## Targeted verification

```bash
npx jest --config jest.unit.config.ts libs/infrastructure/src/auth/redis-jwt-token-store.service.spec.ts
npx jest --config jest.unit.config.ts libs/infrastructure/src/auth/jwt-auth-token.service.spec.ts
npx jest --config jest.unit.config.ts libs/infrastructure/src/auth/auth.module.spec.ts
npm run build
```

Optional (if Redis is available and implementer adds an int-spec — not required by this plan):

```bash
npm run test:int -- redis-jwt-token-store
```

## Full verification

```bash
npm run build
npm run lint
npm run test:unit
```

If API bootstrap is used for smoke only: no API contract change; bootstrap is optional and not required to prove AC-01–AC-03.

## Acceptance criteria

- **AC-01:** `revokeRefreshTokenFamily` deletes the current family cursor and associated refresh token key atomically via a single Redis script/`eval` path (no sequential TypeScript `get` then `del` then `del`).
- **AC-02:** Existing rotate + reuse-detection related unit tests still pass (`jwt-auth-token.service.spec.ts` and any related auth specs); rotate Lua behavior is not regressively altered.
- **AC-03:** Regression coverage exists for revoke racing with rotate — at minimum store unit tests proving revoke is a single atomic `eval` and asserting script semantics that close the orphan-token window; live concurrent Redis int-spec is optional.
- **AC-04 (plan hygiene):** Public port `IJwtTokenStore.revokeRefreshTokenFamily` signature unchanged; no unrelated backlog work mixed in.
- **AC-05:** With a configured Redis `keyPrefix`, revoke still deletes the correct physical token key (Lua derives prefix from `KEYS[1]`, matching how `eval` prefixes family keys today).

## Risks

- **Key-prefix derivation fragility:** Lua must locate the exact logical marker `auth:refresh-family:` inside the physical family key. If key naming conventions change later, revoke and rotate helpers must stay aligned. Mitigate by keeping `getRefreshFamilyKey` / `getRefreshTokenKey` as the single TypeScript source of logical prefixes and asserting those markers in unit tests.
- **True concurrency not exercised in CI without Redis:** unit mocks prove atomic call shape and script content, not multi-client Redis interleaving. Residual risk is low if the script is a single `EVAL` (Redis guarantees script atomicity).
- **Rotate vs revoke ordering still allows “revoke wins → rotate fails”:** that is intentional (reuse detection / logout). Atomicity prevents the orphan-token outcome, not all concurrent outcomes.

## Rollback strategy

Revert the single-file change to `redis-jwt-token-store.service.ts` (and the new spec file). Behavior falls back to the previous non-atomic revoke; no data migration to undo.

## Open questions requiring human decision

1. **AC-03 depth:** Is mocked single-`eval` + script-content assertion sufficient for human acceptance, or is a live Redis concurrent int-spec required before marking P1-04 done? **Planner recommendation:** accept unit/script coverage as meeting AC-03; treat live Redis race as optional follow-up.
2. **Lua token-key construction approach:** Prefer deriving physical token key from `KEYS[1]` (recommended, prefix-safe) vs extending `RedisService` to expose `toPhysicalKey` for an `ARGV` prefix (broader API surface). **Planner recommendation:** derive from `KEYS[1]`; do not expand `RedisService` for this fix.
