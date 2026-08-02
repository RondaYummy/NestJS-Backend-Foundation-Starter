# NestJS Starter Kit — required fixes

This file is the source of truth for confirmed bugfix issues.

**Baseline evidence:** `docs/agent-reports/full-review-2026-08-02.md` (branch `main` @ `aad6f2f`, 2026-08-02).

Retired completed IDs must never be reused: `P1-01` … `P1-07`, `P2-01` … `P2-15`, `P3-01` … `P3-04`.

## Issue template

```markdown
## P0-00. Short issue title

**Severity:** Critical | High | Medium | Low
**Classification:** Confirmed defect

### Evidence

### Root cause

### Required change

### Acceptance criteria
```

Add an issue here only after reproducing it in the current branch. Add the same stable ID to `INDEX.md`, then follow the planning, approval, implementation and independent-verification workflow from `AGENTS.md`.

---

# Priority backlog

## P0 — Critical

_(none)_

## P1 — High

_(none)_

## P2 — Medium

| ID      | Classification         | Title                                                               |
| ------- | ---------------------- | ------------------------------------------------------------------- |
| `P2-16` | Confirmed defect       | Fix CronModule ioredis mock so `test:module` passes with BullMQ     |
| `P2-17` | Confirmed defect       | Fail-closed or explicit-skip when integration tests lack PostgreSQL |
| `P2-18` | Confirmed defect       | Align Dockerfile Node major with `.nvmrc` / CI                      |
| `P2-19` | Architectural risk     | Register JwtModule in `AuthModule.forRootAsync` only for JWT driver |
| `P2-20` | Architectural risk     | Add configurable BullMQ key prefix for Redis isolation              |
| `P2-21` | Architectural risk     | Require JWT secrets in env schema only when `AUTH_DRIVER=jwt`       |
| `P2-22` | Architectural risk     | Document DomainEventRouter multi-handler at-least-once semantics    |
| `P2-23` | Architectural risk     | Add CI workflow for build, lint, unit and module gates              |
| `P2-24` | Documentation mismatch | Align `EXAMPLES.md` use-case DI with composition-root pattern       |
| `P2-25` | Documentation mismatch | Correct MODULES outbox BullMQ `jobId` description                   |

---

## P2-16. Fix CronModule ioredis mock so `test:module` passes with BullMQ

**Severity:** Medium  
**Classification:** Confirmed defect  
**Source:** full-review-2026-08-02

### Evidence

- `apps/cron/src/cron.module.spec.ts` mocks `ioredis` as `jest.fn().mockImplementation(...)` without a CJS `.default` export.
- `npm run test:module` fails with `TypeError: ioredis_1.default is not a constructor` inside `bullmq/.../redis-connection.js` while compiling `CronModule`.
- Other `*.module.spec.ts` suites pass (13 passed / 1 failed).

### Root cause

BullMQ does `require('ioredis').default`. The Cron module-spec mock is incompatible with that CJS shape, so Queue bootstrap fails under the DI gate even without real Redis.

### Required change

1. Fix `jest.mock('ioredis')` in `apps/cron/src/cron.module.spec.ts` to export `{ __esModule: true, default: RedisMock }` (or a shared helper used by BullMQ-heavy specs).
2. Provide the Redis client methods BullMQ needs for construct/close (`on`, `connect`, `quit`, `disconnect`, `status`, etc.).
3. Re-run `npm run test:module` until green; spot-check other specs that mock `ioredis` under BullMQ bootstrap.

### Acceptance criteria

- **AC-01:** `npm run test:module` exits 0 with `CronModule` suite passing.
- **AC-02:** Failure mode `ioredis_1.default is not a constructor` no longer appears for CronModule bootstrap.
- **AC-03:** No production Cron/BullMQ behavior change required solely for this fix.

---

## P2-17. Fail-closed or explicit-skip when integration tests lack PostgreSQL

**Severity:** Medium  
**Classification:** Confirmed defect  
**Source:** full-review-2026-08-02

### Evidence

- `libs/infrastructure/src/outbox/drizzle-outbox-processor.int-spec.ts` — `isPostgresAvailable()`; on `false`, `console.warn` + early `return` inside `it(...)`.
- `npm run test:int` reported 8 passed with PostgreSQL unavailable on localhost — silent skip looks like success.
- Open-handle / force-exit warning was also observed (tracked separately as P3-09).

### Root cause

Availability probes soft-skip assertions without `describe.skip`, fail, or a non-zero policy, so the integration gate cannot distinguish “infra missing” from “behavior verified”.

### Required change

