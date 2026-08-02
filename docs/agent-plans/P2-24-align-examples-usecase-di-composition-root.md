---
issue_id: P2-24
status: approved
owner: human-approval-required
---

# P2-24 — Align `EXAMPLES.md` use-case DI with composition-root pattern

## Source issue

- Backlog ID: `P2-24`
- Index: `docs/agent-backlog/INDEX.md`
- Full text: `docs/agent-backlog/NESTJS_STARTER_KIT_REQUIRED_FIXES.md` § P2-24
- Review source: `docs/agent-reports/full-review-2026-08-02.md` (§ 4 — EXAMPLES Nest DI in Application use cases)
- Title: Align `EXAMPLES.md` use-case DI with composition-root pattern

## Current behavior

Confirmed on the current branch (inspected 2026-08-02):

1. **`EXAMPLES.md` §1 Step 3** teaches an Application use case that imports Nest:

   - `import { Inject, Injectable } from '@nestjs/common'`
   - `@Injectable()` on `GetUserByIdUseCase`
   - `@Inject(TOKENS.UserRepository)` in the constructor
   - Path shown: `libs/application/src/use-cases/users/get-user-by-id.usecase.ts`

2. **Same section — composition snippet** registers the use case as a bare class provider:

   - `providers: [GetUserByIdUseCase]` / `exports: [GetUserByIdUseCase]`
   - That only works if the class carries Nest metadata (`@Injectable` / `@Inject`), which Application must not.

3. **`EXAMPLES.md` §2** step list still says: inject via `@Inject(TOKENS.…)` and add the class to `Module` `providers` + `exports`.

4. **Actual Application layer** — every auth use case under `libs/application/src/use-cases/auth/` is a plain TypeScript class with port-typed constructors (no Nest imports). Grep: **zero** `@nestjs` matches under `libs/application`.

5. **Actual composition root** — `apps/api/src/composition/auth-application.module.ts` wires each use case with `provide` + `inject` + `useFactory` (e.g. `GetCurrentUserUseCase` mirrors the EXAMPLES “get user” shape).

6. **`AGENTS.md`** states: Application use cases are plain TypeScript classes; Nest DI wiring belongs in composition roots only.

7. **Other EXAMPLES Nest usage** that is **correct** for apps/entrypoints (not Application):
   - Controllers (`@Controller`, `@UseGuards`) — §1, §5, §6
   - Worker processor (`@Processor`) — §10
   - Cron schedule (`@Injectable`, `@Cron`) — §11
   - Infrastructure `useFactory` for Redis/BullMQ options — §13

8. **Ambiguous snippet** — §10 “Постановка в чергу” shows `constructor(@Inject(TOKENS.QueueGateway) …)` without stating layer. If readers put that in Application, it repeats the anti-pattern; enqueue from a use case should receive `IQueueGateway` via constructor port + composition `useFactory` (see `ForgotPasswordUseCase` wiring).

9. No production code change is required; Application and composition already match the intended pattern. `EXAMPLES.md` is not dirty in git relative to the anti-pattern (issue is present in committed docs).

## Confirmed root cause

`EXAMPLES.md` still documents a Nest-in-Application DI style (`@Injectable` / `@Inject` inside `libs/application` use cases, and bare class providers that depend on that metadata). The codebase and agent rules reject that pattern; composition roots alone own Nest wiring via `useFactory`.

## Dependency/runtime flow

```text
libs/application/.../*.usecase.ts
  -> plain class, constructor(ports: IUserRepository, …)
  -> NO @nestjs/common

apps/<entrypoint>/src/composition/*-application.module.ts
  -> { provide: XUseCase, inject: [TOKENS.…], useFactory: (...ports) => new XUseCase(...ports) }
  -> exports: [XUseCase]

apps/<entrypoint> controller / processor / schedule
  -> Nest-injects XUseCase by class token
  -> calls execute(...)
```

Canonical live reference: `GetCurrentUserUseCase` + `AuthApplicationCompositionModule` `GetCurrentUserUseCase` provider.

## Goal

Rewrite the misleading Application DI examples in `EXAMPLES.md` so they teach constructor ports + composition-root `useFactory` / `inject` wiring, matching auth use cases and `AGENTS.md`. Leave Nest decorators only where they belong (API/Worker/Cron adapters).

## Scope

- Update `EXAMPLES.md` §1 Step 3 use-case snippet to a plain class (aligned with `GetCurrentUserUseCase`).
- Update `EXAMPLES.md` §1 composition-module snippet to `provide` / `inject` / `useFactory` (aligned with `AuthApplicationCompositionModule`).
- Update `EXAMPLES.md` §2 numbered steps to the same pattern (no `@Inject` inside Application).
- Cross-check remaining EXAMPLES sections for Nest-in-Application guidance; fix or clarify the §10 queue-enqueue fragment so it does not imply Application may import `@Inject`.
- Optionally add a one-line pointer to `apps/api/src/composition/auth-application.module.ts` as the live reference (EXAMPLES already mentions auth refs near the end — keep consistent).
- Register this plan in `docs/agent-plans/INDEX.md` (planner hygiene).

## Out of scope

- P2-16 … P2-23, P2-25+, and any other backlog items.
- Any production code under `libs/`, `apps/`, `scripts/`, `package.json`, or runtime config.
- Changing `AGENTS.md`, `README.md`, or `MODULES_OVERVIEW_NON_TECH.md` unless a human expands scope (README cron `@Injectable` example is apps-layer and correct).
- Inventing a real `users` feature / `UsersApplicationCompositionModule` / `get-user-by-id.usecase.ts` in the tree — EXAMPLES may keep illustrative paths, but the DI pattern must match production.
- HTTP/OpenAPI/Postman — documentation-only; no endpoint changes.

