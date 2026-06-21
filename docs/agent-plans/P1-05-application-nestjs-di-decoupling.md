---
issue_id: P1-05
status: approved
owner: human-approval-required
---

# P1-05 — Remove NestJS DI decorators from Application use cases

## Source issue

`docs/agent-backlog/NESTJS_STARTER_KIT_REQUIRED_FIXES.md` — section **P1-05. Прибрати NestJS DI decorators з Application або офіційно змінити архітектурний контракт**.

Related references: `AGENTS.md` (Application layer note), `README.md` §1 and §3, `.cursor/rules/10-onion-architecture.mdc`.

**Investigation (2026-06-21, branch `main`, clean working tree):** defect confirmed. Issue is **not stale**.

## Current behavior

1. **Five auth use cases** in `libs/application/src/use-cases/auth/` import `@nestjs/common` and use `@Injectable()` plus `@Inject(TOKENS.*)`:
   - `register.usecase.ts` — 4 injected ports;
   - `login.usecase.ts` — 3 injected ports;
   - `logout.usecase.ts` — 1 injected port;
   - `refresh-auth-session.usecase.ts` — 1 injected port;
   - `get-current-user.usecase.ts` — 1 injected port.
2. **`AuthApplicationCompositionModule`** (`apps/api/src/composition/auth-application.module.ts`) registers use case classes directly in `providers` / `exports` (Nest auto-wires via decorators).
3. **`AuthController`** (`apps/api/src/controllers/auth.controller.ts`) injects use case classes by type; no change required if composition keeps `provide: LoginUseCase` etc.
4. **ESLint** (`eslint.config.mjs`, block `files: ['libs/application/**/*.ts']`) restricts infrastructure imports but **does not** restrict `@nestjs/*`, so the architectural violation is not enforced.
5. **Documentation is contradictory:**
   - `README.md` line 57 calls Application “framework-independent” while admitting Nest decorators;
   - `README.md` §3 (“Application залежить від NestJS”) explicitly allows `@Injectable()` / `@Inject()`;
   - `AGENTS.md` documents a temporary exception (“do not expand this coupling”);
   - `.cursor/rules/10-onion-architecture.mdc` tolerates decorators as “documented current state”.

No other `@nestjs` imports exist under `libs/application/src` today.

## Confirmed root cause

Use cases own Nest container metadata (`@Injectable`, `@Inject`) instead of plain constructor injection. Composition responsibility sits inside Application classes, while docs simultaneously claim framework-independent Application and document a Nest exception.

## Dependency/runtime flow

### Current

```text
AuthApplicationCompositionModule.providers
  -> RegisterUseCase (@Injectable + @Inject(TOKENS.*))
       -> Nest resolves TOKENS.* from imported infrastructure modules
AuthController
  -> constructor(RegisterUseCase, LoginUseCase, ...)
```

### Target (minimal)

```text
AuthApplicationCompositionModule.providers
  -> { provide: LoginUseCase, inject: [TOKENS.*], useFactory: (...) => new LoginUseCase(...) }
       -> TOKENS.* resolved at composition boundary only
LoginUseCase
  -> constructor(users: IUserRepository, passwords: IPasswordHasher, ...) // no Nest imports
AuthController
  -> unchanged (still injects LoginUseCase by class token)
```

## Goal

Restore a single, unambiguous architecture contract: **Application use cases are plain TypeScript classes with port-typed constructors; Nest wiring lives only in composition roots.** Achieve this with the smallest possible diff.

## Scope

**Chosen approach:** recommended backlog variant (remove decorators + explicit factory providers).  
**Rationale for minimal edits:** only five use cases and one composition module contain Nest coupling; no Worker/Cron/Migrations consumers; no new abstractions or helper modules required.

| Change | Files | Approx. effort |
| ------ | ----- | -------------- |
| Strip Nest decorators/imports; keep typed constructors | 5 use case files | Mechanical |
| Replace class providers with `useFactory` entries | 1 composition module | ~5 factory blocks |
| Enforce boundary | 1 ESLint rule line | 1 pattern add |
| Align docs to one contract | 3 short doc edits | Remove exception wording |

## Out of scope

- **Documentation-only fix** (officially allowing Nest in Application) — rejected because it fails acceptance criteria (`rg "@nestjs" libs/application/src` must be empty; docs must describe one contract without exceptions).
- New ADR file — fold contract into existing `AGENTS.md` / `README.md` instead.
- New use-case unit tests — none exist today; not required to close this issue.
- `EXAMPLES.md` full rewrite — optional follow-up; not blocking if README + AGENTS are aligned (note under open questions).
- Refactoring `AuthController` or other interface adapters.
- Removing `@nestjs/*` from `apps/*` or `libs/infrastructure/*` (expected and correct).
- Touching Worker, Cron, or Migrations entrypoints (no Application Nest coupling there).
- Changing `libs/contracts` tokens or port interfaces.

## Files to create

None.

## Files to modify

