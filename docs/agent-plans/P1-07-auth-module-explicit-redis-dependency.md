---
issue_id: P1-07
status: approved
owner: human-approval-required
---

# P1-07 — Make `AuthModule.forRoot()` explicit about Redis dependency and independent reuse

## Source issue

`docs/agent-backlog/NESTJS_STARTER_KIT_REQUIRED_FIXES.md` — section **P1-07. Зробити `AuthModule.forRoot()` явним щодо Redis dependency та незалежного reuse**.

Related verification scenario: backlog **V-17** (`AuthModule.forRoot` independent registration with explicit Redis dependency).

## Current behavior

1. **`AuthModule.forRoot(options)`** (`libs/infrastructure/src/auth/auth.module.ts`, symbol `AuthModule.forRoot`) accepts only `AuthModuleOptions` and builds a `DynamicModule` whose `imports` array contains **only** `JwtModule.register(...)` when the JWT driver is selected; session driver adds no imports.
2. **`buildSyncDriverProviders(options)`** always registers Redis-backed Nest providers for the selected driver:
   - JWT: `RedisJwtTokenStore`, `JwtAuthTokenService`, `TOKENS.JwtTokenStore`, `TOKENS.AuthTokenService`
   - Session: `RedisSessionStore`, `SessionAuthTokenService`, `TOKENS.SessionStore`, `TOKENS.AuthTokenService`
3. **`RedisJwtTokenStore`** (`libs/infrastructure/src/auth/redis-jwt-token-store.service.ts`) and **`RedisSessionStore`** (`libs/infrastructure/src/auth/redis-session-store.service.ts`) inject **`RedisService`** via constructor DI.
4. **`RedisService`** is exported by **`RedisModule`** (`libs/infrastructure/src/redis/redis.module.ts`), but **`RedisModule` is not part of the `forRoot()` import contract**.
5. **Isolated bootstrap without Redis** fails at Nest DI resolution:

   ```text
   Nest can't resolve dependencies of the RedisJwtTokenStore (?).
   Please make sure that the argument RedisService at index [0] is available in the AuthModule module.
   ```

6. **Unit tests work around the defect** by mutating the returned dynamic module after registration:

   ```ts
   const dynamicModule = AuthModule.forRoot(options);
   dynamicModule.imports = [MockRedisModule, ...(dynamicModule.imports ?? [])];
   ```

   (`libs/infrastructure/src/auth/auth.module.spec.ts`, helper `withMockRedis`)

7. **`AuthModule.forRootAsync`** already accepts `imports?: ModuleMetadata['imports']` via `AuthModuleAsyncOptions`, and production composition roots pass `redisModule` explicitly:
   - `apps/api/src/composition/auth-application.module.ts` — `imports: [InfrastructureConfigModule, redisModule]`
   - `libs/infrastructure/src/infrastructure.module.ts` (deprecated facade) — same pattern
8. **Documentation gap:** `docs/infrastructure-modules/README.md` AuthModule example shows `forRootAsync` **without** `imports: [redisModule]`, with only a prose note “Requires a configured `RedisModule` in the same application context” — which does not satisfy the portability contract and matches the hidden-dependency anti-pattern this issue targets.
9. **Starter-kit API composition** does not call `AuthModule.forRoot()`; it uses `forRootAsync` with explicit `redisModule`. The sync API defect remains in the public module surface and tests.

**Investigation (2026-06-22, branch `main`):** defect confirmed in `libs/infrastructure/src/auth/auth.module.ts` lines 31–48. Issue is **not stale**.

## Confirmed root cause

`AuthModule.forRoot()` exposes a sync registration API that appears self-contained but registers Redis-backed store classes as Nest providers without accepting the infrastructure imports those providers require. Unlike sibling portable modules (`RateLimiterModule.register({ imports })`, `RepositoriesModule.register({ imports })`, `MailModule.forRootAsync({ imports })`), sync auth registration has no typed way to supply `RedisModule`, so independent reuse depends on out-of-band global/transitive wiring or post-hoc mutation of `dynamicModule.imports`.

## Dependency/runtime flow

### Current (problematic)

```text
ConsumerModule
  -> AuthModule.forRoot(authOptions)
       imports: [JwtModule.register(...)]   // RedisModule absent
       providers: [RedisJwtTokenStore | RedisSessionStore, ...]
         -> constructor inject RedisService
              -> NOT AVAILABLE in AuthModule context
```

### Target

```text
Consumer composition root
  -> redisModule = RedisModule.forRootAsync(...)
  -> AuthModule.forRoot(authOptions, { imports: [redisModule] })
       imports: [redisModule, JwtModule.register(...)]
       providers: [RedisJwtTokenStore | RedisSessionStore, ...]
         -> RedisService resolved from imported RedisModule
```

Optional override path:

```text
AuthModule.forRoot(authOptions, {
  imports: [],
  providers: [{ provide: TOKENS.JwtTokenStore, useClass: InMemoryJwtTokenStore }],
})
  -> buildSyncDriverProviders skips RedisJwtTokenStore when custom store provider supplied
```

## Goal

Make `AuthModule.forRoot()` a portable, explicit registration contract: consumers must pass required infrastructure imports (or custom store providers) at registration time; Redis dependency is visible at the composition root; documentation and tests demonstrate the contract without hidden globals or post-registration module mutation.

## Scope

1. Extend sync `AuthModule.forRoot()` with a typed registration options object that accepts `imports` (and optional custom store providers).
2. Add registration-time fail-fast when default Redis stores are used without `imports` and without custom store overrides.
3. Update `auth.module.spec.ts` to use the public API instead of mutating `dynamicModule.imports`.
4. Add explicit V-17 coverage: bootstrap succeeds with `{ imports: [redisModule] }`; bootstrap fails fast (or documents-only deprecation) without required dependencies.
5. Update `docs/infrastructure-modules/README.md` and `EXAMPLES.md` so Auth examples show `redisModule` passed into `imports` for both `forRoot` and `forRootAsync`.
6. Align `forRootAsync` documentation and, if needed, the same fail-fast guard when default Redis stores are constructed via `buildAsyncDriverProviders` without `RedisService` in scope.

## Out of scope

- **P1-06** — `TOKENS.UserRepository` visibility inside nested `JwtModule.registerAsync` / `AuthModule.forRootAsync` inject graph (separate issue; do not change `AuthApplicationCompositionModule` repository wiring unless required for P1-07 acceptance).
- Extracting a separate `AuthRedisStoreModule` (backlog mentions as alternative; `imports` contract is sufficient and matches existing module patterns).
- Replacing Redis stores with non-Redis implementations in production entrypoints.
- Changing `IJwtTokenStore` / `ISessionStore` contracts or `TOKENS` definitions.
- Broad `InfrastructureModule` deprecation work beyond doc cross-links.
- Runtime bootstrap of full API/Worker/Cron entrypoints (covered by existing entrypoint verification; P1-07 adds targeted Auth module isolation tests).

## Files to create

| File              | Responsibility                                                                                                                                                   |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| _(none required)_ | All changes fit existing files; optional dedicated `auth-module-registration.ts` only if implementer prefers separating registration types from `auth.module.ts` |

## Files to modify

| File                                               | Symbol / responsibility                                                                                                                                                                                                                                                                             |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `libs/infrastructure/src/auth/auth.module.ts`      | `AuthModule.forRoot`, new `AuthModuleRegistrationOptions` type, `assertRegistrationDependencies` (or equivalent), `buildSyncDriverProviders` — accept registration options, merge `imports`, skip default Redis store providers when custom `TOKENS.JwtTokenStore` / `TOKENS.SessionStore` supplied |
| `libs/infrastructure/src/auth/auth.module.spec.ts` | Replace `withMockRedis` post-mutation with `AuthModule.forRoot(options, { imports: [MockRedisModule] })`; add negative test for missing imports; add V-17 positive isolated bootstrap case                                                                                                          |
| `docs/infrastructure-modules/README.md`            | `AuthModule` section — show `RedisModule` in `imports` for `forRoot` and `forRootAsync`; document registration options and custom store override                                                                                                                                                    |
| `EXAMPLES.md`                                      | §13 standalone module example — add minimal `AuthModule.forRoot(..., { imports: [redisModule] })` or `forRootAsync` with explicit `redisModule` alongside existing `RedisModule` snippet                                                                                                            |

## Files to delete

_(none)_

## Contract and DI changes

| Area                       | Change                                                                                                                                                                                                                                                                                 |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Public API**             | `AuthModule.forRoot(options, registration?)` — second argument `AuthModuleRegistrationOptions` with `imports?: ModuleMetadata['imports']` and optional `providers?: Provider[]` for store overrides                                                                                    |
| **Backward compatibility** | **Breaking for callers of `forRoot(options)` without second argument** when default Redis stores are used — intentional fail-fast per acceptance criteria. No production starter-kit entrypoint currently calls sync `forRoot`; only `auth.module.spec.ts` uses it (with workaround).  |
| **Exports**                | Unchanged: `TOKENS.PasswordHasher`, `TOKENS.AuthTokenService`, and driver-specific `TOKENS.JwtTokenStore` or `TOKENS.SessionStore`                                                                                                                                                     |
| **Nest tokens**            | No new injection tokens required unless implementer adds `AuthModuleRegistrationOptions` as a named exported type in `auth.module-options.ts`                                                                                                                                          |
| **Composition roots**      | `apps/api/src/composition/auth-application.module.ts` and `libs/infrastructure/src/infrastructure.module.ts` already pass `redisModule` to `forRootAsync` — **no code change expected** unless fail-fast guard is added to async path and reveals a gap (verify during implementation) |

