---
issue_id: V-17
status: approved
owner: human-approval-required
---

# V-17 — `AuthModule.forRoot` independent registration with explicit Redis dependency

## Source issue

`docs/agent-backlog/NESTJS_STARTER_KIT_REQUIRED_FIXES.md` — verification backlog row **V-17**:

> `AuthModule.forRoot` independent registration with explicit Redis dependency

**Linked defect:** **P1-07** (`docs/agent-backlog/NESTJS_STARTER_KIT_REQUIRED_FIXES.md` — section P1-07; implementation plan `docs/agent-plans/P1-07-auth-module-explicit-redis-dependency.md`).

**Investigation (2026-06-22, branch `main`):** verification scenario is **not stale**. The underlying DI/portability defect from P1-07 is still present in production code. V-17 cannot return `approved` until P1-07 is implemented and independently verified.

## Current behavior

1. **`AuthModule.forRoot(options)`** (`libs/infrastructure/src/auth/auth.module.ts`, symbol `AuthModule.forRoot`) accepts only `AuthModuleOptions`. Its `imports` array contains **only** `JwtModule.register(...)` for the JWT driver; session driver adds no imports.

2. **`buildSyncDriverProviders(options)`** always registers Redis-backed Nest providers:
   - JWT: `RedisJwtTokenStore`, `JwtAuthTokenService`, `TOKENS.JwtTokenStore`, `TOKENS.AuthTokenService`
   - Session: `RedisSessionStore`, `SessionAuthTokenService`, `TOKENS.SessionStore`, `TOKENS.AuthTokenService`

3. **`RedisJwtTokenStore`** (`libs/infrastructure/src/auth/redis-jwt-token-store.service.ts`) and **`RedisSessionStore`** (`libs/infrastructure/src/auth/redis-session-store.service.ts`) inject **`RedisService`** via constructor DI.

4. **`RedisService`** is exported by **`RedisModule`** (`libs/infrastructure/src/redis/redis.module.ts`), but **`RedisModule` is not part of the sync `forRoot()` import contract**.

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

   (`libs/infrastructure/src/auth/auth.module.spec.ts`, helper `withMockRedis` — lines 34–37; same post-mutation pattern for `forRootAsync` at lines 81–93).

7. **`AuthModule.forRootAsync`** already accepts `imports?: ModuleMetadata['imports']`, and production composition roots pass `redisModule` explicitly:
   - `apps/api/src/composition/auth-application.module.ts` — `imports: [InfrastructureConfigModule, redisModule]`
   - `libs/infrastructure/src/infrastructure.module.ts` (deprecated facade) — same pattern

8. **Documentation gap:** `docs/infrastructure-modules/README.md` AuthModule example (lines 65–84) shows `forRootAsync` **without** `imports: [redisModule]`, with only prose “Requires a configured `RedisModule` in the same application context” — which does not satisfy the portability contract.

9. **Starter-kit API composition** does not call sync `AuthModule.forRoot()`; it uses `forRootAsync` with explicit `redisModule`. The sync API defect remains on the public module surface and in tests.

## Confirmed root cause

Same as P1-07: `AuthModule.forRoot()` exposes a sync registration API that appears self-contained but registers Redis-backed store classes as Nest providers without accepting the infrastructure imports those providers require. Unlike sibling portable modules (`RateLimiterModule.register({ imports })`, `RepositoriesModule.register({ imports })`, `MailModule.forRootAsync({ imports })`), sync auth registration has no typed way to supply `RedisModule`, so independent reuse depends on out-of-band global/transitive wiring or post-hoc mutation of `dynamicModule.imports`.

## Dependency/runtime flow

### Current (broken — V-17 would fail today)

```text
ConsumerModule
  -> AuthModule.forRoot(authOptions)
       imports: [JwtModule.register(...)]   // RedisModule absent
       providers: [RedisJwtTokenStore | RedisSessionStore, ...]
         -> constructor inject RedisService
              -> NOT AVAILABLE in AuthModule context ❌
```

### Expected after P1-07 (V-17 pass condition)

```text
Consumer composition root
  -> redisModule = RedisModule.forRoot(...) | RedisModule.forRootAsync(...)
  -> AuthModule.forRoot(authOptions, { imports: [redisModule] })
       imports: [redisModule, JwtModule.register(...)]
       providers: [RedisJwtTokenStore | RedisSessionStore, ...]
         -> RedisService resolved from imported RedisModule ✓
```

Optional override path (also valid for V-17):

```text
AuthModule.forRoot(authOptions, {
  imports: [],
  providers: [{ provide: TOKENS.JwtTokenStore, useClass: InMemoryJwtTokenStore }],
})
  -> buildSyncDriverProviders skips RedisJwtTokenStore when custom store provider supplied ✓
```

