---
task_id: TASK-006
task_type: infrastructure
status: approved
owner: human-approval-required
---

# TASK-006 — Configure pino-pretty for development logs

## Original request

Пяте - хочу щоб ти налаштував pino pretty для логів в девелопменті створив завдання точніше

## Human decisions (2026-07-19)

1. **Pretty detection rule:** enable pino-pretty **only when `NODE_ENV === 'development'`**. Production and test keep structured JSON (no pretty transport).

## Problem or opportunity

The starter already depends on `pino` and `pino-pretty`, but `AppLogger` configures pino with only a log level. All Nest-backed entrypoints therefore emit machine-oriented JSON lines even when `NODE_ENV=development` (including local Docker Compose). Developers want human-readable, colorized logs in development while keeping structured JSON in production for log aggregation.

This is **not** a backlog bugfix: JSON logging works as currently designed; the gap is missing development pretty-print wiring.

## Goal

In development (`NODE_ENV=development`), Nest application logs from `AppLogger` are pretty-printed via `pino-pretty`. In production and test, logs remain structured JSON on stdout with no pretty transport. OpenAPI and HTTP contracts are unchanged.

## Users and actors

- Local developers running API / Worker / Cron via npm scripts or `docker compose`.
- Operators / log aggregators consuming production JSON logs.
- CI / automated tests that may parse or assert on log output (`NODE_ENV=test` stays JSON per human decision).

## Current system context

Inspected behavior (current branch):

- **Logger implementation:** `libs/infrastructure/src/logger/app-logger.service.ts` creates `pino({ level: config.logger().level })` with no `transport`, no `pino-pretty`, and no env-based formatting branch.
- **Module wiring:** `LoggerModule` provides/exports `AppLogger`, `RequestContextService`, and `RequestContextMiddleware`; imports `InfrastructureConfigModule`.
- **Config:** `env.schema.ts` defines `NODE_ENV` as `development | test | production` (default `development`) and `LOGGER_LEVEL` (default `info`). `InfrastructureConfigModule` maps `logger: { level: e.LOGGER_LEVEL }` only — no pretty flag. `AppConfigService.logger()` returns `{ level: string }`.
- **Dependencies:** `package.json` lists both `pino` (`^10.3.1`) and `pino-pretty` (`^13.1.3`) under **runtime `dependencies`**. `pino-pretty` is not referenced in application source.
- **Entrypoints using `AppLogger`:**
  - API — `apps/api/src/main.ts` (`application.useLogger(AppLogger)`).
  - Worker — `apps/worker/src/main.ts`.
  - Cron — `apps/cron/src/main.ts`.
- **Migrations:** `apps/migrations` uses `console.info` / `console.error` / `console.warn` only; it does **not** bootstrap Nest `LoggerModule` / `AppLogger`.
- **Local Docker:** `docker-compose.yml` builds the `development` image target, loads `.env` (`NODE_ENV=development`, `LOGGER_LEVEL=debug` in `.env.example`). Production image stages use `npm ci --omit=dev` and `NODE_ENV=production`.
- **Docs:** README §5.2 documents structured JSON logs; no mention of pino-pretty.
- **Tests:** No dedicated `*logger*.spec.ts` found.

## Functional requirements

- **FR-01:** When `NODE_ENV === 'development'`, `AppLogger` must emit human-readable logs via `pino-pretty` (recommended: pino `transport` targeting `pino-pretty`).
- **FR-02:** When `NODE_ENV` is `production` or `test` (or any non-`development` value), `AppLogger` must continue to emit structured JSON logs to stdout with no pretty transport and no change to existing field enrichment (`requestId` / correlation fields via `RequestContextService`).
- **FR-03:** Pretty vs JSON behavior must be driven by configuration available to infrastructure (`NODE_ENV` via config mapping), not by reading raw `process.env` inside ad-hoc call sites outside the logger/config boundary.
- **FR-04:** The same pretty/JSON behavior must apply to all Nest entrypoints that use `AppLogger` (API, Worker, Cron) without duplicating per-app pino setup in each `main.ts`.
- **FR-05:** `LOGGER_LEVEL` continues to control pino level in both pretty and JSON modes.
- **FR-06:** Document the development logging behavior (and any new env var) in `.env.example` and the logger section of `README.md` (or equivalent canonical ops docs touched by the implementation plan).
- **FR-07:** OpenAPI is **unaffected** — no HTTP endpoint, DTO, schema, or generated OpenAPI document changes are part of this task.

