---
task_id: TASK-006
specification: docs/agent-tasks/TASK-006-pino-pretty-development.md
status: approved
owner: human-approval-required
---

# TASK-006 — Implementation plan

## Approved specification

- Spec: `docs/agent-tasks/TASK-006-pino-pretty-development.md`
- Spec status: `approved` (verified in file frontmatter before planning; `docs/agent-tasks/INDEX.md` may still say `proposed` — treat the specification file as source of truth)
- Human decisions already frozen in the spec:
  1. **Pretty detection rule:** enable pino-pretty **only when `NODE_ENV === 'development'`**. Production and test keep structured JSON (no pretty transport).

### Planner-frozen decisions (were open in the spec)

| ID | Decision | Rationale |
| -- | -------- | --------- |
| **OQ-3 Dependency classification** | Move `pino-pretty` from `dependencies` to **`devDependencies`**; keep `pino` in `dependencies`. Update `package-lock.json` via intentional `npm install` / lockfile refresh for that move only. | Spec NFR-03 recommendation; production Docker stage runs `npm ci --omit=dev` (`Dockerfile` `production-dependencies`) and must not require pretty. Pretty transport is only constructed when `pretty === true` (`NODE_ENV=development`). Development image (`build-dependencies` / `development` target) uses full `npm ci`, so Compose continues to have `pino-pretty`. |
| **OQ-4 Migrations scope** | **Out of scope** — leave `apps/migrations` on `console.*`. | Spec A-03 / entrypoint table default; migrations do not bootstrap `LoggerModule` / `AppLogger`. |
| **OQ-5 Pretty options** | Use explicit developer-friendly options (not bare defaults): `colorize: true`, `translateTime: 'SYS:standard'`, `ignore: 'pid,hostname'`. Do **not** force `singleLine`. | Improves local readability without changing production JSON field schema; options apply only on the pretty transport path. |
| **OQ-6 Explicit opt-out** | **No** `LOGGER_PRETTY` (or similar) env flag in this task. Pretty is solely `NODE_ENV === 'development'`. | Honors the single frozen human decision; avoids inventing a second control plane. Developers who want JSON locally can set `NODE_ENV=test` or `production` (with awareness of other env-driven behavior). |

**Branch note:** Planning inspected `main` after TASK-005. Do **not** mix session-management, Google SSO, or other TASK IDs into this work.

## Current implementation

Inspected evidence (code and packaging, not docs alone):

| Area | Current behavior |
| ---- | ---------------- |
| `AppLogger` | `libs/infrastructure/src/logger/app-logger.service.ts` — `pino({ level: config.logger().level })` only; no `transport`; implements Nest `LoggerService` (`log`/`info`/`debug`/`warn`/`error`/`verbose`/`fatal`); merges `RequestContextService.get()` into every log context |
| `LoggerModule` | Provides/exports `AppLogger`, `RequestContextService`, `RequestContextMiddleware`; imports `InfrastructureConfigModule` |
| Config shape | `AppConfigService` / `ConfigShape.logger` = `{ level: string }` only |
| Env mapping | `InfrastructureConfigModule` → `logger: { level: e.LOGGER_LEVEL }`; `app.env` already maps `e.NODE_ENV` |
| Env schema | `NODE_ENV`: `development \| test \| production` (default `development`); `LOGGER_LEVEL` default `info`; **no** pretty-related env var |
| Dependencies | `package.json`: `pino` `^10.3.1` and `pino-pretty` `^13.1.3` both under **runtime `dependencies`**; `pino-pretty` unused in source |
| Entrypoints | API / Worker / Cron: `application.useLogger(AppLogger)` in respective `main.ts`; Migrations: `console.*` only |
| Docker | Compose services `api` / `worker` / `cron` / `migrations` build `target: development`, `env_file: .env` (example has `NODE_ENV=development`, `LOGGER_LEVEL=debug`). Production runtime: `NODE_ENV=production` + `npm ci --omit=dev` |
| Docs | README §5.2 documents structured JSON logs + request context; no pino-pretty. `.env.example` has `LOGGER_LEVEL` only. `EXAMPLES.md` has no logger section. `MODULES_OVERVIEW_NON_TECH.md` §10 is non-technical and does not mention JSON vs pretty |
| Tests | No `*logger*.spec.ts`; Jest unit config does not set `NODE_ENV` explicitly (Jest typically runs as `test`) |

## Architecture decision

### Single config-driven branch inside shared `AppLogger`

