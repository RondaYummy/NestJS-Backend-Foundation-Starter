# P1-07 — Implementation report

## Verdict

implemented

## Approved plan

`docs/agent-plans/P1-07-auth-module-explicit-redis-dependency.md` (`status: approved`)

## Changed files

| File                                               | Change                                                                                                                                                                                                                                                                           |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `libs/infrastructure/src/auth/auth.module.ts`      | Added `AuthModuleRegistrationOptions`; extended `forRoot(options, registration?)`; added `assertSyncRegistration`, `assertAsyncRegistration`, `hasCustomStoreProvider`; updated `buildSyncDriverProviders` to skip default Redis stores when custom store providers are supplied |
| `libs/infrastructure/src/auth/auth.module.spec.ts` | Removed `withMockRedis` post-mutation workaround; added fail-fast and custom-store tests; updated positive tests to use public `imports` API                                                                                                                                     |
| `docs/infrastructure-modules/README.md`            | Auth examples now show explicit `redisModule` in `imports` for both `forRoot` and `forRootAsync`                                                                                                                                                                                 |
| `EXAMPLES.md`                                      | §13 standalone example hoists `redisModule` and passes it into `AuthModule.forRootAsync`                                                                                                                                                                                         |

## Completed steps

1. Defined `AuthModuleRegistrationOptions` with `imports` and `providers`.
2. Extended `AuthModule.forRoot` to merge `registration.imports`, append `registration.providers`, and call `assertSyncRegistration` before returning the dynamic module.
3. Updated `buildSyncDriverProviders` to accept registration context and omit `RedisJwtTokenStore` / `RedisSessionStore` when a custom `TOKENS.JwtTokenStore` or `TOKENS.SessionStore` provider is supplied.
4. Added `assertAsyncRegistration` to `forRootAsync` — fails fast when `imports` is empty.
5. Rewrote unit tests to use the public API; added negative fail-fast tests and a custom `JwtTokenStore` override test.
6. Updated `docs/infrastructure-modules/README.md` and `EXAMPLES.md` with explicit Redis dependency wiring.

## Deviations

None. Composition roots (`auth-application.module.ts`, `infrastructure.module.ts`) were unchanged — they already pass `redisModule` to `forRootAsync`.

## Commands executed

| Command                                                                     | Result                        |
| --------------------------------------------------------------------------- | ----------------------------- |
| `npx jest --config jest.unit.config.ts --testPathPatterns=auth.module.spec` | Exit 0 — 7/7 tests passed     |
| `npm run build`                                                             | Exit 0                        |
| `npm run lint`                                                              | Exit 0                        |
| `npm run test:unit`                                                         | Exit 0 — 123/123 tests passed |
| `npm run build:api`                                                         | Exit 0                        |

## Command results

All targeted and full verification commands passed. No infrastructure bootstrap (V-17 manual Redis scenario) was run — targeted DI specs provide equivalent compile-time evidence with `MockRedisModule`.

## Acceptance criteria self-check

| Criterion                                                                                            | Status                                                                                                          |
| ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `AuthModule.forRoot(authOptions, { imports: [redisModule] })` bootstrap passes                       | Met — JWT and session driver positive tests compile and resolve `TOKENS.AuthTokenService`                       |
| `AuthModule.forRoot(authOptions)` without required dependency fails fast with clear validation error | Met — registration-time `Error` references `registration.imports` and `RedisModule` for JWT and session drivers |
| Redis dependency visible at composition root                                                         | Met — `forRoot` second argument and docs examples show explicit `imports: [redisModule]`                        |
| Docs do not show hidden global dependency pattern                                                    | Met — README and EXAMPLES.md updated                                                                            |
| `forRootAsync` without `imports` fails fast                                                          | Met — added `assertAsyncRegistration` and spec coverage                                                         |

## Remaining risks

- **Breaking change** for external consumers calling `AuthModule.forRoot(options)` without `registration.imports` — intentional per plan; no starter-kit production entrypoint uses sync `forRoot`.
- **`hasCustomStoreProvider`** detects only explicit `{ provide: TOKENS.* }` object providers; `useExisting` / `useFactory` override shapes are documented but not separately tested.
- **Deprecated `forRootFromAppConfig`** still passes only `InfrastructureConfigModule` in `imports` (non-empty, so no fail-fast) but lacks `RedisModule` — pre-existing limitation of the deprecated helper.

## Unverified areas

- V-17 manual runtime bootstrap with real `RedisModule.forRoot(...)` + `AuthModule.forRoot(..., { imports: [redisModule] })` when PostgreSQL/Redis are available locally.
- Independent verification (V-17) not yet performed.