1. Choose an explicit policy: fail-closed when Postgres missing **or** `describe.skip` / dedicated skip reporting with non-success summary when `INTEGRATION=1` (or equivalent) is unset/unavailable.
2. Apply consistently to all `*.int-spec.ts` that probe availability.
3. Document the policy in `AGENTS.md` and/or README (how agents/CI must interpret `test:int`).

### Acceptance criteria

- **AC-01:** Running `test:int` without PostgreSQL cannot report a fully green suite that implies outbox DB asserts ran.
- **AC-02:** When PostgreSQL is available, existing outbox lease/heartbeat asserts still run.
- **AC-03:** Docs state the chosen skip/fail policy for operators and agents.

---

## P2-18. Align Dockerfile Node major with `.nvmrc` / CI

**Severity:** Medium  
**Classification:** Confirmed defect  
**Source:** full-review-2026-08-02

### Evidence

- `Dockerfile`: `FROM node:24-bookworm-slim AS base`
- `.nvmrc`: `22.22.1`
- `.github/workflows/release-artifact.yml`: `node-version-file: '.nvmrc'`
- `package.json` engines: `>=22.22.1 <25` (both majors allowed, but image ≠ local/CI)

### Root cause

Production container major Node differs from the documented local/CI pin without an intentional, documented upgrade.

### Required change

1. Pin Dockerfile base image to the same major/patch family as `.nvmrc` (preferred: `node:22.22.1-bookworm-slim`), **or** consciously bump `.nvmrc`/CI to 24 and document it.
2. Keep `package.json` engines consistent with the chosen pin.
3. Verify `npm ci` / `npm run build` on the chosen major.

### Acceptance criteria

- **AC-01:** Dockerfile Node major matches `.nvmrc` (and release workflow node version).
- **AC-02:** Engines range still covers the chosen runtime.
- **AC-03:** Build succeeds on the aligned Node version.

---

## P2-19. Register JwtModule in `AuthModule.forRootAsync` only for JWT driver

**Severity:** Medium  
**Classification:** Architectural risk  
**Source:** full-review-2026-08-02

### Evidence

- `libs/infrastructure/src/auth/auth.module.ts` — `forRootAsync` always imports `JwtModule.registerAsync`.
- Non-JWT options return `{ secret: 'session-driver-jwt-placeholder' }`.
- Sync `forRoot` correctly registers `JwtModule` only for JWT.
- Portability rule: do not create both JWT and Session implementations when only one driver is selected.

### Root cause

Async registration cannot know the driver before options resolve, so the current implementation always wires JwtModule and uses a hardcoded placeholder secret for session mode.

### Required change

1. Make `forRootAsync` register `JwtModule` only when resolved options are JWT (`isJwtAuthOptions`).
2. Session path must not import JwtModule or inject `JwtService`.
3. Add/extend `auth.module.spec.ts` to assert session driver does not expose Jwt providers.
4. Update composition if export/provider graph changes.

### Acceptance criteria

- **AC-01:** With `AUTH_DRIVER=session` via `forRootAsync`, JwtModule / placeholder secret are not registered.
- **AC-02:** JWT driver via `forRootAsync` still issues/verifies tokens as today.
- **AC-03:** Sync `forRoot` JWT-only behavior remains intact.
- **AC-04:** Unit/module coverage asserts driver isolation for async registration.

---

## P2-20. Add configurable BullMQ key prefix for Redis isolation

**Severity:** Medium  
**Classification:** Architectural risk  
**Source:** full-review-2026-08-02

### Evidence

- Redis app keys use `REDIS_KEY_PREFIX` / `RedisKeyBuilder`.
- `InfrastructureBullMqModule.buildBullConnection` passes host/port/db/password only — no BullMQ `prefix`.
- Queue registration has no prefix option; shared Redis DB can collide on `bull:*` keys across projects.

### Root cause

Queue namespace isolation was never plumbed through BullMQ module options / env, despite Redis prefix being a starter portability feature.

### Required change

1. Add configurable BullMQ `prefix` via module options + env (e.g. derive from / complement `REDIS_KEY_PREFIX`).
2. Pass prefix into `BullModule.forRoot` / `forRootAsync` connection/queue config.
3. Update `.env.example` and infrastructure module docs.

### Acceptance criteria

- **AC-01:** Integrators can set a BullMQ prefix without editing module internals.
- **AC-02:** Two compositions with different prefixes do not share BullMQ key namespaces on the same Redis DB (documented + unit/config coverage as feasible).
- **AC-03:** Default remains backward-compatible or documented as a deliberate breaking config addition.

