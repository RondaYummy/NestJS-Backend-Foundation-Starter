---
issue_id: P3-06
status: approved
owner: human-approval-required
---

# P3-06 — Stop making `LoggerModule` globally registered by default

## Source issue

- Backlog ID: `P3-06`
- Index: `docs/agent-backlog/INDEX.md`
- Full text: `docs/agent-backlog/NESTJS_STARTER_KIT_REQUIRED_FIXES.md` § P3-06
- Review source: `docs/agent-reports/full-review-2026-08-02.md` (Low — `LoggerModule.forRoot*` `global: true`)

## Current behavior

Confirmed on current `main` (inspected 2026-08-02):

1. `libs/infrastructure/src/logger/logger.module.ts` — `LoggerModule.forRoot` and `LoggerModule.forRootAsync` both return `global: true`.
2. Entrypoints already import a configured logger dynamic module at the composition root:
   - `apps/api/src/api.module.ts` — `loggerModule = LoggerModule.forRootAsync(...)` in `ApiModule` imports; also passed into `ExceptionsModule.register({ imports: [loggerModule] })`.
   - `apps/worker/src/worker.module.ts` — same `loggerModule` pattern in `WorkerModule` imports.
   - `apps/cron/src/cron.module.ts` — same `loggerModule` pattern in `CronModule` imports.
3. Nested / peer modules inject `AppLogger` **without** importing `LoggerModule` themselves and currently rely on Nest global registration:
   - `RedisModule` (`libs/infrastructure/src/redis/redis.module.ts`) — `REDIS_CLIENT` factory `inject: [MODULE_OPTIONS_TOKEN, AppLogger]`.
   - `MailModule.forRootAsync` (`libs/infrastructure/src/mail/mail.module.ts`) — `TOKENS.EmailGateway` factory injects `AppLogger` for null driver; sync `forRoot` registers `NullMailAdapter` which constructor-injects `AppLogger`.
   - `DrizzleOutboxProcessor` / `AuditLogger` — inject `AppLogger`; wired via `OutboxProcessorModule` → `AuditModule.register({ imports: connectionImports })` without requiring logger in `connectionImports` today (Worker passes drizzle/queues/config only).
   - `AuthApplicationCompositionModule` — `ForgotPasswordUseCase` factory injects `AppLogger`; optional `options.imports` exists but API does not pass `loggerModule` today.
   - API controllers (`AuthController`, `GoogleAuthController`, `SessionsController`), `EmailProcessor`, `OutboxSchedule`, and entrypoint `main.ts` `application.get(AppLogger)` resolve logger from the root module graph / global module.
4. Docs currently state logger is global:
   - `docs/infrastructure-modules/README.md` registration matrix: `LoggerModule` — “Global; options `level`, `pretty`”.
   - `docs/infrastructure-modules/EXTRACTION_GUIDE.md` § LoggerModule: “`forRoot` / `forRootAsync` — global”.
   - `EXTRACTION_GUIDE` § ExceptionsModule already warns: “do not rely on ambient global registration alone” (inconsistent with LoggerModule being global).
5. Module specs such as `redis.module.spec.ts` and `mail.module.spec.ts` import `LoggerModule.forRoot` as a **sibling** of `RedisModule` / `MailModule` under the testing root — that pattern only works today because of `global: true`. Nested peer DI would fail after removing global without putting `LoggerModule` into the peer module’s own `imports`.
6. Migrations entrypoint does not use `LoggerModule` / `AppLogger`.
7. No HTTP route, OpenAPI schema, or Postman collection depends on `LoggerModule.global`.

## Confirmed root cause

`LoggerModule.forRoot*` registers Nest `global: true`, so `AppLogger` (and related exports) are ambiently available to every module. That hides logger peer coupling: a submodule can inject `AppLogger` without declaring `LoggerModule` in its `imports`, which contradicts portability guidance (“do not hide required dependencies behind unrelated global modules”) and makes extractions/copied graphs easy to mis-wire.

The backlog allows either removing global + explicit imports **or** documenting an intentional global exception. This plan recommends the **preferred** path: non-global + explicit peer wiring.

## Dependency/runtime flow

