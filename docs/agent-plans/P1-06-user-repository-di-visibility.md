---
issue_id: P1-06
status: approved
owner: human-approval-required
---

# P1-06 — Fix DI visibility for `TOKENS.UserRepository` in API Auth composition

## Source issue

`docs/agent-backlog/NESTJS_STARTER_KIT_REQUIRED_FIXES.md` — section **P1-06. Виправити DI visibility для `TOKENS.UserRepository` в API Auth composition**.

Related verification scenario: backlog **V-16** (API Auth composition resolves `TOKENS.UserRepository` inside Auth/JWT registration).

**Investigation (2026-06-22, branch `main`):** defect confirmed. Issue is **not stale**.

## Current behavior

1. **`AuthApplicationCompositionModule.register(...)`** (`apps/api/src/composition/auth-application.module.ts`) wires auth options through `AuthModule.forRootAsync` with:

   ```ts
   imports: [InfrastructureConfigModule, redisModule],
   inject: [AppConfigService, TOKENS.UserRepository],
   ```

2. **`RepositoriesModule.register({ imports: [drizzleModule] })`** is imported only as a **sibling** module in the composition root’s `return { imports: [...] }` array (line 84). It is **not** passed into `AuthModule.forRootAsync({ imports: [...] })`.

3. **`AuthModule.forRootAsync`** (`libs/infrastructure/src/auth/auth.module.ts`) forwards `asyncOptions.imports` and `asyncOptions.inject` to nested `JwtModule.registerAsync(...)`. Both `AUTH_MODULE_OPTIONS` and `JWT_MODULE_OPTIONS` factories share the same `inject` array.

4. **Use-case factories** in the composition module (`RegisterUseCase`, `LoginUseCase`, etc.) resolve `TOKENS.UserRepository` correctly because `RepositoriesModule` is a sibling import of `AuthApplicationCompositionModule`.

5. **Nested Auth/JWT subgraph** cannot see `TOKENS.UserRepository` because Nest module encapsulation limits injection to providers exported from modules listed in the **current module’s** `imports` tree — sibling composition imports do not propagate into `AuthModule` / `JwtModule`.

6. **Build succeeds; runtime bootstrap fails** after infrastructure startup with an error of the form:

   ```text
   Nest can't resolve dependencies of the JWT_MODULE_OPTIONS (AppConfigService, ?).
   Please make sure that the argument Symbol(IUserRepository) at index [1] is available in the JwtModule module.
   ```

7. **Historical context:** P2-06 added `TOKENS.UserRepository` to the auth `useFactory` for fresh-user resolution (`resolveAccessUser` / `resolveSessionUser`) without importing `RepositoriesModule` into the `AuthModule.forRootAsync` subgraph. The deprecated `InfrastructureModule` facade still injects only `[AppConfigService]` and does not exhibit this defect.

## Confirmed root cause

`TOKENS.UserRepository` is required by `AuthModule.forRootAsync` / nested `JwtModule.registerAsync` factories, but the module that exports that token (`RepositoriesModule`) is registered only at the composition root level, outside the Auth/JWT module import graph.

## Dependency/runtime flow

### Current (broken)

```text
ApiModule
  └─ AuthApplicationCompositionModule.register({ redisModule, drizzleModule })
       ├─ AuthModule.forRootAsync({
       │     imports: [InfrastructureConfigModule, redisModule],
       │     inject: [AppConfigService, TOKENS.UserRepository],
       │   })
       │    └─ JwtModule.registerAsync({ imports: same, inject: same })
       │         └─ JWT_MODULE_OPTIONS factory
       │              └─ TOKENS.UserRepository NOT in JwtModule scope ❌
       └─ RepositoriesModule.register({ imports: [drizzleModule] })  ← sibling only
            └─ visible to use-case factories ✓, not to JwtModule ❌
```

### Target (fixed)

```text
ApiModule
  └─ AuthApplicationCompositionModule.register({ redisModule, drizzleModule })
       ├─ const repositoriesModule = RepositoriesModule.register({ imports: [drizzleModule] })
       ├─ AuthModule.forRootAsync({
       │     imports: [InfrastructureConfigModule, redisModule, repositoriesModule],
       │     inject: [AppConfigService, TOKENS.UserRepository],
       │   })
       │    └─ JwtModule.registerAsync({ imports: same, inject: same })
       │         └─ JWT_MODULE_OPTIONS factory
       │              └─ TOKENS.UserRepository resolved via repositoriesModule ✓
       └─ imports: [..., repositoriesModule, ...]  ← same instance reused
```

## Goal

