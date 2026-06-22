---
issue_id: V-16
status: approved
owner: human-approval-required
---

# V-16 — API Auth composition resolves `TOKENS.UserRepository` inside Auth/JWT registration

## Source issue

`docs/agent-backlog/NESTJS_STARTER_KIT_REQUIRED_FIXES.md` — verification backlog row **V-16**:

> API Auth composition resolves `TOKENS.UserRepository` inside Auth/JWT registration

**Linked defect:** **P1-06** (`docs/agent-backlog/NESTJS_STARTER_KIT_REQUIRED_FIXES.md` — section P1-06; implementation plan `docs/agent-plans/P1-06-user-repository-di-visibility.md`).

**Investigation (2026-06-22, branch `main`):** verification scenario is **not stale**. The underlying DI defect from P1-06 is still present in production code. V-16 cannot return `approved` until P1-06 is implemented and independently verified.

## Current behavior

1. **`AuthApplicationCompositionModule.register(...)`** (`apps/api/src/composition/auth-application.module.ts`) calls `AuthModule.forRootAsync` with:

   ```ts
   imports: [InfrastructureConfigModule, redisModule],
   inject: [AppConfigService, TOKENS.UserRepository],
   ```

2. **`RepositoriesModule.register({ imports: [drizzleModule] })`** is registered only as a **sibling** import in the composition root `return { imports: [...] }` (line 84). It is **not** included in `AuthModule.forRootAsync({ imports: [...] })`.

3. **`AuthModule.forRootAsync`** (`libs/infrastructure/src/auth/auth.module.ts`, lines 51–75) forwards `asyncOptions.imports` and `asyncOptions.inject` to nested `JwtModule.registerAsync(...)`. Both `AUTH_MODULE_OPTIONS` and `JWT_MODULE_OPTIONS` factories share the same `inject` array.

4. **Use-case factories** in the composition module resolve `TOKENS.UserRepository` correctly because `RepositoriesModule` is a sibling import of `AuthApplicationCompositionModule`.

5. **Nested Auth/JWT subgraph** cannot resolve `TOKENS.UserRepository` because Nest module encapsulation limits injection to providers exported from modules in the **current module’s** `imports` tree. Sibling composition imports do not propagate into `AuthModule` / `JwtModule`.

6. **TypeScript build succeeds; Nest runtime bootstrap fails** after infrastructure startup with an error of the form:

   ```text
   Nest can't resolve dependencies of the JWT_MODULE_OPTIONS (AppConfigService, ?).
   Please make sure that the argument Symbol(IUserRepository) at index [1] is available in the JwtModule module.
   ```

7. **No targeted DI regression spec exists** for `AuthApplicationCompositionModule` (`apps/api/src/composition/auth-application.module.spec.ts` is absent).

8. **Historical context:** P2-06 added `TOKENS.UserRepository` to the auth `useFactory` for fresh-user resolution (`resolveAccessUser` / `resolveSessionUser`) without importing `RepositoriesModule` into the `AuthModule.forRootAsync` subgraph.

## Confirmed root cause

Same as P1-06: `TOKENS.UserRepository` is required by `AuthModule.forRootAsync` / nested `JwtModule.registerAsync` factories, but the module that exports that token (`RepositoriesModule`) is registered only at the composition root level, outside the Auth/JWT module import graph.

## Dependency/runtime flow

### Current (broken — V-16 would fail today)

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

### Expected after P1-06 (V-16 pass condition)

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

Independently confirm — with runtime evidence, not static inspection alone — that API Auth composition bootstraps without DI errors and that `TOKENS.UserRepository` is resolvable inside the Auth/JWT registration subgraph after P1-06 is implemented.

## Scope

| Activity                 | Responsibility        | Notes                                                                       |
| ------------------------ | --------------------- | --------------------------------------------------------------------------- |
| Fix DI wiring            | **P1-06 implementer** | Hoist `repositoriesModule`; pass into `AuthModule.forRootAsync` imports     |
| Add DI regression spec   | **P1-06 implementer** | `apps/api/src/composition/auth-application.module.spec.ts`                  |
| Independent verification | **V-16 verifier**     | Inspect diff, run commands, write `docs/agent-reports/V-16-verification.md` |

## Out of scope