```text
Composition root (ApiModule / WorkerModule / CronModule)
  -> LoggerModule.forRootAsync(...)   // today: global: true
       exports: AppLogger, RequestContextService, RequestContextMiddleware

  -> RedisModule.forRootAsync({ imports: [InfrastructureConfigModule] })
       REDIS_CLIENT factory injects AppLogger   // resolves via global today

  -> MailModule.forRootAsync({ imports: [InfrastructureConfigModule] })  // Worker
       EmailGateway factory injects AppLogger   // resolves via global today

  -> OutboxProcessorModule.forRootAsync({ imports: [config, drizzle, queues] })
       -> AuditModule / DrizzleOutboxProcessor inject AppLogger  // via global today

  -> AuthApplicationCompositionModule.register({ redis, drizzle, queues })
       ForgotPasswordUseCase factory injects AppLogger  // via global today

  -> ExceptionsModule.register({ imports: [loggerModule] })  // already explicit

  -> Controllers / processors / schedules / main.ts get(AppLogger)
       // root-import path; still valid if LoggerModule remains imported by root
```

After the fix, every provider that injects `AppLogger` must see `LoggerModule` through its own module `imports` chain (or a parent that re-exports it into that module), not via Nest global registry.

## Goal

Make `LoggerModule` non-global by default; require explicit `LoggerModule` (or equivalent exporting `AppLogger`) in composition-root peer `imports` wherever `AppLogger` is injected; keep API/Worker/Cron bootstrap logging working; align module docs and tests with the explicit-peer model.

## Scope

- Set `global: false` (or omit `global`) on `LoggerModule.forRoot` and `LoggerModule.forRootAsync`.
- Wire the existing `loggerModule` dynamic module into every entrypoint peer registration that injects `AppLogger` (Redis, Mail, Outbox/Audit path, Auth composition).
- Update module/unit specs that currently rely on sibling global registration.
- Align `docs/infrastructure-modules/README.md` and `EXTRACTION_GUIDE.md` LoggerModule “global” wording with non-global + explicit imports.
- Add/adjust coverage asserting non-global registration and that missing peer imports fail DI (AC-03).
- Register this plan in `docs/agent-plans/INDEX.md` (planner hygiene).

## Out of scope

- P3-05, P3-07+, P2-xx, and any other backlog items.
- Changing `AppLogger` / pino implementation, log fields, or request-context behavior.
- Making `RedisModule` / `MailModule` / `OutboxProcessorModule` auto-import `LoggerModule` internally (that would hide the peer again).
- Publishing npm packages or changing path-alias layout.
- Migrations entrypoint changes.
- HTTP endpoints, OpenAPI, or Postman (`docs/postman/`).
- Approach B (keep `global: true` and docs-only exception) unless a human rejects Approach A in open questions.

### HTTP / OpenAPI / Postman

This fix does **not** add or change HTTP endpoints. No OpenAPI decorator/schema updates and no `docs/postman/` collection updates are required. Do not run `npm run test:postman-coverage` as acceptance for this issue.

## Files to create

- None required for production. Optional: none — prefer extending existing `logger.module.spec.ts` / peer specs over new files.

## Files to modify

| Path | Symbol / responsibility |
| --- | --- |
| `libs/infrastructure/src/logger/logger.module.ts` | `LoggerModule.forRoot` / `forRootAsync` — remove `global: true` (set `global: false` or omit). |
| `apps/api/src/api.module.ts` | Pass `loggerModule` into `RedisModule.forRootAsync({ imports })` and into `AuthApplicationCompositionModule.register({ imports: [loggerModule], ... })` (and any other API peer that injects `AppLogger` if discovered during implementation). Keep root `imports: [loggerModule, ...]` and `ExceptionsModule.register({ imports: [loggerModule] })`. |
| `apps/worker/src/worker.module.ts` | Pass `loggerModule` into `RedisModule.forRootAsync`, `MailModule.forRootAsync`, and `OutboxProcessorModule.forRootAsync` `imports` (so Audit / `DrizzleOutboxProcessor` resolve `AppLogger`). |
| `apps/cron/src/cron.module.ts` | Pass `loggerModule` into `RedisModule.forRootAsync` `imports` (Cron injects logger in `OutboxSchedule` via root import; Redis still needs peer). |
| `apps/api/src/composition/auth-application.module.ts` | Ensure `ForgotPasswordUseCase` / any `AppLogger` injection resolves via `options.imports` containing configured `LoggerModule` (document required peer in register options JSDoc if not already clear). |
| `libs/infrastructure/src/logger/logger.module.spec.ts` | Assert returned dynamic module is not global; keep bootstrapping `AppLogger` / request-context exports. |
| `libs/infrastructure/src/redis/redis.module.spec.ts` | Stop relying on sibling global `LoggerModule`; put `LoggerModule.forRoot(...)` into `RedisModule.forRootAsync({ imports })` (or sync `forRoot` only if sync API is extended — prefer async in tests to avoid API churn). |
| `libs/infrastructure/src/mail/mail.module.spec.ts` | Same for null/smtp registration paths that need `AppLogger`. |
| `libs/infrastructure/src/outbox/outbox-processor.module.spec.ts` | Include `LoggerModule` in connection/`forRoot*` imports used by Audit/processor when global is removed (today uses sibling `LoggerModule.forRoot`). |
| `apps/api/src/composition/auth-application.module.spec.ts` | Pass configured `LoggerModule` via composition `imports` / testing module so `ForgotPasswordUseCase` DI still works. |
| `apps/cron/src/cron.module.spec.ts` | Adjust overrides/imports if removing global breaks `AppLogger` resolution. |
| `docs/infrastructure-modules/README.md` | Registration matrix + LoggerModule section: replace “Global” with non-global / explicit import guidance; note peers must receive `LoggerModule` via `imports`. |
| `docs/infrastructure-modules/EXTRACTION_GUIDE.md` | LoggerModule API row: remove “— global”; reinforce peer wiring for Redis/Mail/Audit/Outbox/Exceptions. |
| `docs/agent-plans/INDEX.md` | Register this plan row (planner hygiene; already done when plan is proposed). |

