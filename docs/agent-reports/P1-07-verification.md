# P1-07 — Independent verification

## Verdict

**approved**

## Scope checked

| Area                     | Result                                                                                             |
| ------------------------ | -------------------------------------------------------------------------------------------------- |
| Issue ID                 | P1-07 only                                                                                         |
| Plan status              | `docs/agent-plans/P1-07-auth-module-explicit-redis-dependency.md` — `status: approved`             |
| Changed production files | `libs/infrastructure/src/auth/auth.module.ts`, `libs/infrastructure/src/auth/auth.module.spec.ts`  |
| Changed docs             | `docs/infrastructure-modules/README.md`, `EXAMPLES.md`                                             |
| Out-of-scope files       | No changes to `auth-application.module.ts`, `infrastructure.module.ts`, contracts, or P1-06 wiring |
| Unrelated refactors      | None observed                                                                                      |

Implementation matches the approved plan scope. Four planned file groups were touched; composition roots were correctly left unchanged.

## Root-cause assessment

**Original defect:** `AuthModule.forRoot()` registered Redis-backed `RedisJwtTokenStore` / `RedisSessionStore` providers without accepting `RedisModule` in its import contract, causing opaque Nest DI failures when the module was reused in isolation.

**Fix trace (sync path):**

```text
Consumer
  -> AuthModule.forRoot(options, { imports: [redisModule] })
       assertSyncRegistration() — fail-fast if no imports and no custom store
       imports: [redisModule, JwtModule.register(...)]
       providers: [RedisJwtTokenStore | RedisSessionStore, ...]
         -> inject RedisService
              -> resolved from imported redisModule
```

**Fix trace (async path):**

```text
Consumer
  -> AuthModule.forRootAsync({ imports: [redisModule], useFactory, inject })
       assertAsyncRegistration() — fail-fast if imports empty
       buildAsyncDriverProviders useFactory injects RedisService from redisModule
```

The implementation addresses the root cause (hidden Redis dependency) rather than masking it. Registration-time assertions produce actionable errors naming `registration.imports` / `RedisModule` before Nest compile.

## Acceptance criteria matrix