### Proposed registration contract (implementer reference)

```ts
export type AuthModuleRegistrationOptions = {
  imports?: ModuleMetadata['imports'];
  providers?: Provider[];
};

static forRoot(
  options: AuthModuleOptions,
  registration: AuthModuleRegistrationOptions = {},
): DynamicModule {
  AuthModule.assertSyncRegistration(options, registration);

  const imports: ModuleMetadata['imports'] = [
    ...(registration.imports ?? []),
  ];

  if (isJwtAuthOptions(options)) {
    imports.push(JwtModule.register({ secret: options.jwt.secret }));
  }

  return {
    module: AuthModule,
    global: false,
    imports,
    providers: [
      { provide: AUTH_MODULE_OPTIONS, useValue: options },
      ...AuthModule.buildSharedProviders(),
      ...(registration.providers ?? []),
      ...AuthModule.buildSyncDriverProviders(options, registration),
    ],
    exports: AuthModule.buildExports(options),
  };
}
```

`assertSyncRegistration` should throw a clear `Error` when:

- driver is `jwt`, no custom `TOKENS.JwtTokenStore` in `registration.providers`, and `registration.imports` is empty;
- driver is `session`, no custom `TOKENS.SessionStore` in `registration.providers`, and `registration.imports` is empty.

Error message should name `RedisModule` and the `imports` option explicitly (not rely on Nest’s generic DI error).

`buildSyncDriverProviders` should detect custom store providers (by `provide === TOKENS.JwtTokenStore` or `TOKENS.SessionStore`) and omit `RedisJwtTokenStore` / `RedisSessionStore` registration accordingly.

## Implementation steps

1. **Define registration types**
   - Add `AuthModuleRegistrationOptions` to `auth.module.ts` (or `auth.module-options.ts` if exporting for docs).
   - Add helper `hasCustomStoreProvider(providers, token)` used by sync and optionally async paths.

2. **Extend `AuthModule.forRoot`**
   - Accept optional second `registration` argument.
   - Merge `registration.imports` before `JwtModule.register`.
   - Append `registration.providers` before driver providers.
   - Call fail-fast assertion before returning `DynamicModule`.

3. **Update `buildSyncDriverProviders`**
   - Accept `registration` context.
   - Skip `RedisJwtTokenStore` / `RedisSessionStore` + `useExisting` bindings when custom store provider present.
   - Keep single-driver instantiation (JWT **or** session branch only).

4. **Optional: harden `forRootAsync`**
   - Mirror fail-fast when `imports` empty and async factory will construct `RedisJwtTokenStore` / `RedisSessionStore` via `RedisService`.
   - Ensures docs/code parity; starter-kit composition already passes `redisModule`.

5. **Rewrite unit tests** (`auth.module.spec.ts`)
   - Remove `withMockRedis` import mutation.
   - Positive: `AuthModule.forRoot(jwtOptions, { imports: [MockRedisModule] })` compiles and resolves `TOKENS.AuthTokenService`.
   - Positive: session driver with same pattern.
   - Negative: `AuthModule.forRoot(jwtOptions)` throws registration error with actionable message **before** `Test.createTestingModule` (preferred) or document if assertion is deferred to Nest compile (less ideal).
   - Negative: `forRootAsync` without `imports` and without custom stores — same fail-fast if async guard added.
   - Optional positive: custom in-memory `TOKENS.JwtTokenStore` provider allows `forRoot` without Redis imports.

6. **Update documentation**
   - `docs/infrastructure-modules/README.md` — full Auth example:

     ```typescript
     const redisModule = RedisModule.forRootAsync({ useFactory: () => ({ host: '127.0.0.1', port: 6379, db: 0, connectTimeoutMs: 5000 }) });

     AuthModule.forRootAsync({
       imports: [redisModule],
       useFactory: () => ({ driver: 'jwt', ... }),
     });
     ```

   - Add sync `forRoot` example with `{ imports: [redisModule] }`.
   - `EXAMPLES.md` §13 — cross-link and minimal combined Redis + Auth snippet.

7. **Export surface check**
   - Confirm no barrel re-export changes needed (AuthModule imported via path alias `@infrastructure/auth/auth.module`).

## Migration and rollout concerns

- **Breaking change** limited to direct consumers of `AuthModule.forRoot(options)` without `registration.imports`. Starter-kit entrypoints use `forRootAsync` with explicit `redisModule` — no deployment migration.
- **Test-only workaround removal** in `auth.module.spec.ts` is intentional; external consumers copying the old test pattern must pass `imports`.
- No database, Redis schema, or env variable changes.
- If fail-fast is added to `forRootAsync`, verify `InfrastructureModule.forRoot()` and `AuthApplicationCompositionModule.register()` still bootstrap (they already import `redisModule`).