---

## P2-21. Require JWT secrets in env schema only when `AUTH_DRIVER=jwt`

**Severity:** Medium  
**Classification:** Architectural risk  
**Source:** full-review-2026-08-02

### Evidence

- `libs/infrastructure/src/config/env.schema.ts` — `JWT_SECRET` / `JWT_REFRESH_SECRET` always `z.string().min(1)`.
- Production entropy checks also apply to JWT fields regardless of `AUTH_DRIVER`.

### Root cause

Env validation is not driver-conditional, so session-only deployments must still supply JWT secrets.

### Required change

1. Use `superRefine` (or equivalent) so JWT secrets are required only when `AUTH_DRIVER=jwt`.
2. Apply production entropy rules only for the JWT driver.
3. Update config specs and `.env.example` comments.

### Acceptance criteria

- **AC-01:** Valid session-driver env without JWT secrets loads successfully.
- **AC-02:** JWT driver without secrets fails validation.
- **AC-03:** Production entropy checks still enforce strong JWT secrets when driver is JWT.
- **AC-04:** Unit coverage for both driver branches.

---

## P2-22. Document DomainEventRouter multi-handler at-least-once semantics

**Severity:** Medium  
**Classification:** Architectural risk  
**Source:** full-review-2026-08-02

### Evidence

- `libs/infrastructure/src/events/domain-event.router.ts` runs handlers sequentially; a later throw marks outbox failed and retries the whole event.
- Today only one production handler (`UserRegisteredEventHandler`) is registered — latent multi-handler risk.
- README already states at-least-once / idempotent handlers; multi-handler checkpointing is absent.

### Root cause

All-or-nothing handler fan-out without per-handler progress means a successful earlier side effect can re-run after a later handler fails.

### Required change

1. Document hard rule for integrators: prefer one handler per event **or** require idempotent handlers under at-least-once retry (update README / MODULES / short ADR if needed).
2. Do **not** claim exactly-once or per-handler checkpointing unless implemented.
3. Optional follow-up (out of minimal scope): design per-handler outbox status — only if explicitly expanded later.

### Acceptance criteria

- **AC-01:** Docs explicitly describe multi-handler retry duplication risk and required idempotency.
- **AC-02:** No false exactly-once claims remain for DomainEventRouter.
- **AC-03:** Code change not required for the minimal doc/ADR fix unless plan expands scope.

---

## P2-23. Add CI workflow for build, lint, unit and module gates

**Severity:** Medium  
**Classification:** Architectural risk  
**Source:** full-review-2026-08-02

### Evidence

- `.github/workflows/release-artifact.yml` runs `npm ci`, `npm run release:check`, and gitleaks only.
- No workflow runs `npm run build`, `lint`, `test:unit`, or `test:module` on PRs.
- Current `test:module` failure (P2-16) would not be caught by existing CI.

### Root cause

Quality gates exist as npm scripts but are not enforced in GitHub Actions for everyday changes.

### Required change

1. Add `.github/workflows/ci.yml` (or extend an existing workflow) running at least: `build`, `lint`, `test:unit`, `test:module`.
2. Use `.nvmrc` for Node version.
3. Optionally document / separately gate `test:int` with services (do not silently green-skip — see P2-17).

### Acceptance criteria

- **AC-01:** PR/push CI runs build + lint + unit + module.
- **AC-02:** Workflow uses the same Node pin as `.nvmrc`.
- **AC-03:** Release/gitleaks workflow remains intact unless intentionally merged.

---

## P2-24. Align `EXAMPLES.md` use-case DI with composition-root pattern

**Severity:** Medium  
**Classification:** Documentation mismatch  
**Source:** full-review-2026-08-02

### Evidence

- `EXAMPLES.md` shows `@Injectable()` / `@Inject(TOKENS…)` from `@nestjs/common` inside application use cases.
- Actual `libs/application` use cases are plain classes; Nest wiring lives in `AuthApplicationCompositionModule` factories.
- Grep: zero `@nestjs` imports under `libs/application`. `AGENTS.md` requires composition-root DI only.

### Root cause

Examples teach a Nest-in-Application pattern that the codebase and agent rules reject.

### Required change

1. Rewrite relevant `EXAMPLES.md` snippets to constructor ports + composition `useFactory` / provider wiring.
2. Remove guidance that Application use cases should import `@nestjs/common`.
3. Cross-check other EXAMPLES sections for the same anti-pattern.

### Acceptance criteria

- **AC-01:** EXAMPLES no longer instruct Nest decorators inside Application use cases.
- **AC-02:** Examples match the real composition-root pattern used by auth use cases.
- **AC-03:** No production code change required.

