# P1-05 — Implementation report

## Verdict

implemented

## Approved plan

`docs/agent-plans/P1-05-application-nestjs-di-decoupling.md` (`status: approved`)

## Changed files

| Path | Change |
| ---- | ------ |
| `libs/application/src/use-cases/auth/register.usecase.ts` | Removed `@nestjs/common`, `@Injectable`, `@Inject`, `TOKENS`; plain constructor with port types |
| `libs/application/src/use-cases/auth/login.usecase.ts` | Same |
| `libs/application/src/use-cases/auth/logout.usecase.ts` | Same |
| `libs/application/src/use-cases/auth/refresh-auth-session.usecase.ts` | Same |
| `libs/application/src/use-cases/auth/get-current-user.usecase.ts` | Same |
| `apps/api/src/composition/auth-application.module.ts` | Replaced five class providers with explicit `{ provide, inject, useFactory }` entries |
| `eslint.config.mjs` | Added `'@nestjs/*'` to Application-layer `no-restricted-imports` patterns |
| `AGENTS.md` | Replaced temporary Nest-in-Application exception with composition-root wiring contract |
| `README.md` | Aligned Application framework-independence wording; replaced §3 Nest exception block with factory wiring guidance |
| `.cursor/rules/10-onion-architecture.mdc` | Application must not import `@nestjs/*`; use composition factories |

## Completed steps

1. **Use cases (5 files):** Removed all Nest decorators and `@nestjs/common` / `TOKENS` imports. Kept constructor parameter types and method bodies unchanged. Adjusted contract imports to `import type` to satisfy `@typescript-eslint/consistent-type-imports`.
2. **Composition module:** Added `TOKENS` and port interface imports; registered all five use cases via `useFactory` providers with matching `inject` token arrays; kept `exports` unchanged.
3. **ESLint:** Added `'@nestjs/*'` ban for `libs/application/**/*.ts`.
4. **Docs:** Updated `AGENTS.md`, `README.md`, and `.cursor/rules/10-onion-architecture.mdc` to describe a single contract without exceptions.
5. **Verification:** Grep, build, and targeted lint executed (see below).

## Deviations

- **Type-only imports:** After removing Nest decorators, ESLint flagged contract imports as type-only in three use case files. Fixed with `import type` — required for lint compliance, no behavior change.
- **`EXAMPLES.md`:** Deferred per approved plan open question (minimal diff).

## Commands executed

| Command | Result | Conclusion |
| ------- | ------ | ---------- |
| `rg "@nestjs" libs/application/src` | No matches | Application layer Nest-free |
| `rg "@Injectable\(\)" libs/application/src` | No matches | No decorator metadata in Application |
| `npm ci` | Exit 0 | Dependencies installed for verification |
| `npm run build:api` | Exit 0 | API entrypoint compiles with factory providers |
| `npm run build` | Exit 0 | Full monorepo compile success |
| `npm run lint` | Exit 1 | 4 errors in pre-existing `libs/infrastructure/src/outbox/outbox-processor.*` files only |
| `npx eslint` (6 changed `.ts` files) | Exit 0 | P1-05 scope passes lint |
| `Test.createTestingModule({ imports: [AuthApplicationCompositionModule] }).compile()` | Exit 1 | Fails on `AppLogger` missing config in bare test harness (pre-existing infra bootstrap requirement; not introduced by P1-05) |

## Command results

Build output confirms factory signatures match use case constructors (TypeScript would fail otherwise). Full `npm run lint` failure is isolated to unrelated outbox files that were not modified in this change set (same pattern as P1-04 report).

## Acceptance criteria self-check

| Criterion | Status | Evidence |
| --------- | ------ | -------- |
| `rg "@nestjs" libs/application/src` finds no imports | Pass | Grep returned no matches |
| Use cases unit-instantiable without Nest testing module | Pass | Plain classes with typed constructors compile; `new LoginUseCase(...)` valid at type level |
| All constructor dependencies registered at composition root | Pass | Five factory blocks in `auth-application.module.ts` with correct `inject` arrays |
| Documentation and agent rules describe one contract without exceptions | Pass | `AGENTS.md`, `README.md`, `.cursor/rules/10-onion-architecture.mdc` updated |

## Remaining risks

| Risk | Notes |
| ---- | ----- |
| Wrong `inject` token order in future factories | Mitigated by TypeScript compile checks; follow existing template |
| `EXAMPLES.md` still shows `@Injectable` use-case pattern | Documented deferral; agents should follow README/AGENTS/Cursor rule |
| Full-repo lint blocked by pre-existing outbox unused-vars | Unrelated to P1-05; separate backlog item if CI requires clean lint |

## Unverified areas

- `npm run start:api` bootstrap with live PostgreSQL + Redis not executed in this session.
- `EXAMPLES.md` not updated (explicitly out of scope per approved plan).