- Implementing the P1-06 fix (separate approved plan).
- **`AuthModule.forRoot()` Redis visibility** — separate issue **P1-07** / verification **V-17**.
- Changes to `AuthModule`, `RepositoriesModule`, contracts, or use cases beyond what P1-06 specifies.
- Full HTTP auth flow testing (login/register/refresh) — covered by other verification items (e.g. V-11, V-18).
- Marking P1-06 or V-16 resolved in backlog INDEX without implementation + verification evidence.

## Files to create

| File                                      | Symbol / responsibility                                                        |
| ----------------------------------------- | ------------------------------------------------------------------------------ |
| `docs/agent-reports/V-16-verification.md` | Independent verification report (verifier output; not created during planning) |

**Prerequisite from P1-06 (implementer creates):**

| File                                                       | Symbol / responsibility                                                                                                                                      |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/api/src/composition/auth-application.module.spec.ts` | `describe('AuthApplicationCompositionModule')` — compile composition module; assert `JwtService`, `TOKENS.AuthTokenService`, `TOKENS.UserRepository` resolve |

## Files to modify

None during verification planning. Verifier inspects changes from P1-06:

| File                                                  | What to verify                                                                                                                                                     |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/api/src/composition/auth-application.module.ts` | `AuthApplicationCompositionModule.register` — single `repositoriesModule` instance passed to both `AuthModule.forRootAsync({ imports })` and composition `imports` |

## Files to delete

None.

## Contract and DI changes

- **Verifier expectation:** no public HTTP API, contract, or token changes.
- **DI graph:** `RepositoriesModule` must appear in the `AuthModule.forRootAsync` import subgraph (and therefore nested `JwtModule`) using one shared dynamic module instance per composition root.
- **Breaking change:** none expected.

## Implementation steps

V-16 is a verification issue. Steps below are for the **independent verifier** after P1-06 implementation is complete.

### Prerequisite gate

1. Confirm **P1-06 plan** frontmatter is `status: approved`.
2. Confirm P1-06 implementation exists (inspect `git diff`; read `docs/agent-reports/P1-06-implementation.md` if present, but do not trust it without code inspection).
3. If P1-06 is not implemented, stop and return verdict **`changes-required`** with note: underlying defect still open.

### Step 1 — Scope and diff review

1. Run `git status` and `git diff`.
2. Confirm only P1-06-scoped files changed (primarily `auth-application.module.ts` + new spec; optional doc note in `docs/infrastructure-modules/README.md`).
3. In `auth-application.module.ts`, confirm:
   - `const repositoriesModule = RepositoriesModule.register({ imports: [drizzleModule] })` exists;
   - `AuthModule.forRootAsync({ imports: [..., repositoriesModule] })` includes it;
   - composition `imports` reuses the same `repositoriesModule` variable (not a second `RepositoriesModule.register(...)` call).

### Step 2 — Static DI trace

Trace and document:

```text
AuthApplicationCompositionModule.register
  -> AuthModule.forRootAsync({ imports, inject })
    -> JwtModule.registerAsync({ imports, inject })
      -> JWT_MODULE_OPTIONS / AUTH_MODULE_OPTIONS factories
        -> inject: [AppConfigService, TOKENS.UserRepository]
          -> TOKENS.UserRepository from RepositoriesModule in import graph ✓
```

Confirm `libs/infrastructure/src/repositories/repositories.module.ts` exports `TOKENS.UserRepository` via `useExisting: UserDrizzleRepository`.

### Step 3 — Targeted unit verification (mandatory)

Run:

```bash
npm ci
npm run test:unit -- apps/api/src/composition/auth-application.module.spec.ts
```

**Expected:** spec compiles testing module and resolves without `Symbol(IUserRepository)` DI error.

**Spec must assert at minimum:**

- `Test.createTestingModule({ imports: [AuthApplicationCompositionModule.register({ redisModule, drizzleModule })] }).compile()` succeeds;
- `moduleRef.get(JwtService)` is defined (proves `JWT_MODULE_OPTIONS` resolved);
- `moduleRef.get(TOKENS.UserRepository)` is defined;
- `moduleRef.get(TOKENS.AuthTokenService)` is defined;
- `moduleRef.close()` called (avoid open Drizzle pool handles).

**Negative control (optional, pre-fix baseline only):** on unfixed `main`, the same spec must fail with the documented JwtModule DI error — confirms the test catches the defect.

### Step 4 — Build and lint

```bash
npm run build:api
npm run lint
```

Record exit codes. Build-only pass is **insufficient** for approval (defect is runtime DI, not compile-time).

### Step 5 — Optional runtime bootstrap