1. **Derive** `pretty: boolean` in the infrastructure config mapping as `e.NODE_ENV === 'development'` (not raw `process.env` inside `AppLogger`).
2. Extend typed logger config to `{ level: string; pretty: boolean }`.
3. In `AppLogger` constructor:
   - if `pretty === true` → `pino({ level, transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:standard', ignore: 'pid,hostname' } } })`;
   - else → `pino({ level })` with **no** `transport` key (structured JSON on stdout, current behavior).
4. Extract a pure helper **`buildPinoRootOptions(level: string, pretty: boolean)`** (new file under logger/) so unit tests assert branching without Nest bootstrap or worker-thread transport side effects.
5. **No** changes to API / Worker / Cron `main.ts` — they already use shared `AppLogger` (FR-04 / A-02).
6. **Do not** add OpenAPI, HTTP, DTO, or domain/application logger imports.

### Why not `config.app().env` alone?

Mapping `pretty` onto `logger` keeps logger options cohesive (`level` + `pretty`), matches FR-03 (“configuration available to infrastructure”), and avoids `AppLogger` interpreting broader app env for formatting concerns.

### Production safety

- Production / test never set `transport`, so they never `require('pino-pretty')`.
- Moving `pino-pretty` to `devDependencies` aligns image layers with that guarantee.
- Misconfiguring a production deploy as `NODE_ENV=development` while omitting `pino-pretty` would fail at logger construction — acceptable fail-fast; ops must keep production `NODE_ENV=production`.

## Scope

- Config mapping + `AppConfigService` / `ConfigShape` logger typing for `pretty`.
- `AppLogger` conditional pino-pretty transport via shared helper.
- Unit tests for option branching (and optionally a thin `AppLogger` smoke with mocked config asserting no throw / level filter behavior where practical).
- Move `pino-pretty` to `devDependencies` + lockfile update for that move.
- Document behavior in `.env.example` and README §5.2 (Logger Module).
- Verify builds for API / Worker / Cron and lint; confirm no OpenAPI diff.

## Out of scope

- Migrations Nest/`AppLogger` adoption or pretty-printing `console.*`.
- New env vars (`LOGGER_PRETTY`, etc.).
- Changing request-context middleware, log field schemas, redaction, or Nest `LoggerService` method signatures.
- File sinks, rotation, audit-logger changes, metrics/tracing.
- HTTP / OpenAPI / DTO / controller changes.
- `EXAMPLES.md` / `MODULES_OVERVIEW_NON_TECH.md` rewrites (not required by AC-05; README + `.env.example` suffice).
- Other TASK IDs or backlog bugfixes.

## Files to create

| Path | Purpose |
| ---- | ------- |
| `libs/infrastructure/src/logger/build-pino-options.ts` | Pure `buildPinoRootOptions(level, pretty)` returning pino root options (with or without `transport`) |
| `libs/infrastructure/src/logger/build-pino-options.spec.ts` | Unit tests: development → pretty transport + options; production/test → no transport; level preserved |
| `libs/infrastructure/src/logger/app-logger.service.spec.ts` | Optional thin unit tests: constructs with mocked `AppConfigService` + `RequestContextService`; asserts `LOGGER_LEVEL` filtering and context merge still work under `pretty: false` (JSON path). Prefer destination capture / spy rather than asserting pretty worker output in CI |

## Files to modify

| Path | Change |
| ---- | ------ |
| `libs/infrastructure/src/config/app-config.service.ts` | `ConfigShape['logger']` → `{ level: string; pretty: boolean }` |
| `libs/infrastructure/src/config/infrastructure-config.module.ts` | Map `logger: { level: e.LOGGER_LEVEL, pretty: e.NODE_ENV === 'development' }` |
| `libs/infrastructure/src/logger/app-logger.service.ts` | Use `buildPinoRootOptions(config.logger().level, config.logger().pretty)` when constructing pino |
| `package.json` | Move `pino-pretty` from `dependencies` to `devDependencies` (keep version `^13.1.3` unless install requires a lock-compatible bump within range) |
| `package-lock.json` | Refresh only as required by the dependency classification change |
| `.env.example` | Comment above `NODE_ENV` / `LOGGER_LEVEL` documenting: pretty logs when `NODE_ENV=development`; JSON when `test` or `production` |
| `README.md` | §5.2 Logger Module — document JSON vs pino-pretty development behavior and the `NODE_ENV` rule |
| `docs/agent-plans/INDEX.md` | Add TASK-006 plan row (`proposed`) — planning hygiene only |

## Files to delete

None.

## Domain changes

None. Domain must not import pino or Nest logger.

## Application changes

None. Application must not import pino or Nest logger.

## Contract and DI changes

- No new contracts tokens or ports.
- No `LoggerModule` provider list change beyond existing `AppLogger` behavior.
- Typed config shape change is internal to infrastructure config (`logger.pretty`); no public HTTP contract.