## Non-functional requirements

- **NFR-01:** Production log lines must remain valid JSON objects suitable for aggregation (one JSON object per log line on stdout, consistent with current pino defaults).
- **NFR-02:** Enabling pretty printing must not require a second logging library or replace Nest’s `LoggerService` integration via `AppLogger`.
- **NFR-03:** Dependency placement must be safe for the production Docker image (`npm ci --omit=dev`): if `pino-pretty` is only needed in development, prefer `devDependencies` + transport that is not loaded in production (final placement is an open question given it is currently a runtime dependency).
- **NFR-04:** Local Docker Compose development runs (`NODE_ENV=development`) must receive pretty logs when the approved detection rule includes that environment, without requiring a separate undocumented compose override unless humans choose an explicit flag.
- **NFR-05:** Changes stay inside infrastructure logger/config (and docs); domain and application layers must not gain pino or Nest logger imports.

## Public API and interface impact

No public HTTP API, CLI contract, or SDK surface changes.

### HTTP API contract (if applicable)

Not applicable.

- Methods and paths: none
- Request body, path/query parameters and validation/requiredness: none
- Success status codes, typed response bodies and examples: none
- Error status codes and shared error envelope: none
- Authentication/authorization: none
- Significant headers and cookies: none
- OpenAPI schemas/decorators to add or update: **none — OpenAPI is unaffected**
- Acceptance criterion that verifies generated OpenAPI against runtime behavior: **N/A** (no HTTP contract change)

## Data model and migration impact

None. No database schema or migration changes.

## Events, queues and background processing

None. Worker/Cron only change how their Nest/`AppLogger` stdout appears; queue payloads and processors are unchanged.

## Security and authorization

- Pretty printing must not log secrets beyond what current `AppLogger` already emits.
- Production must not silently fall back to pretty formatting if `pino-pretty` is missing when a transport is misconfigured; production path must not require `pino-pretty`.

## Entrypoints and deployment impact

| Entrypoint | Impact                                                                                                       |
| ---------- | ------------------------------------------------------------------------------------------------------------ |
| API        | Uses shared `AppLogger` — pretty in approved dev mode, JSON in production                                    |
| Worker     | Same                                                                                                         |
| Cron       | Same                                                                                                         |
| Migrations | Currently `console.*` only — **default assumption: out of scope** unless humans expand scope (open question) |

Docker Compose local stack uses the development image and `.env` with `NODE_ENV=development`; production runtime image must keep JSON logs.

## Observability and operations

- Development: human-readable stdout (level, time, message, context fields as rendered by pino-pretty).
- Production: unchanged structured JSON with existing context enrichment.
- No new metrics, tracing backends, or log-shipping pipelines.

## Compatibility requirements

- Backward compatible for production consumers of JSON logs.
- Do not break Nest `LoggerService` method signatures on `AppLogger`.
- Do not change default `LOGGER_LEVEL` semantics.
- Moving `pino-pretty` between `dependencies` and `devDependencies` is allowed only if lockfile/Dockerfile behavior remains correct for both development and production stages.

## Dependencies

- Existing: `pino`, `pino-pretty` (already in `package.json`; currently unused in code).
- No new third-party logging frameworks.
- Possible lockfile update only if dependency classification (`dependencies` vs `devDependencies`) changes intentionally.

## Assumptions