| File | Symbol / responsibility |
| ---- | ----------------------- |
| `libs/application/src/use-cases/auth/register.usecase.ts` | Remove `@Injectable`, `@Inject`, `@nestjs/common` import, unused `TOKENS` import; keep constructor params `IUserRepository`, `IPasswordHasher`, `ITransactionManager`, `IOutboxWriter`. |
| `libs/application/src/use-cases/auth/login.usecase.ts` | Same pattern; ports: `IUserRepository`, `IPasswordHasher`, `IAuthTokenService`. |
| `libs/application/src/use-cases/auth/logout.usecase.ts` | Same pattern; port: `IAuthTokenService`. |
| `libs/application/src/use-cases/auth/refresh-auth-session.usecase.ts` | Same pattern; port: `IAuthTokenService`. |
| `libs/application/src/use-cases/auth/get-current-user.usecase.ts` | Same pattern; port: `IUserRepository`. |
| `apps/api/src/composition/auth-application.module.ts` | Import `TOKENS` and port types; replace five class entries in `providers` with explicit `{ provide, inject, useFactory }` factories; keep same `exports` class tokens. |
| `eslint.config.mjs` | In `files: ['libs/application/**/*.ts']` → `no-restricted-imports.patterns`, add `'@nestjs/*'`. |
| `AGENTS.md` | Replace temporary-exception sentence under Application with: Application use cases are plain classes; Nest DI wiring belongs in composition roots only. |
| `README.md` | Line 57: state Application depends on Domain/Contracts only (framework-independent). Remove or rewrite §3 “Application залежить від NestJS” block (~lines 252–254) to describe composition-root factory wiring instead. |
| `.cursor/rules/10-onion-architecture.mdc` | Replace “tolerated only as documented current state” with: Application must not import `@nestjs/*`; register use cases via composition factories. |

## Files to delete

None.

## Contract and DI changes

- **Public API:** unchanged — controllers still depend on use case classes.
- **Tokens:** unchanged — `TOKENS.*` remain defined in Contracts; used only in `auth-application.module.ts` and infrastructure providers.
- **DI registration:** moves from Application decorators to explicit factories in `AuthApplicationCompositionModule`.
- **Breaking change:** none for HTTP API consumers; internal only.

### Factory template (per use case)

```ts
{
  provide: LoginUseCase,
  inject: [TOKENS.UserRepository, TOKENS.PasswordHasher, TOKENS.AuthTokenService],
  useFactory: (
    users: IUserRepository,
    passwords: IPasswordHasher,
    authTokens: IAuthTokenService,
  ) => new LoginUseCase(users, passwords, authTokens),
}
```

Apply the same pattern for `RegisterUseCase` (4 tokens), `LogoutUseCase`, `RefreshAuthSessionUseCase`, and `GetCurrentUserUseCase` (1 token each).

## Implementation steps

1. **Use cases (5 files):** delete `@nestjs/common` and `TOKENS` imports; remove `@Injectable()` and `@Inject(...)` decorators; leave `export class XUseCase` with unchanged constructor parameter types and method bodies.
2. **Composition module (1 file):** add imports for `TOKENS` and required port interfaces; replace the five bare class providers with factory providers matching each constructor signature; keep `exports` listing the five use case classes unchanged.
3. **ESLint (1 line):** add `'@nestjs/*'` to Application-layer restricted patterns to prevent regression.
4. **Docs (3 files):** align Application contract wording; remove contradictory “Nest in Application is OK” sections.
5. **Verify:** run targeted grep, build, lint (see below).

**Order:** steps 1–2 together (build will fail between 1 and 2 if only half done), then 3–5.

## Migration and rollout concerns

- Single deployable unit (API composition change only).
- No database, env, or queue migration.
- Rollback: revert the seven modified source/doc files.

## Targeted verification

| Command | Expected result |
| ------- | --------------- |
| `rg "@nestjs" libs/application/src` | No matches |
| `rg "@Injectable\\(\\)" libs/application/src` | No matches |
| `npm run build:api` | Success |
| `npm run lint` | Success; Application files must not trigger `@nestjs/*` import violations |

Optional manual check: instantiate a use case in a REPL or scratch test without `@nestjs/testing`:

```ts
new LoginUseCase(mockUsers, mockPasswords, mockAuthTokens);
```

## Full verification

```bash
npm run build
npm run lint
```

Bootstrap (if PostgreSQL + Redis available locally):

```bash
npm run start:api
```

Confirm auth routes still resolve (`RegisterUseCase`, `LoginUseCase`, etc.) via Nest DI after factory registration.

## Acceptance criteria

Mapped to backlog criteria:

| Criterion | Verification |
| --------- | ------------ |
| `rg "@nestjs" libs/application/src` finds no imports | Grep after implementation |
| Use cases unit-instantiable without Nest testing module | Plain `new UseCase(mockPorts...)` compiles |
| All constructor dependencies registered at composition root | Inspect `auth-application.module.ts` factory `inject` arrays |
| Documentation and agent rules describe one contract without exceptions | Review `AGENTS.md`, `README.md`, `.cursor/rules/10-onion-architecture.mdc` |

## Risks

| Risk | Mitigation |
| ---- | ---------- |
| Wrong `inject` token order in factory | Match constructor parameter order exactly; `build:api` catches type mismatches |
| Future use cases reintroduce `@nestjs` in Application | ESLint `@nestjs/*` ban on `libs/application/**` |
| `EXAMPLES.md` still shows old `@Injectable` use-case pattern | Document as follow-up or minimal single-example edit if human wants full doc parity in same PR |

## Rollback strategy

Revert commits touching the seven listed files. No schema or external state to unwind.

## Open questions requiring human decision

1. **`EXAMPLES.md`:** update the “Крок 3. Use case” example in the same PR, or defer to a documentation-only follow-up? (Recommended for minimal diff: defer; README + AGENTS + Cursor rule are sufficient for agent workflow.)
2. **`MODULES_OVERVIEW_NON_TECH.md`:** no Nest mention today; no change required unless human wants explicit “plain use case classes” wording.