## Infrastructure changes

1. **`buildPinoRootOptions`** — single source of truth for pino construction options.
2. **`AppLogger`** — call helper; preserve all existing methods and `buildContext` / `normalizeError` behavior.
3. **`InfrastructureConfigModule` validate mapping** — set `pretty` from `NODE_ENV === 'development'`.
4. **`AppConfigService` / `ConfigShape`** — expose `pretty` on `logger()`.
5. **Dependency placement** — `pino-pretty` → `devDependencies`.

## Interface and entrypoint changes

- **API / Worker / Cron:** no `main.ts` edits; inherit via `AppLogger`.
- **Migrations:** unchanged (`console.*`).
- **Docker Compose / Dockerfile:** no file edits required; behavior follows `NODE_ENV` from `.env` / image `ENV`.
- **OpenAPI:** none (AC-07).

## Database and migration changes

None.

## Security and authorization changes

- No new secret logging.
- Production path must not configure pretty transport (mitigates accidental pretty + missing module).
- Document that production deploys must keep `NODE_ENV=production`.

## Observability changes

- Development stdout: human-readable pino-pretty output (level, time, message, context fields as rendered by pretty).
- Production / test: unchanged structured JSON one-object-per-line with existing request-context enrichment.
- No new metrics, tracing, or log-shipping changes.

## Implementation phases

### Phase 1 — Config typing and mapping

- **Paths:** `libs/infrastructure/src/config/app-config.service.ts`, `libs/infrastructure/src/config/infrastructure-config.module.ts`
- **Symbols:** `ConfigShape.logger`, `AppConfigService.logger()`, `InfrastructureConfigModule` `validate` return `logger` object
- **Work:** Add `pretty: boolean`; map `pretty: e.NODE_ENV === 'development'`; keep `level: e.LOGGER_LEVEL`
- **AC:** AC-02 (config basis), FR-03, FR-05
- **Verify:** Typecheck via subsequent build; spot-check mapping in code review; existing `env.schema.spec.ts` remains green (no schema field added)

### Phase 2 — Pino options helper + `AppLogger` wiring

- **Paths:** `libs/infrastructure/src/logger/build-pino-options.ts` (create), `libs/infrastructure/src/logger/app-logger.service.ts`
- **Symbols:** `buildPinoRootOptions`; `AppLogger` constructor `pino(buildPinoRootOptions(...))`
- **Work:** Implement conditional `transport` with frozen pretty options; non-pretty path omits `transport` entirely
- **AC:** AC-01, AC-02, AC-03, AC-04, FR-01, FR-02, FR-04, FR-05, NFR-01, NFR-02
- **Verify:** Unit tests in Phase 3; static inspection that production branch has no `pino-pretty` target

### Phase 3 — Unit tests

- **Paths:** `libs/infrastructure/src/logger/build-pino-options.spec.ts` (create); optionally `app-logger.service.spec.ts`
- **Symbols:** tests for `buildPinoRootOptions('info', true|false)` and level passthrough
- **Work:** Assert `pretty: true` includes `transport.target === 'pino-pretty'` and options; `pretty: false` has no `transport`; level string preserved
- **AC:** AC-02, AC-03 (level), supports AC-01 statically
- **Verify:** `npx jest --config jest.unit.config.ts libs/infrastructure/src/logger/build-pino-options.spec.ts` (and optional AppLogger spec)

### Phase 4 — Dependency classification

- **Paths:** `package.json`, `package-lock.json`
- **Symbols:** `pino-pretty` entry under `devDependencies`
- **Work:** Move package; refresh lockfile intentionally for this change only
- **AC:** NFR-03; supports AC-02 production safety
- **Verify:** Inspect `package.json`; confirm production Dockerfile path still uses `--omit=dev` (no Dockerfile edit); `npm ci` locally still installs pretty for development

### Phase 5 — Documentation

- **Paths:** `.env.example`, `README.md` (§5.2 Logger Module)
- **Symbols / content:** Document that `NODE_ENV=development` enables pino-pretty; `test` / `production` keep JSON; `LOGGER_LEVEL` still applies; no new env var
- **AC:** AC-05, FR-06
- **Verify:** Docs review against frozen detection rule

### Phase 6 — Full entrypoint verification + OpenAPI non-change

- **Paths:** no production logic beyond prior phases; inspect git diff for OpenAPI/HTTP absence
- **Work:** Run builds/lint; optional local bootstrap under development and production-like `NODE_ENV` to sample stdout; confirm Worker/Cron share behavior via code path (no per-app setup)
- **AC:** AC-01, AC-02, AC-06, AC-07
- **Verify:** See Targeted / Full verification below