When PostgreSQL and Redis are available locally:

```bash
npm run start:api
```

**Expected:** API Nest application context starts without DI errors after Redis/PostgreSQL connection; no `JWT_MODULE_OPTIONS` / `Symbol(IUserRepository)` failure in logs.

If infrastructure is unavailable, record under **Unverified areas** — do not treat as project defect.

### Step 6 — Write verification report

Create `docs/agent-reports/V-16-verification.md` using structure from `.cursor/skills/change-verification/SKILL.md`:

```markdown
# V-16 — Independent verification

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

None for verification. P1-06 fix itself requires no migration or env changes.

## Targeted verification

| Command                                                                         | Expected result                                      |
| ------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `npm ci`                                                                        | Clean install succeeds                               |
| `npm run test:unit -- apps/api/src/composition/auth-application.module.spec.ts` | Passes; primary V-16 evidence                        |
| Code review of `auth-application.module.ts`                                     | Single `repositoriesModule` in Auth/JWT import graph |

## Full verification

| Command             | Expected result                                                            |
| ------------------- | -------------------------------------------------------------------------- |
| `npm run build:api` | API compiles                                                               |
| `npm run lint`      | No new lint errors from P1-06 changes                                      |
| `npm run test:unit` | Full suite passes (or document pre-existing unrelated failures separately) |
| `npm run start:api` | Optional — end-to-end bootstrap when PostgreSQL + Redis available          |

## Acceptance criteria

| ID   | Criterion                                                               | Verification method                      | Pass condition                                                        |
| ---- | ----------------------------------------------------------------------- | ---------------------------------------- | --------------------------------------------------------------------- |
| AC-1 | P1-06 fix implemented and scoped correctly                              | Diff + scope review                      | Only planned files/symbols changed                                    |
| AC-2 | `repositoriesModule` visible inside Auth/JWT subgraph                   | Static DI trace + code review            | `AuthModule.forRootAsync` imports include shared `repositoriesModule` |
| AC-3 | Composition bootstrap resolves `TOKENS.UserRepository` without DI error | Targeted spec `compile()`                | Exit 0; no `Symbol(IUserRepository)` error                            |
| AC-4 | `JWT_MODULE_OPTIONS` resolves at runtime                                | `moduleRef.get(JwtService)` in spec      | Defined                                                               |
| AC-5 | Single `RepositoriesModule.register(...)` instance per composition root | Code review                              | One `const repositoriesModule`; no duplicate register call            |
| AC-6 | `npm run build:api` passes                                              | Execute and record                       | Exit 0                                                                |
| AC-7 | `npm run lint` passes                                                   | Execute and record                       | Exit 0 or only pre-existing unrelated failures documented             |
| AC-8 | Optional API bootstrap                                                  | `npm run start:api` when infra available | No DI error in startup logs                                           |

**Verdict rules:**

- **`approved`** — AC-1 through AC-7 pass; AC-8 passed or explicitly unverified with infra note.
- **`changes-required`** — any of AC-1–AC-6 fail, or DI trace shows sibling-only `RepositoriesModule`.
- **`not-confirmed`** — targeted spec or build could not run (missing deps, environment failure unrelated to code).

## Risks

1. **False approval from build-only checks** — `npm run build:api` passes on unfixed `main`; targeted spec is mandatory.
2. **Test isolation failures** — spec may fail on env validation (`InfrastructureConfigModule` Zod) instead of DI; verifier must confirm failure mode matches DI vs config.
3. **Duplicate module instances** — passing spec with two separate `RepositoriesModule.register(...)` calls could mask lifecycle issues; AC-5 guards against this.
4. **P1-06 not approved/implemented** — V-16 verification blocked until implementation completes.

## Rollback strategy

Verification is read-only. If verdict is `changes-required`, revert to P1-06 implementer — no verifier code changes.

## Open questions requiring human decision

1. **Verification ordering** — must V-16 wait for a separate P1-06 verification report (`docs/agent-reports/P1-06-verification.md`), or is V-16 the canonical DI verification for this defect?
2. **Session driver coverage** — is one JWT-driver spec sufficient for V-16, or must the spec also compile with session driver options (P2-06 symmetry)?
3. **Runtime bootstrap requirement** — is targeted DI spec sufficient for `approved`, or is `npm run start:api` mandatory when Docker infra is available?
4. **P1-06 plan approval** — P1-06 plan is currently `status: proposed`; confirm human approval before implementation begins.