Additional peer specs touched only if they fail after the change (inspect during implementation): `libs/infrastructure/src/exceptions/exceptions.module.spec.ts` (already passes logger in `imports` — likely OK), `libs/infrastructure/src/mail/mail.module.spec.ts` (listed above).

## Files to delete

- None.

## Contract and DI changes

- **Public Nest registration contract:** `LoggerModule.forRoot` / `forRootAsync` DynamicModule is **no longer global**. Integrators and peer modules must import a configured `LoggerModule` (or another module that exports `AppLogger`) into the module that injects `AppLogger`.
- **Tokens / exports unchanged:** `LOGGER_MODULE_OPTIONS`, `AppLogger`, `RequestContextService`, `RequestContextMiddleware` remain the exports.
- **No contracts library (`libs/contracts`) changes.**
- **Composition-root DI:** entrypoint `forRootAsync` / `register` `imports` arrays gain `loggerModule` wherever nested providers inject `AppLogger`.
- **Preferred test/DI pattern for Redis/Mail sync `forRoot`:** use `forRootAsync({ imports: [LoggerModule.forRoot(...)], useFactory: () => options })` in specs rather than expanding sync `forRoot` signatures, unless implementation finds sync `forRoot` demo paths in docs that must keep working without async (then add optional `imports` to sync `forRoot` as a minimal API extension — call out in PR if needed).
- **Breaking for external copy-kit consumers** who relied on ambient global `AppLogger` without declaring the peer: they must add explicit imports (aligned with portability goals).

## Implementation steps

1. Change `LoggerModule.forRoot` and `forRootAsync` to non-global (`global: false` or omit `global`).
2. Update `ApiModule`, `WorkerModule`, and `CronModule` so every peer registration that injects `AppLogger` includes the same `loggerModule` instance in its `imports` array:
   - Redis (all three entrypoints)
   - Mail (Worker)
   - OutboxProcessor (Worker) — include logger in `connectionImports` so Audit/processor see it
   - Auth composition (API) — `register({ imports: [loggerModule], ... })`
3. Keep root-level `imports: [loggerModule, ...]` so controllers, processors, schedules, middleware, and `main.ts` `application.get(AppLogger)` continue to resolve.
4. Update `logger.module.spec.ts` to assert non-global DynamicModule metadata and successful local resolution of exports.
5. Update Redis/Mail/Outbox/Auth-composition/Cron module specs to use explicit logger peer imports (no sibling-global assumption).
6. Update `docs/infrastructure-modules/README.md` and `EXTRACTION_GUIDE.md` to describe non-global registration and explicit peer imports; remove contradictory “Global” matrix text.
7. Run targeted then full verification commands below; fix only DI/import gaps revealed by failures (do not expand into unrelated module cleanups).

## Migration and rollout concerns

- **Starter-kit apps in this repo:** fixed in the same change set via composition-root wiring — no env or migration changes.
- **Downstream forks / extracted modules:** removing `global: true` is a **behavioral breaking change** for any custom module that injected `AppLogger` without importing `LoggerModule`. Document in module docs; no DB/Redis migration.
- **Rollout:** single PR; no feature flag. Prefer merging after `test:module` proves entrypoint graphs compile.
- **No secrets, Docker, or schema changes.**