| Criterion                                                                                            | Status     | Evidence                                                                                                                                                                   |
| ---------------------------------------------------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AuthModule.forRoot(authOptions, { imports: [redisModule] })` bootstrap passes                       | **passed** | `auth.module.spec.ts` — JWT and session driver tests compile and resolve `TOKENS.AuthTokenService` via `MockRedisModule`                                                   |
| `AuthModule.forRoot(authOptions)` without required dependency fails fast with clear validation error | **passed** | Negative tests for JWT and session throw at registration time with message matching `/requires RedisModule in registration\.imports/`                                      |
| Redis dependency visible at composition root                                                         | **passed** | `AuthModuleRegistrationOptions.imports` on `forRoot`; `forRootAsync` `imports`; production `auth-application.module.ts` already passes `redisModule` (unchanged)           |
| Docs do not show hidden global dependency pattern                                                    | **passed** | `docs/infrastructure-modules/README.md` shows explicit `redisModule` for both `forRoot` and `forRootAsync`; `EXAMPLES.md` §13 hoists `redisModule` and passes it into Auth |
| `forRootAsync` without `imports` fails fast (plan extension)                                         | **passed** | `assertAsyncRegistration` + negative spec                                                                                                                                  |
| Custom `TOKENS.JwtTokenStore` override without Redis imports (optional)                              | **passed** | Spec compiles and resolves custom store                                                                                                                                    |
| Remove `withMockRedis` post-mutation workaround                                                      | **passed** | Helper removed; all tests use public `imports` API                                                                                                                         |

## Dependency and DI verification

| Check                                                                                     | Result                                                                                                                     |
| ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `AuthModuleRegistrationOptions` exported with `imports` and `providers`                   | Confirmed in `auth.module.ts`                                                                                              |
| `buildSyncDriverProviders` skips default Redis stores when custom store provider supplied | Confirmed — `hasCustomStoreProvider` + conditional provider arrays                                                         |
| `registration.imports` merged before `JwtModule.register`                                 | Confirmed                                                                                                                  |
| `registration.providers` appended before driver providers                                 | Confirmed                                                                                                                  |
| Production composition roots pass `redisModule` to `forRootAsync`                         | Confirmed — `auth-application.module.ts` line 60: `imports: [InfrastructureConfigModule, redisModule, repositoriesModule]` |
| No new injection tokens                                                                   | Confirmed                                                                                                                  |
| Exports unchanged                                                                         | Confirmed — `buildExports` untouched                                                                                       |

**Pre-existing note (not a P1-07 regression):** deprecated `forRootFromAppConfig()` passes `imports: [InfrastructureConfigModule]` only, satisfying `assertAsyncRegistration` (non-empty imports) but still lacking `RedisModule`. This helper was out of scope and remains a known limitation of the deprecated path.

## Commands executed

| Command                                                                     | Result                        | Conclusion                                          |
| --------------------------------------------------------------------------- | ----------------------------- | --------------------------------------------------- |
| `npx jest --config jest.unit.config.ts --testPathPatterns=auth.module.spec` | Exit 0 — 7/7 tests passed     | Targeted AuthModule DI specs pass                   |
| `npm run build`                                                             | Exit 0                        | All entrypoints compile                             |
| `npm run lint`                                                              | Exit 0                        | No lint regressions                                 |
| `npm run test:unit`                                                         | Exit 0 — 123/123 tests passed | Full unit suite green                               |
| `npm run build:api`                                                         | Exit 0                        | API composition graph compiles with unchanged roots |

## Findings

1. **Implementation complete and scoped** — all planned symbols (`AuthModuleRegistrationOptions`, `assertSyncRegistration`, `assertAsyncRegistration`, `hasCustomStoreProvider`, updated `buildSyncDriverProviders`) are present and behave as specified.
2. **Tests demonstrate V-17 contract** — positive isolated bootstrap with explicit `imports`, negative fail-fast, async guard, and custom store override are covered without post-registration module mutation.
3. **Documentation aligned** — README and EXAMPLES no longer imply a hidden global `RedisModule`; they show explicit `imports: [redisModule]`.
4. **Breaking change is intentional** — sync `forRoot(options)` without second argument now throws at registration time; no starter-kit production entrypoint uses sync `forRoot`.

No defects requiring code changes were found.

## Documentation alignment

| Document                                | Alignment                                                                                                                                                          |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `docs/infrastructure-modules/README.md` | Shows `forRoot(..., { imports: [redisModule] })` and `forRootAsync({ imports: [redisModule], ... })`; documents custom store override via `registration.providers` |
| `EXAMPLES.md` §13                       | Hoists `redisModule`, passes to `AuthModule.forRootAsync`, cross-links README                                                                                      |
| Backlog P1-07 acceptance criteria       | All four criteria met                                                                                                                                              |

## Remaining risks

| Risk                                                                             | Severity | Notes                                                                                      |
| -------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------ |
| Breaking change for external sync `forRoot` callers                              | Low      | Intentional; starter-kit uses `forRootAsync`                                               |
| `hasCustomStoreProvider` only detects explicit `{ provide: TOKENS.* }` shapes    | Low      | Documented; `useClass`/`useValue` tested; `useExisting`/`useFactory` not separately tested |
| Deprecated `forRootFromAppConfig` lacks `RedisModule`                            | Low      | Pre-existing; passes async guard via non-empty `InfrastructureConfigModule` import         |
| `assertAsyncRegistration` does not support custom store override without imports | Low      | Async path always constructs Redis stores in factory; consistent with plan                 |

## Unverified areas

| Area                                                                    | Reason                                                                                                                                     |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| V-17 manual bootstrap with real `RedisModule.forRoot(...)` + live Redis | Redis not exercised in this verification run; targeted `MockRedisModule` compile tests provide equivalent DI-graph evidence per plan T3/T4 |

Manual real-Redis bootstrap is optional per the approved plan when infrastructure is unavailable. Targeted unit specs satisfy the portable registration contract acceptance criteria.
