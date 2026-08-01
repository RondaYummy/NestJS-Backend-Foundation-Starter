# P1-04 — Independent verification

## Verdict

approved

## Scope checked

- **Issue:** P1-04 present in `docs/agent-backlog/INDEX.md` (High / Likely defect) and fully defined in `NESTJS_STARTER_KIT_REQUIRED_FIXES.md` § P1-04.
- **Plan:** `docs/agent-plans/P1-04-atomic-jwt-refresh-family-revoke.md` frontmatter `status: approved`, `issue_id: P1-04`.
- **Working tree (staged):**
  - `libs/infrastructure/src/auth/redis-jwt-token-store.service.ts`
  - `libs/infrastructure/src/auth/redis-jwt-token-store.service.spec.ts`
  - `docs/agent-plans/P1-04-atomic-jwt-refresh-family-revoke.md` (approved plan rewrite)
  - `docs/agent-reports/P1-04-implementation.md`
- **No unrelated production changes:** contracts, `JwtAuthTokenService`, `AuthModule` DI, rotate/save Lua, access-token blacklist, other backlog issues — untouched.
- **Planned symbols handled:** `revokeRefreshTokenFamily` replaced with single `eval`; dead `readUserId` removed; store unit specs rewritten for atomic path + revoke-all `eval` expectations.
- **Deviations (documented, acceptable):**
  - `docs/agent-plans/INDEX.md` not edited (still shows plan row as `proposed` while plan file is `approved`) — human-owned status hygiene; not an implementation defect.
  - `auth.module.spec.ts` is excluded from `test:unit`; verifier ran it via `test:module` (same approach as implementer).

## Root-cause assessment

**Original root cause confirmed addressed.** Pre-fix `revokeRefreshTokenFamily` used sequential TypeScript `GET` → optional record `GET` → `DEL` token → optional `SREM` → `DEL` family, allowing concurrent `rotateRefreshToken` to advance the cursor to token B while revoke still deleted A and then the family key, leaving orphan B.

**Fix:** one Redis Lua script via `RedisService.eval(script, 1, familyKey, familyId)` that, inside a single atomic `EVAL`:

1. derives physical key prefix from `auth:refresh-family:` in `KEYS[1]`;
2. `GET`s family cursor;
3. `DEL`s derived `auth:refresh-token:{tokenId}`;
4. best-effort `cjson.decode` + `SREM` on derived user-index key when `userId` is usable;
5. always `DEL`s the family key (idempotent when cursor missing).

Redis script atomicity closes the orphan-token window: either revoke sees pre-rotate cursor A and deletes A+family before rotate can publish B, or rotate completes first and revoke deletes B+family. Rotate Lua is unchanged.

**Consumer → port → provider chain (unchanged wiring):**

```text
JwtAuthTokenService.rotateAuthSession / revoke / revokeAllForUser
  → IJwtTokenStore.revokeRefreshTokenFamily (contracts; signature unchanged)
    → TOKENS.JwtTokenStore → RedisJwtTokenStore (AuthModule useExisting)
      → RedisService.eval (KEYS prefixed; ARGV familyId not prefixed)
```

## Acceptance criteria matrix

| Criterion                                                                                   | Source       | Result     | Evidence                                                                                                                                  |
| ------------------------------------------------------------------------------------------- | ------------ | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **AC-01** Atomic single `eval` revoke (no TS get/del/srem chain)                            | Issue + plan | **passed** | Implementation only calls `this.redis.eval`; unit tests assert `eval` once and `get`/`del`/`srem` not called                              |
| **AC-02** Rotate + reuse-detection tests still pass; rotate Lua not altered                 | Issue + plan | **passed** | `rotateRefreshToken` script unchanged in diff; `jwt-auth-token.service.spec` + store rotate tests + `auth.module.spec` all passed         |
| **AC-03** Race regression coverage (mock/script acceptable)                                 | Issue + plan | **passed** | Spec asserts revoke is one `eval` with GET-cursor + DEL token + DEL family; rotate remains separate multi-key `eval`                      |
| **AC-04** Port unchanged; no unrelated backlog work                                         | Plan         | **passed** | `IJwtTokenStore.revokeRefreshTokenFamily(familyId: string): Promise<void>` unchanged; staged files limited to P1-04                       |
| **AC-05** `keyPrefix`-safe derivation from `KEYS[1]`                                        | Plan         | **passed** | Lua locates marker and prefixes token/index keys; unit asserts derivation strings; `RedisService.eval` prefixes KEYS only (pre-existing)  |
| **AC-06** P1-02 index `SREM` inside same script; corrupt/missing still deletes token+family | Plan         | **passed** | Script gates `SREM` on successful decode + non-empty `userId`; token `DEL` and family `DEL` remain outside that gate; unit asserts gating |