- **A-01:** This is an infrastructure/technical improvement, not a defect from `docs/agent-backlog/`.
- **A-02:** The single configuration point is `AppLogger` (and supporting config mapping), so API/Worker/Cron inherit behavior automatically.
- **A-03:** Migrations remain on `console.*` unless humans explicitly expand scope (see open questions).
- **A-04:** “Development” for pretty logs means **`NODE_ENV === 'development'` only** (human decision 2026-07-19); `test` and `production` stay JSON.
- **A-05:** Recommended implementation shape (not approved until planning): pino `transport: { target: 'pino-pretty', options: ... }` when pretty is enabled; plain `pino({ level })` otherwise.
- **A-06:** No HTTP/OpenAPI work is required or implied.
- **A-07:** Parent agent updates `docs/agent-tasks/INDEX.md` centrally; this specification does not edit the index.

## Out of scope

- Changing log field schemas, redaction policies, or request-context middleware behavior beyond formatting.
- File-based log sinks, log rotation, or admin “backend logs” HTTP APIs (legacy migration concerns).
- Replacing pino with another logger.
- Pretty-printing non-`AppLogger` output (`console.*` in migrations/startup failure paths) unless humans expand scope.
- Any HTTP endpoint, DTO, or OpenAPI changes.
- Unrelated backlog issues or other TASK IDs.

## Acceptance criteria

- **AC-01:** With `NODE_ENV=development`, starting API (and likewise Worker/Cron) shows human-readable `AppLogger` / Nest logger output (not raw single-line JSON) for a normal info-level message.
- **AC-02:** With `NODE_ENV=production` or `NODE_ENV=test`, the same info-level message is emitted as structured JSON on stdout without loading a pretty transport.
- **AC-03:** `LOGGER_LEVEL` still filters messages in both modes (e.g. `debug` visible when level is `debug`, hidden when level is `info`).
- **AC-04:** Request context fields that `AppLogger` already merges remain present in log output in both modes (field rendering may differ visually under pretty).
- **AC-05:** `.env.example` and README logger documentation describe how pretty mode is enabled/disabled.
- **AC-06:** `npm run build:api` (and Worker/Cron builds if logger packaging is shared) and `npm run lint` succeed after implementation.
- **AC-07:** No OpenAPI schema, decorator, or generated document changes appear in the task diff.

## Verification strategy

- Static: inspect `AppLogger` / config mapping for conditional pretty transport; confirm production path has no pretty target; confirm no OpenAPI/HTTP file changes.
- Runtime (local): boot API (and spot-check Worker or Cron) under development settings and capture stdout sample; repeat under production-like `NODE_ENV=production` (or documented equivalent) and confirm JSON.
- Commands (implementation/verification phase): at least `npm run build:api`, `npm run build:worker`, `npm run build:cron`, `npm run lint`; optional targeted unit test if planner adds one for config branching.
- Docker (optional but recommended): `docker compose` API logs under default `.env` show pretty output when that is the approved rule.
- Do not treat documentation alone as proof of runtime behavior.

## Rollout and rollback

- **Rollout:** Ship as a backward-compatible infrastructure change; production defaults remain JSON.
- **Rollback:** Revert the logger/config/docs commit; no migrations or data backfill.
- **Risk:** Mis-detecting environment could enable pretty in production (hurts aggregation) or leave JSON in development (no functional break). Mitigate with explicit tests/checks for both branches.

## Open questions requiring human decision

1. **Pretty detection rule:** **Decided — only when `NODE_ENV === 'development'`.**
2. **`NODE_ENV=test` behavior:** **Decided — JSON** (implied by detection rule).
3. **Dependency classification:** Keep `pino-pretty` in `dependencies` (current) or move to `devDependencies` so production `npm ci --omit=dev` images exclude it? Recommendation: move to `devDependencies` if pretty is never used in production.
4. **Migrations scope:** Leave migrations on `console.*`, or bring Migrations onto `AppLogger` / pretty as part of this task?
5. **Pretty options:** Accept pino-pretty defaults, or require specific options (colorize, translateTime, singleLine, ignore `pid`/`hostname`)?
6. **Explicit opt-out in development:** Is a `LOGGER_PRETTY=false` (or similar) override required for developers who prefer JSON locally / in Compose?