## Goal

Independently confirm — with runtime evidence, not static inspection alone — that `AuthModule.forRoot()` is a portable, explicit registration contract: consumers pass required infrastructure imports (or custom store providers) at registration time; Redis dependency is visible at the composition root; documentation and tests demonstrate the contract without hidden globals or post-registration module mutation.

## Scope

| Activity                       | Responsibility        | Notes                                                                                               |
| ------------------------------ | --------------------- | --------------------------------------------------------------------------------------------------- |
| Fix sync registration contract | **P1-07 implementer** | Extend `forRoot` with `AuthModuleRegistrationOptions`; fail-fast; update `buildSyncDriverProviders` |
| Rewrite unit tests             | **P1-07 implementer** | Remove `withMockRedis` import mutation; add positive/negative V-17 cases                            |
| Update docs                    | **P1-07 implementer** | `docs/infrastructure-modules/README.md`, `EXAMPLES.md`                                              |
| Independent verification       | **V-17 verifier**     | Inspect diff, run commands, write `docs/agent-reports/V-17-verification.md`                         |

## Out of scope

- Implementing the P1-07 fix (separate approved plan).
- **P1-06 / V-16** — `TOKENS.UserRepository` visibility inside `AuthModule.forRootAsync` / nested `JwtModule` (separate issue).
- Extracting a separate `AuthRedisStoreModule`.
- Replacing Redis stores with non-Redis implementations in production entrypoints.
- Changing `IJwtTokenStore` / `ISessionStore` contracts or `TOKENS` definitions.
- Full HTTP auth flow testing (login/register/refresh) — covered by other verification items (e.g. V-11, V-18).
- Marking P1-07 or V-17 resolved in backlog INDEX without implementation + verification evidence.

## Files to create

| File                                      | Symbol / responsibility                                                        |
| ----------------------------------------- | ------------------------------------------------------------------------------ |
| `docs/agent-reports/V-17-verification.md` | Independent verification report (verifier output; not created during planning) |

**Prerequisite from P1-07 (implementer modifies):**

| File              | Symbol / responsibility                                |
| ----------------- | ------------------------------------------------------ |
| _(none required)_ | All P1-07 changes fit existing files per approved plan |

## Files to modify

None during verification planning. Verifier inspects changes from P1-07:

| File                                               | What to verify                                                                                                                                                                 |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `libs/infrastructure/src/auth/auth.module.ts`      | `AuthModule.forRoot(options, registration?)` — `AuthModuleRegistrationOptions`, `assertSyncRegistration` (or equivalent), merged `imports`, optional `forRootAsync` guard      |
| `libs/infrastructure/src/auth/auth.module.spec.ts` | No `dynamicModule.imports = [...]` mutation; positive bootstrap with `{ imports: [MockRedisModule] }`; negative fail-fast without imports; optional custom store override test |
| `docs/infrastructure-modules/README.md`            | Auth examples show `imports: [redisModule]` for `forRoot` and `forRootAsync`                                                                                                   |
| `EXAMPLES.md`                                      | §13 standalone module example includes explicit Redis + Auth registration                                                                                                      |

## Files to delete

None.

## Contract and DI changes

- **Verifier expectation after P1-07:** `AuthModule.forRoot(options, registration?)` public API with `AuthModuleRegistrationOptions` containing `imports?: ModuleMetadata['imports']` and optional `providers?: Provider[]` for store overrides.
- **Breaking change (intentional):** callers of `AuthModule.forRoot(options)` without second argument when default Redis stores are used must fail fast with actionable error — not rely on Nest generic DI failure.
- **Starter-kit entrypoints:** `AuthApplicationCompositionModule` and `InfrastructureModule` use `forRootAsync` with explicit `redisModule` — **no production entrypoint change expected** unless async fail-fast guard reveals a gap.
- **Nest tokens:** no new injection tokens required unless P1-07 exports `AuthModuleRegistrationOptions` from a dedicated file.

## Implementation steps

V-17 is a verification issue. Steps below are for the **independent verifier** after P1-07 implementation is complete.

### Prerequisite gate

1. Confirm **P1-07 plan** frontmatter is `status: approved`.
2. Confirm P1-07 implementation exists (inspect `git diff`; read `docs/agent-reports/P1-07-implementation.md` if present, but do not trust it without code inspection).
3. If P1-07 is not implemented, stop and return verdict **`changes-required`** with note: underlying defect still open.

### Step 1 — Scope and diff review