Make `TOKENS.UserRepository` visible inside the Auth/JWT registration subgraph so API auth composition bootstraps without DI errors and fresh-user resolution works at runtime.

## Scope

| Change                                                                                   | File                                                             | Effort       |
| ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ------------ |
| Hoist and reuse one `repositoriesModule`; pass it into `AuthModule.forRootAsync` imports | `apps/api/src/composition/auth-application.module.ts`            | ~10 lines    |
| Add DI regression spec for composition bootstrap                                         | `apps/api/src/composition/auth-application.module.spec.ts` (new) | ~60–80 lines |
| Optional doc note for consumers wiring `UserRepository` into auth options                | `docs/infrastructure-modules/README.md`                          | 3–5 lines    |

## Out of scope

- **`AuthModule.forRoot()` Redis visibility** — separate issue **P1-07** (`docs/agent-plans/P1-07-auth-module-explicit-redis-dependency.md`).
- Changes to **`libs/infrastructure/src/auth/auth.module.ts`** — `forRootAsync` already forwards `imports`/`inject` correctly; no internal change required for P1-06.
- Changes to **`RepositoriesModule`**, **`UserDrizzleRepository`**, contracts, or use cases.
- Full **`ApiModule`** bootstrap test — heavier than needed; composition-level DI test satisfies V-16.
- **`README.md` / `EXAMPLES.md` rewrites** — they do not show the broken wiring pattern today.

## Files to create

| File                                                       | Symbol / responsibility                                                                                                                                                                                                        |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/api/src/composition/auth-application.module.spec.ts` | Jest spec: `describe('AuthApplicationCompositionModule')` — compile `AuthApplicationCompositionModule.register(...)` and assert `JwtService`, `TOKENS.AuthTokenService`, and `TOKENS.UserRepository` resolve without DI errors |

## Files to modify

| File                                                  | Symbol / responsibility                                                                                                                                                                                                                                                                                                                       |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/src/composition/auth-application.module.ts` | `AuthApplicationCompositionModule.register` — hoist `const repositoriesModule = RepositoriesModule.register({ imports: [drizzleModule] })`; add `repositoriesModule` to `AuthModule.forRootAsync({ imports: [...] })`; replace inline `RepositoriesModule.register(...)` in composition `imports` with the same `repositoriesModule` variable |
| `docs/infrastructure-modules/README.md`               | `AuthModule` section (~lines 65–84) — optional note: when `inject` includes `TOKENS.UserRepository`, pass `RepositoriesModule.register(...)` in `AuthModule.forRootAsync({ imports })`                                                                                                                                                        |

## Files to delete

None.

## Contract and DI changes

- **Public HTTP API:** unchanged.
- **Contracts / tokens:** unchanged — `TOKENS.UserRepository` remains defined in `libs/contracts/src/tokens.ts`.
- **DI graph:** `RepositoriesModule` becomes part of the `AuthModule.forRootAsync` import subgraph (and therefore of nested `JwtModule`) using a **single shared dynamic module instance** per composition root.
- **Breaking change:** none for external consumers; internal composition wiring only.

## Implementation steps

1. **Edit `auth-application.module.ts`**
   - After destructuring `{ redisModule, drizzleModule }`, add:

     ```ts
     const repositoriesModule = RepositoriesModule.register({
       imports: [drizzleModule],
     });
     ```

   - Change `AuthModule.forRootAsync` to:

     ```ts
     imports: [InfrastructureConfigModule, redisModule, repositoriesModule],
     ```

   - In the returned `imports` array, replace:

     ```ts
     RepositoriesModule.register({ imports: [drizzleModule] }),
     ```

     with:

     ```ts
     repositoriesModule,
     ```

   - Leave `buildFreshUserResolver`, `useFactory`, and use-case factory blocks unchanged.

