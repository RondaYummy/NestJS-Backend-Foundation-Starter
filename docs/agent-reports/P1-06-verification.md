# P1-06 — Independent verification

## Verdict

**approved**

## Scope checked

Staged changes (4 files only; no unstaged production edits):

| File | Planned | Actual |
| ---- | ------- | ------ |
| `apps/api/src/composition/auth-application.module.ts` | Modify | Modified — hoisted `repositoriesModule`, added to Auth imports, reused in composition imports |
| `apps/api/src/composition/auth-application.module.spec.ts` | Create | Created — composition DI regression spec |
| `docs/infrastructure-modules/README.md` | Optional doc note | Modified — positive guidance for `TOKENS.UserRepository` import visibility |
| `docs/agent-reports/P1-06-implementation.md` | N/A (report) | Created — implementer report |

**Out-of-scope files:** none touched. No changes to `AuthModule`, `RepositoriesModule`, `ApiModule`, contracts, or P1-07 scope.

**Deviations from plan:** none material. JWT-driver spec only (session-driver deferred per plan open question). `npm run start:api` not run (optional per plan).

## Root-cause assessment

**Original defect:** `TOKENS.UserRepository` was injected into `AuthModule.forRootAsync` / nested `JwtModule.registerAsync` factories, but `RepositoriesModule.register(...)` was only a sibling import of `AuthApplicationCompositionModule`, not part of the Auth/JWT import subgraph. Nest module encapsulation prevented `JWT_MODULE_OPTIONS` from resolving `Symbol(IUserRepository)`.

**Fix applied:** A single `const repositoriesModule = RepositoriesModule.register({ imports: [drizzleModule] })` is now:

1. Passed into `AuthModule.forRootAsync({ imports: [InfrastructureConfigModule, redisModule, repositoriesModule] })`.
2. Reused in the composition root `imports` array (replacing inline `RepositoriesModule.register(...)`).

**DI chain verified:**

```text
AuthApplicationCompositionModule.register
  -> repositoriesModule (exports TOKENS.UserRepository via RepositoriesModule)
  -> AuthModule.forRootAsync({ imports: [..., repositoriesModule] })
       -> JwtModule.registerAsync({ imports: asyncOptions.imports, inject: same })
            -> JWT_MODULE_OPTIONS factory
                 -> TOKENS.UserRepository resolved ✓
```

`AuthModule.forRootAsync` forwards `asyncOptions.imports` to `JwtModule.registerAsync` (confirmed in `libs/infrastructure/src/auth/auth.module.ts`). `RepositoriesModule` exports `TOKENS.UserRepository` (confirmed in `repositories.module.ts`).

The fix addresses the root cause (module visibility), not a symptom workaround.

## Acceptance criteria matrix

| ID | Criterion | Status | Evidence |
| -- | --------- | ------ | -------- |
| AC-1 | API auth composition bootstrap without DI error for `TOKENS.UserRepository` | **passed** | Targeted spec `compile()` succeeds; `moduleRef.get(TOKENS.UserRepository)` defined |
| AC-2 | `JWT_MODULE_OPTIONS` resolves in Nest runtime | **passed** | `moduleRef.get(JwtService)` defined in spec |
| AC-3 | Single `RepositoriesModule.register(...)` instance per composition root | **passed** | Code review: one `const repositoriesModule` used in both Auth `imports` (line 60) and composition `imports` (line 88) |
| AC-4 | `npm run build:api` passes | **passed** | Exit 0 (independent run) |
| AC-5 | Targeted DI test passes | **passed** | Exit 0 — 1 test passed (independent run) |
| AC-6 | `npm run lint` passes | **passed** | Exit 0 (independent run) |

**Related scenario V-16** (API Auth composition resolves `TOKENS.UserRepository` inside Auth/JWT registration): satisfied by `auth-application.module.spec.ts`.

## Dependency and DI verification

- **Consumer:** `AuthModule.forRootAsync` `useFactory` and nested `JWT_MODULE_OPTIONS` inject `[AppConfigService, TOKENS.UserRepository]`.
- **Provider:** `RepositoriesModule.register` provides `{ provide: TOKENS.UserRepository, useExisting: UserDrizzleRepository }` and exports the token.
- **Composition:** Same dynamic module instance wired into Auth subgraph and composition siblings — use-case factories continue to resolve `TOKENS.UserRepository` from sibling import; Auth/JWT subgraph now also has visibility.
- **Unchanged:** `buildFreshUserResolver`, use-case factory blocks, contracts, public HTTP API.

## Commands executed

| Command | Result | Conclusion |
| ------- | ------ | ---------- |
| `git diff --cached` | 4 files, changes match plan | Scope and implementation confirmed |
| `git status --short` | Only P1-06 files staged | No unrelated changes |
| `npm run test:unit -- apps/api/src/composition/auth-application.module.spec.ts` | Exit 0 — 1 suite, 1 test passed | Composition DI regression passes independently |
| `npm run build:api` | Exit 0 | API compiles |
| `npm run lint` | Exit 0 | No lint errors |
| `npm run test:unit` | Exit 0 — 24 suites, 119 tests passed | Full unit suite green (plan full verification) |

Implementer-reported command results independently reproduced.

## Findings

1. **Root cause fixed** — `RepositoriesModule` is now in the Auth/JWT import graph; targeted compile test would fail on pre-fix wiring.
2. **Scope clean** — only planned files changed; no P1-07 or unrelated edits.
3. **Regression test adequate** — spec mocks `ioredis`, seeds minimal env for `InfrastructureConfigModule`, overrides `AppLogger`, asserts `JwtService`, `TOKENS.UserRepository`, and `TOKENS.AuthTokenService`, and calls `moduleRef.close()`.
4. **Documentation aligned** — `docs/infrastructure-modules/README.md` documents the required import pattern for composition roots injecting `TOKENS.UserRepository`.

No defects or plan violations found.

## Documentation alignment

Optional README note matches implementation. No contradiction between docs and code.

## Remaining risks

- **Session-driver path:** not covered by a dedicated spec; JWT case exercises the same DI visibility defect (acceptable per plan).
- **Drizzle pool lifecycle:** spec calls `moduleRef.close()`; open-handle risk mitigated per existing patterns.

## Unverified areas

- `npm run start:api` with live PostgreSQL + Redis — optional per plan; not required for this DI-only fix.
- `npm run test:int` — not in P1-06 acceptance criteria.