1. Run `git status` and `git diff`.
2. Confirm only P1-07-scoped files changed (primarily `auth.module.ts`, `auth.module.spec.ts`, docs).
3. Confirm **no unrelated** changes to `AuthApplicationCompositionModule` repository wiring (P1-06 scope).
4. In `auth.module.ts`, confirm:
   - `forRoot` accepts optional second `registration` argument;
   - `registration.imports` merged before `JwtModule.register`;
   - fail-fast assertion throws before returning `DynamicModule` when default Redis stores used without imports;
   - `buildSyncDriverProviders` skips `RedisJwtTokenStore` / `RedisSessionStore` when custom store provider supplied.

### Step 2 — Static DI trace

Trace and document for JWT driver (primary V-17 path):

```text
Test.createTestingModule({ imports: [AuthModule.forRoot(jwtOptions, { imports: [MockRedisModule] })] })
  -> AuthModule.forRoot
       imports: [MockRedisModule, JwtModule.register(...)]
       providers: [RedisJwtTokenStore, ...]
         -> inject RedisService
              -> MockRedisModule exports RedisService ✓
```

Trace negative path:

```text
AuthModule.forRoot(jwtOptions)
  -> assertSyncRegistration throws Error naming RedisModule/imports ✓
  (or documented unsupported API — fail-fast preferred)
```

Repeat trace for session driver if P1-07 tests cover it.

### Step 3 — Targeted unit verification (mandatory)

Run:

```bash
npm ci
npx jest --config jest.unit.config.ts --testPathPattern=auth.module.spec
```

**Expected:** all AuthModule tests pass using public `imports` API; no post-registration `dynamicModule.imports` mutation in spec file.

**Spec must assert at minimum (per P1-07 plan):**

- `AuthModule.forRoot(jwtOptions, { imports: [MockRedisModule] })` — `Test.createTestingModule({ imports: [dynamicModule] }).compile()` succeeds; `TOKENS.AuthTokenService` resolves;
- `AuthModule.forRoot(jwtOptions)` without registration — throws registration-time error referencing `imports` / `RedisModule` **before** or at compile (registration-time preferred);
- session driver positive case with `{ imports: [MockRedisModule] }` if implemented;
- `forRootAsync` tests use `imports: [MockRedisModule]` in public API, not post-mutation (if P1-07 includes async guard).

**Negative control (optional, pre-fix baseline only):** on unfixed `main`, isolated `forRoot` without imports fails with Nest DI error for `RedisJwtTokenStore` — confirms the test catches the defect.

### Step 4 — Build and lint

```bash
npm run build
npm run lint
```

Record exit codes. Build-only pass is **insufficient** for approval (defect is runtime DI/portability, not compile-time).

Optional entrypoint validation (composition unchanged but validates import graph):

```bash
npm run build:api
```

### Step 5 — Optional runtime bootstrap (manual V-17 scenario)

When Redis is available locally, create or run a minimal isolated Nest testing module (can be a one-off script or documented manual step — P1-07 may encode this in spec with real `RedisModule.forRoot`):

```text
RedisModule.forRoot({ host, port, db, connectTimeoutMs })
  + AuthModule.forRoot(jwtOptions, { imports: [redisModule] })
  -> compile() succeeds
```

Same without `imports` → fail-fast error or documented unsupported contract.

If Redis is unavailable, record under **Unverified areas** — do not treat as project defect.

### Step 6 — Documentation alignment

1. `docs/infrastructure-modules/README.md` — Auth section shows explicit `redisModule` in `imports` for both `forRoot` and `forRootAsync`.
2. `EXAMPLES.md` §13 — no hidden-global-only Auth registration pattern.
3. Confirm prose does not rely solely on “Requires a configured `RedisModule` in the same application context” without showing `imports`.

### Step 7 — Write verification report

Create `docs/agent-reports/V-17-verification.md` using structure from `.cursor/skills/change-verification/SKILL.md`:

```markdown
# V-17 — Independent verification

## Verdict

approved | changes-required | not-confirmed

## Scope checked

## Root-cause assessment

## Acceptance criteria matrix

## Dependency and DI verification

## Commands executed

## Findings

## Documentation alignment

## Remaining risks

## Unverified areas
```

Include per-command records:

```text
Command:
Result:
Conclusion:
```

## Migration and rollout concerns

None for verification. P1-07 fix itself requires no migration or env changes. Breaking change is limited to direct consumers of sync `forRoot(options)` without `registration.imports`; starter-kit entrypoints use `forRootAsync`.

## Targeted verification

| Command                                                                    | Expected result                                                       |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `npm ci`                                                                   | Clean install succeeds                                                |
| `npx jest --config jest.unit.config.ts --testPathPattern=auth.module.spec` | Passes; primary V-17 evidence                                         |
| Code review of `auth.module.ts`                                            | `forRoot(options, registration?)` with merged `imports` and fail-fast |
| Code review of `auth.module.spec.ts`                                       | No `withMockRedis` import mutation                                    |

## Full verification