---

## P2-25. Correct MODULES outbox BullMQ `jobId` description

**Severity:** Medium  
**Classification:** Documentation mismatch  
**Source:** full-review-2026-08-02

### Evidence

- `MODULES_OVERVIEW_NON_TECH.md` claims BullMQ job uses a stable `jobId` built from the outbox event id.
- Actual `OutboxSchedule` enqueues a single job with `jobId: 'outbox-process-pending'`.
- Per-event ids appear downstream (e.g. email `welcome-email:${event.id}`), not on the outbox queue job.

### Root cause

Docs describe a per-event outbox queue dedupe model that the cron→claim→handler pipeline does not use.

### Required change

1. Update MODULES (and README if duplicated) to describe the two-stage flow: fixed cron jobId → DB claim/batch → handler enqueue with per-event jobId/idempotency.
2. Do not invent code changes unless a plan explicitly chooses to implement per-event outbox jobIds.

### Acceptance criteria

- **AC-01:** Docs match `OutboxSchedule` / processor behavior.
- **AC-02:** No remaining claim that outbox queue jobId equals outbox event id unless code is changed to do so.

---

## P3 — Low

| ID      | Classification         | Title                                                                   |
| ------- | ---------------------- | ----------------------------------------------------------------------- |
| `P3-05` | Confirmed defect       | Map missing `Idempotency-Key` to HTTP 400 instead of 409                |
| `P3-06` | Architectural risk     | Stop making `LoggerModule` globally registered by default               |
| `P3-07` | Architectural risk     | Harden `OutboxProcessorModule.forRoot` against empty connection imports |
| `P3-08` | Documentation mismatch | Clarify Cache/Storage as optional until wired in entrypoints            |
| `P3-09` | Likely defect          | Fix integration-test open-handle leak / Jest force-exit                 |
| `P3-10` | Architectural risk     | Map `AuthGuard` failures through AppError envelope                      |
| `P3-11` | Documentation mismatch | Clarify Compose `db:migrate` vs `db:migrate:prod` advisory lock         |

---

## P3-05. Map missing `Idempotency-Key` to HTTP 400 instead of 409

**Severity:** Low  
**Classification:** Confirmed defect  
**Source:** full-review-2026-08-02

### Evidence

- Idempotency interceptor throws `ConflictError('IDEMPOTENCY_KEY_REQUIRED', ...)`.
- `GlobalExceptionFilter` maps `ConflictError` → HTTP 409.
- Missing required header is client validation, not a resource conflict.

### Root cause

Wrong domain/app error type for a missing request header produces a misleading status code for clients and OpenAPI consumers.

### Required change

1. Throw a validation-style error that maps to HTTP 400 (existing `ValidationError` or equivalent).
2. Update OpenAPI / error docs and unit specs.
3. Update Postman expectations if they assert 409 for this case.

### Acceptance criteria

- **AC-01:** Missing `Idempotency-Key` on guarded routes returns HTTP 400.
- **AC-02:** True idempotency conflicts remain 409 where appropriate.
- **AC-03:** OpenAPI/Postman aligned with the new status.

---

## P3-06. Stop making `LoggerModule` globally registered by default

**Severity:** Low  
**Classification:** Architectural risk  
**Source:** full-review-2026-08-02

### Evidence

- `libs/infrastructure/src/logger/logger.module.ts` sets `global: true` in `forRoot*`.
- Portability guidance prefers explicit imports over hidden global modules.

### Root cause

Logger coupling is implicit; extracting a submodule can miss an undeclared logger dependency.

### Required change

1. Prefer non-global `LoggerModule` and explicit imports in API/Worker/Cron composition roots, **or** document an intentional global exception in module docs if keeping `global: true`.
2. Ensure all entrypoints that need logging still resolve the logger token after the change.

### Acceptance criteria

- **AC-01:** Either logger is explicitly imported everywhere needed, or docs clearly mark the global exception.
- **AC-02:** Entrypoints still bootstrap logging without DI failures.
- **AC-03:** Module/unit coverage updated for the chosen approach.

---

## P3-07. Harden `OutboxProcessorModule.forRoot` against empty connection imports

**Severity:** Low  
**Classification:** Architectural risk  
**Source:** full-review-2026-08-02

### Evidence

- `outbox-processor.module.ts` `forRoot` calls `buildFeatureImports([], handlers)` — Audit/Events can be built without Drizzle/BullMQ imports.
- Production Worker uses `forRootAsync` with proper imports (OK); sync API remains an integrator footgun.