### HTTP / OpenAPI / Postman

This fix does **not** add or change HTTP endpoints. No OpenAPI or `docs/postman/` updates. Do not require `npm run test:postman-coverage` for acceptance.

## Files to create

- None for the fix itself (plan file only at planning time).

## Files to modify

| Path | What changes |
| --- | --- |
| `EXAMPLES.md` | §1 use-case snippet: remove `@Injectable` / `@Inject` / `@nestjs/common`; plain constructor with `IUserRepository`. §1 composition snippet: replace bare `providers: [GetUserByIdUseCase]` with `inject` + `useFactory`. §2 steps: constructor ports + composition `useFactory`. §10 (if needed): clarify enqueue DI is apps/composition or show port + factory. Keep Ukrainian prose style unless human decides otherwise. |
| `docs/agent-plans/INDEX.md` | Add `P2-24` row pointing at this plan (status `proposed`). |

## Files to delete

- None.

## Contract and DI changes

- **No** contract, token, provider, or composition-root code changes.
- Documentation must describe the existing DI contract:
  - Application: plain classes, port interfaces from `@contracts`.
  - Composition: Nest `provide` / `inject` / `useFactory` constructing those classes.
  - Apps adapters may use Nest decorators freely.

## Implementation steps

1. Edit `EXAMPLES.md` §1 Step 3 use-case block to match `libs/application/src/use-cases/auth/get-current-user.usecase.ts` shape (plain class; `import type { IUserRepository }`; no Nest).
2. Edit §1 composition block so `UsersApplicationCompositionModule` (illustrative) registers:

   ```ts
   {
     provide: GetUserByIdUseCase,
     inject: [TOKENS.UserRepository],
     useFactory: (users: IUserRepository) => new GetUserByIdUseCase(users),
   }
   ```

   Keep `imports: [RepositoriesModule]` (or note `RepositoriesModule.register({…})` if aligning with auth’s dynamic register — prefer the simplest accurate snippet; see open questions).
3. Replace §2 steps 2–3 with: type constructor ports; register via composition `useFactory`; consume from controller/processor/schedule.
4. Grep `EXAMPLES.md` for `@Injectable`, `@Inject`, `@nestjs/common` in contexts labeled as Application / use-case files; fix or relabel. Leave controller/cron/processor Nest usage.
5. Clarify §10 queue-enqueue constructor fragment (apps schedule/controller **or** use-case port + composition factory — do not teach `@Inject` inside `libs/application`).
6. Spot-check that the closing auth reference line still points readers at real composition (`auth-application.module.ts`).
7. Update `docs/agent-plans/INDEX.md` with this plan row if not already present at implementation time.

## Migration and rollout concerns

- Documentation-only. No migrations, env changes, or deploy ordering.
- Integrators copying the old Nest-in-Application pattern should switch to composition factories; no runtime break for existing correct code.

## Targeted verification

1. Grep `EXAMPLES.md` — no `@Injectable` / `@Inject` / `from '@nestjs/common'` inside snippets whose path or prose is Application use cases (`libs/application/...`).
2. Confirm §1 composition snippet shows `useFactory` constructing the use case.
3. Confirm §2 no longer says to `@Inject` inside Application.
4. Diff-only review: only `EXAMPLES.md` (+ plans index) changed; no `libs/` / `apps/` edits.
5. Optional: `rg "@nestjs" libs/application` still returns zero (sanity that docs were not “fixed” by adding Nest to Application).

## Full verification

- No build/lint/test gate required for a docs-only change (`AC-03`).
- If the implementer touches only markdown: skip `npm run build` / `npm run lint` / test suites unless the human expands scope.
- Record commands actually run (at minimum the greps above) in the implementer report.

## Acceptance criteria

- **AC-01:** EXAMPLES no longer instruct Nest decorators (`@Injectable`, `@Inject`, `@nestjs/common`) inside Application use cases.
- **AC-02:** Examples match the real composition-root pattern used by auth use cases (`provide` / `inject` / `useFactory` in composition modules; plain constructors in Application).
- **AC-03:** No production code change required (and none made).

## Risks

- Over-simplifying `RepositoriesModule` in the illustrative composition snippet vs auth’s `RepositoriesModule.register({ imports: [drizzleModule] })` may still leave a mild docs gap — acceptable if called out as illustrative and readers are pointed at `auth-application.module.ts`.
- Clarifying §10 poorly could confuse Worker/API enqueue vs use-case enqueue; keep layer labels explicit.
- Ukrainian/English mix: changing only code fences and leaving surrounding Ukrainian is preferred for consistency.

## Rollback strategy

- Revert the `EXAMPLES.md` (and plans-index) commit. No runtime rollback.

## Open questions requiring human decision

1. **Composition snippet fidelity:** Keep a minimal static `@Module({ imports: [RepositoriesModule], providers: [{ useFactory…}] })` illustration, or show a shortened `static register(...)` / `RepositoriesModule.register` shape closer to `AuthApplicationCompositionModule`?
2. **§10 enqueue fragment:** Prefer (a) label as apps-layer Nest inject, or (b) rewrite as Application port + composition `useFactory` using `ForgotPasswordUseCase` as reference?
3. **Illustrative paths:** Keep fictional `users/get-user-by-id.usecase.ts` / `users-application.module.ts`, or retarget the primary example to real `GetCurrentUserUseCase` + `AuthApplicationCompositionModule` to avoid inventing files?
)