| Command                                           | Expected result                                                            |
| ------------------------------------------------- | -------------------------------------------------------------------------- |
| `npm run build`                                   | Full monorepo compiles                                                     |
| `npm run lint`                                    | No new lint errors from P1-07 changes                                      |
| `npm run test:unit`                               | Full suite passes (or document pre-existing unrelated failures separately) |
| `npm run build:api`                               | API compiles — composition root unchanged                                  |
| Manual isolated bootstrap with real `RedisModule` | Optional — when Redis available                                            |

## Acceptance criteria

Mapped to backlog P1-07 / V-17:

| ID    | Criterion                                                                                                                                        | Verification method                                           | Pass condition                                                                               |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| AC-1  | P1-07 fix implemented and scoped correctly                                                                                                       | Diff + scope review                                           | Only planned files/symbols changed; no P1-06 bleed                                           |
| AC-2  | `AuthModule.forRoot(authOptions, { imports: [redisModule] })` bootstrap passes                                                                   | Targeted spec `compile()`                                     | Exit 0; `TOKENS.AuthTokenService` resolves for JWT and session drivers                       |
| AC-3  | `AuthModule.forRoot(authOptions)` without required dependency fails fast with clear validation error **or** is no longer supported as public API | Negative spec or manual call                                  | Actionable error naming `imports` / `RedisModule` (fail-fast preferred over Nest generic DI) |
| AC-4  | Redis dependency visible at composition root                                                                                                     | Code review of `forRoot` signature + docs                     | Second `registration` argument documented and used in examples                               |
| AC-5  | Docs do not show hidden global dependency pattern                                                                                                | Review `docs/infrastructure-modules/README.md`, `EXAMPLES.md` | Explicit `imports: [redisModule]` in Auth examples                                           |
| AC-6  | Unit tests use public API only                                                                                                                   | Review `auth.module.spec.ts`                                  | No post-registration `dynamicModule.imports = [...]` mutation                                |
| AC-7  | `npm run build` passes                                                                                                                           | Execute and record                                            | Exit 0                                                                                       |
| AC-8  | `npm run lint` passes                                                                                                                            | Execute and record                                            | Exit 0 or only pre-existing unrelated failures documented                                    |
| AC-9  | Optional custom store override without Redis imports                                                                                             | Spec if P1-07 includes it                                     | Compiles with custom `TOKENS.JwtTokenStore` provider                                         |
| AC-10 | Optional real Redis isolated bootstrap                                                                                                           | Manual scenario when infra available                          | `RedisModule` + `AuthModule.forRoot(..., { imports })` compiles                              |

**Verdict rules:**

- **`approved`** — AC-1 through AC-8 pass; AC-9–AC-10 passed or explicitly unverified with infra note.
- **`changes-required`** — any of AC-1–AC-6 fail, or sync `forRoot` still requires import mutation / hidden Redis wiring.
- **`not-confirmed`** — targeted spec or build could not run (missing deps, environment failure unrelated to code).

## Risks

1. **False approval from build-only checks** — `npm run build` passes on unfixed `main`; targeted `auth.module.spec.ts` is mandatory.
2. **Test workaround persists** — if spec still mutates `dynamicModule.imports`, V-17 must fail even if tests pass.
3. **Fail-fast vs Nest DI error** — approving generic Nest “can't resolve RedisService” without registration-time assertion does not meet AC-3 unless API is explicitly deprecated/removed.
4. **Custom store override detection gaps** — `useExisting` / `useFactory` override forms may be missed; verify at least `useClass` and `useValue` if documented.
5. **P1-07 not approved/implemented** — V-17 verification blocked until implementation completes.
6. **Scope bleed into P1-06** — verifier should reject unrelated `AuthApplicationCompositionModule` repository wiring changes unless required and documented.

## Rollback strategy

Verification is read-only. If verdict is `changes-required`, revert to P1-07 implementer — no verifier code changes.

## Open questions requiring human decision

1. **Verification ordering** — must V-17 wait for a separate P1-07 verification report (`docs/agent-reports/P1-07-verification.md`), or is V-17 the canonical portability verification for this defect?
2. **Session driver coverage** — is JWT-driver spec sufficient for V-17 approval, or must session driver positive/negative cases be mandatory?
3. **`forRootAsync` fail-fast** — if P1-07 adds async registration guard, must V-17 verify negative `forRootAsync` without `imports`, or is sync `forRoot` scope enough?
4. **Runtime bootstrap requirement** — is targeted DI spec sufficient for `approved`, or is manual `RedisModule.forRoot` + `AuthModule.forRoot` bootstrap mandatory when Redis is available?
5. **P1-07 plan approval** — P1-07 plan is currently `status: proposed`; confirm human approval before implementation begins.