## Dependency and compatibility impact

- **Runtime:** `pino` remains a production dependency.
- **Dev-only:** `pino-pretty` moves to `devDependencies`.
- **Lockfile:** intentional update allowed for this classification change only.
- **Backward compatible** for production JSON consumers.
- **Nest `LoggerService` signatures** unchanged.
- **`LOGGER_LEVEL` semantics** unchanged.
- **Breaking risk:** none for intentional production (`NODE_ENV=production`). Local/Compose with `NODE_ENV=development` gain pretty output (desired).

## Targeted verification

1. `npx jest --config jest.unit.config.ts libs/infrastructure/src/logger/build-pino-options.spec.ts` — expect pass (pretty vs JSON options).
2. Optional: `npx jest --config jest.unit.config.ts libs/infrastructure/src/logger/app-logger.service.spec.ts` if added.
3. `npm run build:api` — expect pass.
4. `npm run build:worker` — expect pass.
5. `npm run build:cron` — expect pass.
6. `npm run lint` — expect pass.
7. Static diff inspection: no changes under `apps/api/src/openapi/`, auth/session controllers/DTOs, or generated OpenAPI expectations (AC-07).
8. Optional runtime: with valid `.env` and Redis/Postgres available, `NODE_ENV=development npm run start:api` (or Compose) — confirm a normal info log is human-readable, not a single-line JSON object; repeat with `NODE_ENV=production` (or documented equivalent) — confirm JSON line. Missing infra is **not** a code defect.

## Full verification

1. `npm run build` — expect pass (shared infrastructure touched).
2. `npm run lint` — expect pass.
3. `npm run test:unit` — expect pass (includes new logger specs; no OpenAPI drift expectation change).
4. Do **not** require `npm run test:int` unless implementer chooses; no DB/Redis schema change.
5. OpenAPI drift test need not be re-run for behavior, but if run, must remain green with **no** TASK-006 OpenAPI file edits.

## Acceptance criteria mapping

| AC | Implementation phase | Verification |
| -- | -------------------- | ------------ |
| **AC-01** | Phase 2 (+ optional runtime Phase 6) | Unit: transport present when `pretty: true`; runtime sample under `NODE_ENV=development` |
| **AC-02** | Phases 1–2, 4 | Unit: no transport when `pretty: false`; config maps only development → pretty; production path does not load pretty |
| **AC-03** | Phases 1–3 | Unit: `level` passed through; optional AppLogger level filter check |
| **AC-04** | Phase 2 (no change to `buildContext`) | Code inspection + optional AppLogger spec with mocked `RequestContextService` |
| **AC-05** | Phase 5 | Inspect `.env.example` + README §5.2 |
| **AC-06** | Phase 6 | `npm run build:api`, `build:worker`, `build:cron`, `npm run lint` |
| **AC-07** | Phase 6 | `git diff` / status shows no OpenAPI/HTTP contract file changes for this task |

## Rollout strategy

- Ship as a backward-compatible infrastructure change.
- Production defaults remain JSON (`NODE_ENV=production`).
- Local / Compose developers with `NODE_ENV=development` automatically get pretty logs after upgrade (and after ensuring `pino-pretty` is installed via full `npm ci` / development image).
- No migrations or data backfill.

## Rollback strategy

- Revert the logger/config/docs/dependency commit(s).
- No database rollback.
- Production JSON behavior restored by reverting to prior `AppLogger` construction.

## Risks

| Risk | Mitigation |
| ---- | ---------- |
| Pretty enabled in production via wrong `NODE_ENV` | Detection is explicit `=== 'development'`; docs stress production `NODE_ENV`; no transport on other values |
| `pino-pretty` missing when `pretty: true` (e.g. production image + mis-set `NODE_ENV`) | Fail-fast on logger init; moving to `devDependencies` makes misconfig obvious; keep production `NODE_ENV=production` |
| pino transport worker-thread quirks under some test runners | Unit-test the pure options helper; Jest suite typically uses `NODE_ENV=test` → JSON path |
| Lockfile noise | Restrict dependency change to `pino-pretty` classification only |
| Concurrent unrelated working-tree changes | Implementer must not mix other TASK diffs into this task’s commit |

## Open questions requiring human decision

None blocking implementation — remaining former open questions are **planner-frozen** above (OQ-3…OQ-6).

If a human rejects a frozen default before approval, revise this plan (do not silently change during implementation):

1. Keep `pino-pretty` in runtime `dependencies` instead of moving it.
2. Add `LOGGER_PRETTY` opt-out/override.
3. Expand scope to Migrations / `AppLogger`.
4. Different pino-pretty option set (e.g. `singleLine: true`).