## Targeted verification

| Command | Intent |
| --- | --- |
| `npx jest libs/infrastructure/src/logger/logger.module.spec.ts --runInBand` | Non-global registration + exports resolve. |
| `npx jest libs/infrastructure/src/redis/redis.module.spec.ts libs/infrastructure/src/mail/mail.module.spec.ts libs/infrastructure/src/exceptions/exceptions.module.spec.ts libs/infrastructure/src/outbox/outbox-processor.module.spec.ts --runInBand` | Peer modules resolve `AppLogger` only via explicit imports. |
| `npx jest apps/api/src/composition/auth-application.module.spec.ts apps/cron/src/cron.module.spec.ts --runInBand` | Composition / Cron module specs still boot. |
| `npm run test:module` | Entrypoint/module bootstrap graphs (API/Worker/Cron) with non-global logger. |
| `npm run build` | Typecheck/compile after DI import wiring. |

Optional if infra available (not required to prove DI wiring): `npm run start:api` / `start:worker` / `start:cron` smoke — confirm bootstrap reaches listening / ready without `Nest can't resolve dependencies of AppLogger` (or missing `AppLogger`) errors. Separate infra unavailability from DI failure.

## Full verification

| Command | Intent |
| --- | --- |
| `npm run build` | Full compile. |
| `npm run lint` | No new lint debt from import wiring. |
| `npm run test:unit` | Unit gate. |
| `npm run test:module` | Module/bootstrap gate. |

`npm run test:int` is **not** required for this DI/docs change unless an unexpected Outbox/Redis int-spec failure appears during implementation.

Do **not** treat missing PostgreSQL/Redis as a project defect for this issue.

## Acceptance criteria

- **AC-01:** Either logger is explicitly imported everywhere needed, or docs clearly mark the global exception. → **This plan:** non-global + explicit imports in composition roots and docs (not a documented global exception).
- **AC-02:** Entrypoints still bootstrap logging without DI failures (`AppLogger` resolvable in API/Worker/Cron module graphs and `main.ts` `get`/`useLogger` paths).
- **AC-03:** Module/unit coverage updated for the chosen approach (non-global assertion + peer-import specs / fixed sibling-global tests).

Mapped checks:

| AC | Evidence |
| --- | --- |
| AC-01 | `logger.module.ts` has no `global: true`; entrypoints pass `loggerModule` into peer `imports`; docs no longer call LoggerModule globally registered by default. |
| AC-02 | `test:module` + logger/redis/mail/outbox/auth-composition specs pass; no unresolved `AppLogger` in entrypoint graphs. |
| AC-03 | `logger.module.spec.ts` and updated peer specs cover non-global / explicit import behavior. |

## Risks

- **Hidden consumers:** any provider injecting `AppLogger` without an import path will only surface at Nest compile/bootstrap — mitigate with `test:module` and grep for `AppLogger` inject sites before completion.
- **Duplicate `LoggerModule.forRoot*` instances:** composing multiple distinct `LoggerModule.forRootAsync` calls could register multiple option providers; keep **one** `loggerModule` const per entrypoint and reuse that reference in all peer `imports` (current pattern already uses a single const).
- **Sync `forRoot` demos:** README/EXTRACTION snippets using `RedisModule.forRoot` / `MailModule.forRoot` beside a sibling `LoggerModule.forRoot` will stop working for readers who copy literally; docs must show logger inside peer `imports` or use async registration.
- **Copy-kit break:** external projects relying on global logger need a one-line import wiring change.

## Rollback strategy

Revert the single PR / restore `global: true` on `LoggerModule.forRoot*` and undo composition-root `imports` additions and doc wording. No data migration or lockfile rollback required unless unrelated dependency edits were introduced (they should not be).

## Open questions requiring human decision

1. **Approach confirmation:** Approve Approach A (remove `global: true` + explicit peer imports — this plan) vs Approach B (keep `global: true` and only document an intentional global exception in `docs/infrastructure-modules/*`). Issue allows either; portability rules favor A.
2. **Sync `forRoot` API:** If docs/tests need sync `RedisModule.forRoot` / `MailModule.forRoot` with an explicit logger peer, may implementers add optional `imports` to those sync APIs, or must they only demonstrate `forRootAsync`? Default in this plan: prefer `forRootAsync` in tests/docs; extend sync API only if a human requires it.
3. **Semver / changelog:** Should the PR call out a breaking composition-behavior note for fork consumers in README release notes, or is infrastructure-modules doc update sufficient for this starter kit?
