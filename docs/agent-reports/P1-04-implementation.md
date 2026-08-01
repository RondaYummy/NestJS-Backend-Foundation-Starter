# P1-04 — Implementation report

## Verdict

implemented

## Approved plan

- Plan: `docs/agent-plans/P1-04-atomic-jwt-refresh-family-revoke.md` (frontmatter `status: approved`, `issue_id: P1-04`)
- Source issue: `docs/agent-backlog/INDEX.md` → **P1-04** (High / Likely defect), definition in `docs/agent-backlog/NESTJS_STARTER_KIT_REQUIRED_FIXES.md` § P1-04
- Branch state before implementation: staged plan-only change under `docs/agent-plans/P1-04-atomic-jwt-refresh-family-revoke.md`; production `revokeRefreshTokenFamily` still used sequential `get` / `del` / `srem`
- Backlog issue status and plan status were **not** modified
- Open-question recommendations followed: unit/script coverage for AC-03; derive physical keys from `KEYS[1]` (no `RedisService` API expansion); keep best-effort index `SREM` inside the same Lua script (AC-06)

## Changed files

### Created

| Path                                         | Purpose                    |
| -------------------------------------------- | -------------------------- |
| `docs/agent-reports/P1-04-implementation.md` | This implementation report |

### Modified

| Path                                                                 | Change                                                                                                                  |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `libs/infrastructure/src/auth/redis-jwt-token-store.service.ts`      | `revokeRefreshTokenFamily` → single Lua `eval`; removed dead `readUserId` helper and unused `RefreshTokenRecord` import |
| `libs/infrastructure/src/auth/redis-jwt-token-store.service.spec.ts` | Rewrote revoke / revoke-all expectations for single `eval`; added AC-01 / AC-03 / AC-05 / AC-06 script assertions       |

`docs/agent-plans/INDEX.md` was not edited (row already present; implementer does not change plan/index status). `package-lock.json`, contracts, DI, and JWT auth service callers were not changed.

## Completed steps

1. **Revalidated baseline** — Confirmed non-atomic `GET` family → optional `GET` record → `DEL` token → optional `SREM` → `DEL` family still present; save/rotate already Lua; port signature unchanged.
2. **Atomic revoke Lua** — One `redis.eval` with `numberOfKeys = 1` (logical family key) and `ARGV[1] = familyId`. Script derives Redis key-prefix from `auth:refresh-family:` marker in `KEYS[1]`, GETs cursor, DELs derived token key, best-effort `cjson.decode` + `SREM` on derived user-index key, always DELs family key (idempotent when cursor missing). Missing marker: DEL family key and return `0`.
3. **Dead-code cleanup** — Removed `readUserId` (only used by the old TypeScript path).
4. **Unit tests** — Assert single `eval`, no TypeScript `get`/`del`/`srem` on revoke; script content for prefix derivation, SREM gating, and rotate-vs-revoke atomic boundaries; `revokeAllRefreshTokenFamilies` expects per-family `eval` + final index `del`.
5. **Verification** — Targeted store/JWT unit specs, auth module specs, full `build` / `lint` / `test:unit`.

## Deviations

None material.

- `auth.module.spec.ts` is excluded from `test:unit` (`testPathIgnorePatterns: '\\.module\\.spec\\.ts$'`). Ran it via `npm run test:module -- --testPathPatterns="auth.module.spec"` instead of relying on the plan’s `test:unit` pattern alone.
- Did not modify `docs/agent-plans/INDEX.md` (plan listed “status remains proposed”; plan is already `approved` and status changes are human-owned).

## Commands executed

| Command                                                                                                                       | Purpose                                              |
| ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `git status` / `git diff` (before)                                                                                            | Confirm clean production tree aside from staged plan |
| `npm run test:unit -- --testPathPatterns="redis-jwt-token-store.service.spec\|jwt-auth-token.service.spec\|auth.module.spec"` | Targeted verification (plan)                         |
| `npm run build`                                                                                                               | Full workspace compile                               |
| `npm run lint`                                                                                                                | ESLint gate                                          |
| `npm run test:unit`                                                                                                           | Full unit gate                                       |
| `npm run test:module -- --testPathPatterns="auth.module.spec"`                                                                | Auth module regression (AC-02)                       |
| `git status` / `git diff` (after)                                                                                             | Confirm only intended files changed                  |

## Command results

| Command                                    | Result                                                                    | Conclusion                             |
| ------------------------------------------ | ------------------------------------------------------------------------- | -------------------------------------- |
| Pre-impl `git status`                      | Staged plan only                                                          | Safe to implement                      |
| Targeted `test:unit` patterns              | **pass** — 2 suites, 17 tests (`auth.module.spec` ignored by unit config) | Store + JWT auth unit coverage green   |
| `npm run build`                            | **pass**                                                                  | Shared infra + all entrypoints compile |
| `npm run lint`                             | **pass**                                                                  | No lint debt in changed files          |
| `npm run test:unit`                        | **pass** — 40 suites, 249 tests                                           | Full unit gate green                   |
| `npm run test:module` (`auth.module.spec`) | **pass** — 1 suite, 7 tests                                               | Auth DI/module wiring unaffected       |
| Post-impl `git diff`                       | Only store + store spec (+ staged plan + this report)                     | Scope matched plan                     |

## Acceptance criteria self-check

| Criterion                                        | Status  | Evidence                                                                                                             |
| ------------------------------------------------ | ------- | -------------------------------------------------------------------------------------------------------------------- |
| **AC-01** Atomic single `eval` revoke            | **met** | `revokeRefreshTokenFamily` only calls `this.redis.eval`; specs assert no TS `get`/`del`/`srem`                       |
| **AC-02** Rotate / reuse-detection not regressed | **met** | `jwt-auth-token.service.spec` + `auth.module.spec` passed; rotate Lua untouched                                      |
| **AC-03** Race regression coverage               | **met** | Spec asserts revoke is one `eval` with GET-cursor + DEL token + DEL family; rotate remains separate multi-key `eval` |
| **AC-04** Port unchanged / no scope mix          | **met** | `IJwtTokenStore.revokeRefreshTokenFamily` signature unchanged; no other backlog work                                 |
| **AC-05** `keyPrefix`-safe key derivation        | **met** | Lua locates `auth:refresh-family:` in `KEYS[1]` and prefixes token/index keys; unit asserts derivation               |
| **AC-06** P1-02 index `SREM` non-regression      | **met** | Same script SREMs when `userId` decodes; corrupt/missing record still DELs token + family                            |

## Remaining risks

- Unit mocks prove atomic call shape and script content, not multi-client Redis interleaving (plan residual risk; live int-spec optional).
- Key-prefix derivation depends on the `auth:refresh-family:` marker staying aligned with key helpers.
- `revokeAllRefreshTokenFamilies` remains a per-family loop (out of scope); per-family orphan race is closed.

## Unverified areas

- Live Redis concurrent rotate-vs-revoke int-spec (explicitly optional in plan).
- API bootstrap smoke (not required; no HTTP contract change).
- Redis builds without `cjson` (unsupported by plan; stop/revise if encountered in a target environment).