2. **Add `auth-application.module.spec.ts`**
   - Follow patterns from:
     - `libs/infrastructure/src/auth/auth.module.spec.ts` — `forRootAsync` compile test;
     - `libs/infrastructure/src/redis/redis.module.spec.ts` — `jest.mock('ioredis')`, `AppLogger` override;
     - `libs/infrastructure/src/database/drizzle/drizzle.module.spec.ts` — `DrizzleModule.forRoot` without live PostgreSQL for compile.
   - Build shared modules with typed options (no `InfrastructureConfigModule` in redis/drizzle setup):

     ```ts
     const redisModule = RedisModule.forRoot({
       host: '127.0.0.1',
       port: 6379,
       db: 0,
       connectTimeoutMs: 1000,
     });
     const drizzleModule = DrizzleModule.forRoot({
       connectionString: 'postgresql://localhost:5432/test',
     });
     ```

   - Import `AuthApplicationCompositionModule.register({ redisModule, drizzleModule })`.
   - Override `AppLogger` (required by `RedisModule` via `LoggerModule`).
   - Override `AppConfigService` with JWT-driver stubs **or** seed minimal valid `process.env` for `InfrastructureConfigModule` validation — prefer override for test isolation.
   - Assert:
     - `await Test.createTestingModule({ imports: [compositionModule] }).overrideProvider(...).compile()` succeeds;
     - `moduleRef.get(JwtService)` is defined (proves `JWT_MODULE_OPTIONS` resolved);
     - `moduleRef.get(TOKENS.UserRepository)` is defined;
     - `moduleRef.get(TOKENS.AuthTokenService)` is defined;
     - `await moduleRef.close()`.
   - Add at least one case per auth driver (`jwt` and `session`) if `AppConfigService` override differs by driver; otherwise one JWT case is sufficient for the DI defect.

3. **Optional doc note** in `docs/infrastructure-modules/README.md` under `AuthModule`:
   - Document that composition roots injecting `TOKENS.UserRepository` into `AuthModule.forRootAsync` must include `RepositoriesModule.register(...)` in the `imports` array passed to `forRootAsync`.

4. **Do not** modify `AuthModule`, `RepositoriesModule`, or `ApiModule`.

## Migration and rollout concerns

- No database migration.
- No environment variable changes.
- Deploy as a standard API code change; no separate rollout step.
- Existing running instances will fail auth bootstrap until this fix is deployed — consistent with current latent defect.

## Targeted verification

| Command                                                                         | Expected result                                                                       |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `npm ci`                                                                        | Clean install (prerequisite if `node_modules` absent)                                 |
| `npm run test:unit -- apps/api/src/composition/auth-application.module.spec.ts` | New spec passes; would fail on current `main` with `Symbol(IUserRepository)` DI error |
| `npm run build:api`                                                             | API compiles                                                                          |

## Full verification

| Command             | Expected result                                                                               |
| ------------------- | --------------------------------------------------------------------------------------------- |
| `npm run lint`      | No new lint errors                                                                            |
| `npm run test:unit` | Full unit suite passes                                                                        |
| `npm run build:api` | API build succeeds                                                                            |
| `npm run start:api` | Optional — requires PostgreSQL + Redis; confirms end-to-end bootstrap when infra is available |

Record each command with result and conclusion per project verification rules.

## Acceptance criteria

Mapped to backlog P1-06 and verification scenario V-16:

| ID   | Criterion                                                                             | Verification                                                                                                           |
| ---- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| AC-1 | API auth composition bootstrap completes without DI error for `TOKENS.UserRepository` | Targeted spec `compile()` succeeds                                                                                     |
| AC-2 | `JWT_MODULE_OPTIONS` resolves in Nest runtime                                         | `moduleRef.get(JwtService)` succeeds in spec                                                                           |
| AC-3 | Single `RepositoriesModule.register(...)` instance per composition root               | Code review: one `const repositoriesModule` reused in both `AuthModule.forRootAsync` imports and composition `imports` |
| AC-4 | `npm run build:api` passes                                                            | Execute and record                                                                                                     |
| AC-5 | Targeted DI test passes                                                               | Execute and record                                                                                                     |
| AC-6 | `npm run lint` passes                                                                 | Execute and record                                                                                                     |

## Risks

1. **Test env validation** — `InfrastructureConfigModule` runs Zod env validation on import; spec must override `AppConfigService` or seed env vars to avoid unrelated compile failures masking the DI assertion.
2. **Drizzle pool lifecycle** — `DrizzleModule.forRoot` may open a pool handle during compile; spec must call `moduleRef.close()` to avoid open handles (follow existing `*.module.spec.ts` pattern).
3. **False confidence from build-only checks** — `npm run build:api` passes today because this is a runtime DI defect; the new spec is mandatory evidence.

## Rollback strategy

Revert the single composition-module change and delete the new spec file. No schema, config, or contract rollback required.

## Open questions requiring human decision

1. **Doc update scope** — backlog says update docs “if old pattern shown.” `docs/infrastructure-modules/README.md` does not show the broken pattern. Approve optional positive guidance note, or skip doc change entirely.
2. **Test driver coverage** — implement one JWT-driver spec only, or add a second session-driver case in the same file for symmetry with P2-06 fresh-user wiring.
3. **Runtime bootstrap evidence** — whether implementer must also run `npm run start:api` with local Docker infra for verification report, or targeted DI spec is sufficient for this issue.