### Root cause

Public sync registration accepts an incomplete graph that looks valid at type level but fails or mis-wires at runtime for consumers who copy the sync API.

### Required change

1. Require connection/feature imports in `forRoot`, **or** deprecate/remove sync `forRoot` in favor of async-only with mandatory imports.
2. Document the supported registration path.

### Acceptance criteria

- **AC-01:** Sync API cannot silently build a processor graph with empty connection imports (compile-time or runtime guard).
- **AC-02:** Worker `forRootAsync` path remains working.
- **AC-03:** Docs/examples show only the supported registration style.

---

## P3-08. Clarify Cache/Storage as optional until wired in entrypoints

**Severity:** Low  
**Classification:** Documentation mismatch  
**Source:** full-review-2026-08-02

### Evidence

- README / MODULES present Cache and Storage as part of the system module set.
- `CacheModule` / `StorageModule` exist but no entrypoint imports them.

### Root cause

Documentation can be read as “already wired in API/Worker/Cron” rather than “optional adapters available to compose”.

### Required change

1. Mark Cache/Storage as optional adapters that must be imported in a composition root when needed.
2. Link to extraction / EXAMPLES guidance where applicable.
3. Do not add demo wiring unless a separate TASK explicitly requests it.

### Acceptance criteria

- **AC-01:** Docs no longer imply Cache/Storage are active in default entrypoints.
- **AC-02:** Code remains unchanged unless a separate approved task adds wiring.

---

## P3-09. Fix integration-test open-handle leak / Jest force-exit

**Severity:** Low  
**Classification:** Likely defect  
**Source:** full-review-2026-08-02

### Evidence

- `npm run test:int` completed with open-handle warnings and Jest force-exit (architecture-reviewer run).
- Likely leftover Pool/Redis/Nest handles after suites that connect when infra is present, or incomplete teardown even on skip paths.

### Root cause

Integration suites do not fully close clients/handles before Jest exits, so the runner force-exits and can hide lifecycle bugs.

### Required change

1. Identify open handles (`--detectOpenHandles`) for `*.int-spec.ts`.
2. Ensure `afterAll`/`afterEach` always end pools/clients/modules.
3. Confirm `test:int` exits cleanly without force-exit when infra is available; skip path also must not leak.

### Acceptance criteria

- **AC-01:** `test:int` no longer requires Jest force-exit under normal conditions.
- **AC-02:** Teardown covers both skipped and connected paths.
- **AC-03:** No production runtime change unless a real adapter leak is found and fixed with evidence.

---

## P3-10. Map `AuthGuard` failures through AppError envelope

**Severity:** Low  
**Classification:** Architectural risk  
**Source:** full-review-2026-08-02 (compact backlog)

### Evidence

- `AuthGuard` throws Nest `UnauthorizedException` instead of domain/application `AuthenticationError` (or equivalent AppError).
- Global AppError mapping path then differs from other auth failures that use domain errors.

### Root cause

Mixed exception types produce inconsistent HTTP error envelopes for unauthenticated requests versus other mapped auth errors.

### Required change

1. Throw the project’s auth AppError type from `AuthGuard` (or map Nest unauthorized into the same filter envelope).
2. Align OpenAPI error examples if needed.
3. Add/adjust unit tests for response shape.

### Acceptance criteria

- **AC-01:** Unauthenticated guarded requests use the same error envelope as other AppError auth failures.
- **AC-02:** Status remains 401 for unauthenticated access.
- **AC-03:** OpenAPI/docs match the envelope.

---

## P3-11. Clarify Compose `db:migrate` vs `db:migrate:prod` advisory lock

**Severity:** Low  
**Classification:** Documentation mismatch  
**Source:** full-review-2026-08-02 (compact backlog)

### Evidence

- `docker-compose` migrations service runs `npm run db:migrate` (dev migrate path).
- Production one-shot path `db:migrate:prod` uses session advisory lock and bounded timeouts.
- Operators can confuse local Compose migrate with the production-safe entrypoint.

### Root cause

Ops docs do not make the local vs production migration command distinction explicit enough next to Compose.

### Required change

1. Document in README / Compose comments / ops docs that Compose uses local `db:migrate`, while production must use `db:migrate:prod` / migrations entrypoint with advisory lock.
2. No change to Compose defaults required unless a separate plan chooses to switch local service to prod runner.

### Acceptance criteria

- **AC-01:** Docs clearly separate Compose local migrate from production advisory-locked migrate.
- **AC-02:** No accidental instruction to run unprotected migrate against production.