Issue backlog lists AC-01–AC-03 only; plan AC-04–AC-06 are additional and also **passed**.

## Dependency and DI verification

- `AuthModule` still registers `{ provide: TOKENS.JwtTokenStore, useExisting: RedisJwtTokenStore }` — no DI change required or present.
- Call sites in `jwt-auth-token.service.ts` still call `tokenStore.revokeRefreshTokenFamily(...)` only.
- `revokeAllRefreshTokenFamilies` still loops per-family revoke then deletes the user index (plan out of scope for multi-family single script).
- No contract or HTTP/OpenAPI surface change.

## Commands executed

| Command                                                                                                                       | Result                                                                    | Conclusion                                                                                                |
| ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `git status` / `git diff --cached`                                                                                            | Staged: store + store spec + approved plan + implementation report        | Scope matches P1-04 only                                                                                  |
| `npm run test:unit -- --testPathPatterns="redis-jwt-token-store.service.spec\|jwt-auth-token.service.spec\|auth.module.spec"` | **pass** — 2 suites, 17 tests (`auth.module.spec` ignored by unit config) | Targeted store + JWT auth unit coverage green                                                             |
| `npm run build`                                                                                                               | **pass**                                                                  | Shared infra + all entrypoints compile                                                                    |
| `npm run lint`                                                                                                                | **pass** (`eslint . --max-warnings=0`)                                    | No lint failures in changed code                                                                          |
| `npm run test:unit`                                                                                                           | **pass** — 40 suites, 249 tests                                           | Full unit gate green (Nest ERROR log noise from unrelated mock tests is pre-existing, suite still passed) |
| `npm run test:module -- --testPathPatterns="auth.module.spec"`                                                                | **pass** — 1 suite, 7 tests                                               | Auth module DI wiring unaffected                                                                          |

No Redis integration test required by plan; live concurrent race not executed (optional / residual risk only).

## Findings

1. **No blocking defects.** Atomic Lua revoke correctly addresses the documented orphan-token race.
2. **Minor docs hygiene:** `docs/agent-plans/INDEX.md` still lists P1-04 plan status as `proposed` while the plan file is `approved`. Recommend a human index update; does not affect runtime correctness.
3. **AC-03 depth matches planner recommendation:** coverage is mock/`eval` call-shape + script-content, not multi-client Redis interleaving — explicitly accepted by the approved plan.

## Documentation alignment

- Backlog issue text (token + family delete) is satisfied; post-P1-02 user-index `SREM` is correctly included in the same script per plan AC-06 / open-question recommendation.
- Implementation report accurately describes changed files, commands, and AC self-check; independently re-verified against diff and re-run commands.
- Plan INDEX row status lags plan frontmatter (see Findings).

## Remaining risks

- Unit mocks prove atomic call boundary and script semantics, not live multi-client Redis interleaving (plan residual risk; Redis `EVAL` atomicity mitigates).
- Key-prefix derivation depends on the literal `auth:refresh-family:` marker staying aligned with key helpers.
- `revokeAllRefreshTokenFamilies` remains a per-family loop (out of scope).
- Requires Redis `cjson` (standard for supported builds; plan says stop/revise if missing).

## Unverified areas

- Live Redis concurrent rotate-vs-revoke int-spec (optional in plan; not present).
- API bootstrap smoke (not required; no HTTP contract change).
- End-to-end logout / reuse-detection against a real Redis instance.