## Targeted verification

| ID  | Command / scenario                                                                                    | Expected                                                                    |
| --- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| T1  | `npx jest --config jest.unit.config.ts --testPathPattern=auth.module.spec`                            | All AuthModule tests pass using public `imports` API                        |
| T2  | New negative test: `AuthModule.forRoot(jwtOptions)` without registration                              | Clear registration-time error referencing `imports` / `RedisModule`         |
| T3  | New positive test: `AuthModule.forRoot(jwtOptions, { imports: [MockRedisModule] })`                   | `Test.createTestingModule({ imports: [dynamicModule] }).compile()` succeeds |
| T4  | Optional: custom `TOKENS.JwtTokenStore` provider without Redis imports                                | Compiles; `TOKENS.AuthTokenService` resolves                                |
| T5  | Static review: `docs/infrastructure-modules/README.md` Auth example includes `imports: [redisModule]` | No hidden-global-only pattern                                               |

## Full verification

| Command                  | When                                  | Expected                                                                                                                                                                                        |
| ------------------------ | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run build`          | After implementation                  | Pass — shared infrastructure / auth module compiles for all entrypoints                                                                                                                         |
| `npm run lint`           | After implementation                  | Pass                                                                                                                                                                                            |
| `npm run test:unit`      | After implementation                  | Pass (includes updated `auth.module.spec.ts`)                                                                                                                                                   |
| `npm run build:api`      | After implementation                  | Pass — composition root unchanged but validates import graph                                                                                                                                    |
| **V-17 manual scenario** | If PostgreSQL/Redis available locally | Minimal Nest testing module: `RedisModule.forRoot(...)` + `AuthModule.forRoot(..., { imports: [redisModule] })` bootstraps; same without `imports` fails fast or at DI with documented contract |

Record each command with exit code and conclusion per `AGENTS.md`.

## Acceptance criteria

Mapped to backlog P1-07:

| Criterion                                                                                                                                              | Verification                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------- |
| `AuthModule.forRoot(authOptions, { imports: [redisModule] })` bootstrap passes                                                                         | T3, T5, V-17                                       |
| `AuthModule.forRoot(authOptions)` without required store dependency fails fast with clear validation error **or** is no longer supported as public API | T2 (fail-fast preferred over silent deprecation)   |
| Redis dependency visible at composition root                                                                                                           | Code review of `forRoot` signature + docs examples |
| Docs do not show hidden global dependency pattern                                                                                                      | T5, `EXAMPLES.md` §13 review                       |

## Risks

| Risk                                                                                  | Mitigation                                                                                                          |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Breaking external consumers of sync `forRoot`                                         | Document in plan/README; starter-kit has no such consumers                                                          |
| `registration.providers` override detection misses `useExisting` / `useFactory` forms | Document supported override shapes; test `useClass` and `useValue` at minimum                                       |
| Fail-fast on `forRootAsync` breaks undocumented callers                               | Grep codebase first; only `auth-application.module.ts` and `infrastructure.module.ts` use `forRootAsync` with redis |
| Duplicating P1-06 scope (repository inject into Auth async factory)                   | Do not change `inject: [AppConfigService, TOKENS.UserRepository]` wiring in this issue                              |

## Rollback strategy

Revert commits touching `auth.module.ts`, `auth.module.spec.ts`, and docs. No migrations or persistent state. Composition roots unchanged, so API/Worker/Cron behavior should be identical after rollback.

## Open questions requiring human decision

1. **Sync API deprecation:** Should `AuthModule.forRoot` remain fully supported with mandatory `registration.imports`, or should sync API be marked `@deprecated` in favor of `forRootAsync` only (with `forRoot` kept as thin wrapper)?
   - **Recommendation:** Keep `forRoot` supported with mandatory `imports` for parity with `RedisModule.forRoot`, `MailModule.forRoot`, `StorageModule.forRoot`.

2. **Custom store override API:** Is `registration.providers: Provider[]` sufficient, or should registration expose explicit `jwtTokenStore?: Provider` / `sessionStore?: Provider` fields for clearer ergonomics?
   - **Recommendation:** `providers` array matches Nest patterns; optional explicit fields if human prefers discoverability.

3. **`forRootAsync` fail-fast:** Apply the same registration assertion to `forRootAsync` in this issue, or limit scope to sync `forRoot` only?
   - **Recommendation:** Include async guard in same PR — same hidden dependency exists when `imports` omitted; low risk because starter-kit already passes `redisModule`.

4. **Separate `AuthRedisStoreModule`:** Defer entirely unless human wants store wiring extracted from `AuthModule`?
   - **Recommendation:** Defer; `imports` contract satisfies acceptance criteria and matches `RateLimiterModule.register` pattern.
