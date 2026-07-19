---
task_id: TASK-002
specification: docs/agent-tasks/TASK-002-api-uri-versioning.md
status: approved
owner: human-approval-required
---

# TASK-002 — Implementation plan

## Approved specification

- Spec: `docs/agent-tasks/TASK-002-api-uri-versioning.md`
- Spec status: `approved` (verified before planning)
- Mechanism (Q4): `setGlobalPrefix('v1')` with health-only exclusions; **do not** use `enableVersioning`
- Health (Q1): `/health`, `/health/live`, `/health/ready` stay version-neutral
- Docs (Q2): Swagger UI / OpenAPI JSON at `/v1/docs` and `/v1/docs-json`
- Cutover (Q3): hard cutover — unversioned `/auth/*` must 404
- Cookie (Q6): keep `Path=/` (`AUTH_SESSION_COOKIE_PATH` default unchanged)

## Current implementation

Inspected branch state (API HTTP surface only; no URI versioning applied at runtime):

| Area                | Current behavior                                                                                                                                                                                                                                           |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bootstrap           | `apps/api/src/main.ts` — no `setGlobalPrefix`, no `enableVersioning`                                                                                                                                                                                       |
| Auth                | `apps/api/src/controllers/auth.controller.ts` — `@Controller('auth')`; routes `/auth/*`                                                                                                                                                                    |
| Health              | `libs/infrastructure/src/health/health.controller.ts` — `@Controller('health')`; routes `/health`, `/health/live`, `/health/ready`                                                                                                                         |
| OpenAPI helpers     | `apps/api/src/openapi/create-openapi-document.ts` — `API_DOCS_PATH = '/v1/docs'` already, but `API_DOCS_JSON_PATH = 'docs-json'` (inconsistent); `SwaggerModule.createDocument` does **not** set `ignoreGlobalPrefix` (correct default once prefix exists) |
| Drift / module test | `apps/api/src/openapi/openapi-contract.spec.ts` — expects unversioned `/auth/*` and `/health/*`; smoke hits `/docs` and `/docs-json`; test app factory does **not** call `setGlobalPrefix`                                                                 |
| Auth OpenAPI copy   | `AuthController.register` `@ApiOperation` still says `Call POST /auth/login`                                                                                                                                                                               |
| Cookie              | `SessionCookieService` uses `path: auth.sessionCookiePath`; env default `AUTH_SESSION_COOKIE_PATH=/`                                                                                                                                                       |
| Prod probe          | `docker-compose.prod.yml` — `GET http://127.0.0.1:3000/health/live` (already correct for Q1)                                                                                                                                                               |
| Docs                | `README.md`, `EXAMPLES.md` advertise unversioned `/auth/*`, `/docs`, `/docs-json`; health already unversioned                                                                                                                                              |

**Note:** Do not overwrite any historical/unrelated `TASK-002-migration-parity-matrix` plan artifact. This plan file is deliberately `TASK-002-api-uri-versioning.md`.

**Note:** Unrelated local `main.ts` styling around Swagger `customCss` (if present in a working tree) is out of scope for this task and must not be mixed into the versioning change set unless already committed independently.

## Architecture decision

Use Nest **`INestApplication.setGlobalPrefix('v1', { exclude: [...] })`** once in the API composition root (`apps/api/src/main.ts`), applied **before** OpenAPI document creation and listen.

- Controllers keep short paths (`auth`, `health`); they must **not** hard-code `v1/` in `@Controller(...)`.
- Health exclusion list is the **single** declaration of version-neutral routes (NFR-02 / NFR-05). Prefer explicit string excludes matching Nest docs and the approved spec example:

  ```ts
  application.setGlobalPrefix('v1', {
    exclude: ['health', 'health/live', 'health/ready'],
  });
  ```

  If string excludes prove insufficient for nested health routes during implementation verification, switch to equivalent `RouteInfo` entries with `RequestMethod.GET` without expanding scope.

- Swagger remains mounted **outside** Nest controller routing via `SwaggerModule.setup('v1/docs', ...)`, so docs paths move explicitly to `/v1/docs` and `/v1/docs-json` (FR-05). Normalize constants without a leading slash to match Nest Swagger conventions.
- OpenAPI generation must **include** the global prefix for auth routes and **omit** it for excluded health routes (default `createDocument` behavior; do **not** pass `ignoreGlobalPrefix: true`).
- Drift/module tests must mirror production bootstrap (`setGlobalPrefix` + same exclude list + same docs setup path) so AC-01–AC-04 are enforced by `openapi-contract.spec.ts`.

## Scope

- API bootstrap global prefix + health exclude
- Docs mount path constants and startup log URLs
- Auth controller OpenAPI operation text that hard-codes `/auth/...`
- OpenAPI drift/module test expectations and runtime smoke paths
- Canonical docs: `README.md`, `EXAMPLES.md` (auth / docs URLs; health stays unversioned)
- Confirm `docker-compose.prod.yml` health probe remains `/health/live` (no change expected)

## Out of scope

- `enableVersioning`, `/v2`, header/media-type versioning
- Dual-mount / compatibility shim for unversioned `/auth/*`
- Domain/application auth semantics, DTOs, cookie name/path defaults, rate-limit Redis key renames
- Worker / Cron / Migrations entrypoints
- Legacy OLD_BACKEND `/v1/*` parity controllers (separate migration tasks; see Q5)
- Unrelated Swagger UI theming / CSS in `main.ts`
- Frontend clients outside this repository

## Files to create

- None (plan-only artifacts under `docs/agent-plans/` are planner deliverables, not implementation)

## Files to modify

| Path                                              | Change                                                                                                                                                                          |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/src/main.ts`                            | Call `setGlobalPrefix('v1', { exclude: [...] })` before OpenAPI setup; keep docs setup on versioned path; fix log URL composition if constants change                           |
| `apps/api/src/openapi/create-openapi-document.ts` | Normalize `API_DOCS_PATH` / `API_DOCS_JSON_PATH` to `v1/docs` and `v1/docs-json`; optional description mention of URI `/v1`; leave `info.version` as `1.0.0`                    |
| `apps/api/src/openapi/openapi-contract.spec.ts`   | Mirror prefix + exclude in test app; expect `/v1/auth/...` and unversioned `/health...`; smoke `/v1/docs` + `/v1/docs-json`; assert unversioned `/auth/...` 404 and `/docs` 404 |
| `apps/api/src/controllers/auth.controller.ts`     | Update hard-coded path strings in `@ApiOperation` (at least register → `POST /v1/auth/login`)                                                                                   |
| `README.md`                                       | Update advertised auth/docs URLs to `/v1/...`; keep health unversioned                                                                                                          |
| `EXAMPLES.md`                                     | Update curl/tables for auth and docs; keep health unversioned                                                                                                                   |

## Files to delete

- None

## Domain changes

- None

## Application changes

- None

## Contract and DI changes

- None (no tokens, ports, or composition-module provider changes)

## Infrastructure changes

- None to Health module internals (`HealthController` stays `@Controller('health')`).
- Portability: exclusion lives only in API bootstrap so other HealthModule consumers are not forced under `/v1` (NFR-05).

## Interface and entrypoint changes

- **API (`apps/api/src/main.ts`):** sole place that applies `setGlobalPrefix`.
- **OpenAPI helpers + drift test:** align documented/served paths with runtime.
- **Auth controller:** documentation strings only (no handler/DTO changes).
- **Worker / Cron / Migrations:** untouched.

### OpenAPI schema / decorator checklist (HTTP contract)

| Item                             | Action                                                                              |
| -------------------------------- | ----------------------------------------------------------------------------------- |
| Global prefix in generated paths | Ensure prefix applied before `createOpenApiDocument`; no `ignoreGlobalPrefix: true` |
| Auth path keys                   | Expect `/v1/auth/register\|login\|logout\|refresh\|me`                              |
| Health path keys                 | Expect `/health`, `/health/live`, `/health/ready` (no `/v1`)                        |
| DTO / response schemas           | No schema shape changes; keep existing `@Api*Response` / `extraModels`              |
| Auth operation descriptions      | Replace literal `/auth/...` with `/v1/auth/...` where present                       |
| Docs mount                       | `SwaggerModule.setup(API_DOCS_PATH, ...)` with `API_DOCS_PATH = 'v1/docs'`          |
| Drift gate                       | `openapi-contract.spec.ts` updated; `npm run test:module` must pass                 |

## Database and migration changes

- None

## Security and authorization changes

- Authn/authz rules unchanged; only URL paths change.
- Session cookie `Path=/` retained (Q6); do not change `AUTH_SESSION_COOKIE_PATH` default.
- CORS / CSRF / rate-limit key prefixes unchanged.

## Observability changes

- Startup log fields `swaggerUi` / `openApiJson` must print `/v1/docs` and `/v1/docs-json` (avoid double-slash when constants lose leading `/`).
- Prod liveness probe URL unchanged (`/health/live`).

## Implementation phases

### Phase 1 — Bootstrap global prefix and health exclusions

- **Paths:** `apps/api/src/main.ts`
- **Symbols / responsibilities:** `bootstrap()` — after Nest app creation and global pipes/logger wiring, call `application.setGlobalPrefix('v1', { exclude: ['health', 'health/live', 'health/ready'] })` **before** `createOpenApiDocument` / `SwaggerModule.setup` / `listen`.
- **Maps to:** FR-01, FR-02, FR-04, FR-07, NFR-02, NFR-05, AC-03, AC-04, AC-07
- **Verify:** Static inspection of call order and exclude list; optional local curl against running API (if infra up): `GET /health/live` → 200, `POST /auth/login` → 404, `GET /v1/auth/me` → 401 without creds.

### Phase 2 — Docs mount constants and OpenAPI document alignment

- **Paths:** `apps/api/src/openapi/create-openapi-document.ts`, `apps/api/src/main.ts` (log URL formatting only as needed)
- **Symbols / responsibilities:** `API_DOCS_PATH`, `API_DOCS_JSON_PATH`, `createOpenApiDocument`; ensure setup uses `v1/docs` so UI is `/v1/docs` and JSON is `/v1/docs-json`; do not set `ignoreGlobalPrefix: true`; optionally clarify URI version in `DocumentBuilder` description without changing `setVersion('1.0.0')`.
- **Maps to:** FR-05, NFR-03, AC-01
- **Verify:** With docs enabled, `GET /v1/docs` and `GET /v1/docs-json` succeed; `GET /docs` and `GET /docs-json` return 404; OpenAPI `paths` contain `/v1/auth/...` and unversioned `/health...`.

### Phase 3 — Auth OpenAPI operation text

- **Paths:** `apps/api/src/controllers/auth.controller.ts`
- **Symbols / responsibilities:** `AuthController` `@ApiOperation` (and any other hard-coded absolute path strings in this controller) — update e.g. register description from `POST /auth/login` to `POST /v1/auth/login`. Leave cookie `Path=/` examples as-is.
- **Maps to:** FR-03, AC-01
- **Verify:** Grep controller for unversioned `` `/auth/ `` path citations; none remain as recommended client paths.

### Phase 4 — Drift / module test parity with production routing

- **Paths:** `apps/api/src/openapi/openapi-contract.spec.ts`
- **Symbols / responsibilities:** `createTestApp` — apply the same `setGlobalPrefix('v1', { exclude: [...] })` before `init`; update `expectedRoutes` to `/v1/auth/...` + `/health...`; update security/schema assertions that key off `/auth/me` and `/auth/register` / `/auth/login`; smoke `GET /v1/docs` and `GET /v1/docs-json`; add assertions that `GET /auth/register` (or `/auth/login`) is 404 and `GET /docs` is 404 when docs are set up under `v1/docs`.
- **Maps to:** FR-02, FR-04, FR-05, FR-08, AC-01, AC-02, AC-03, AC-04
- **Verify:** `npm run test:module` (covers `openapi-contract.spec.ts`).

### Phase 5 — Canonical documentation and probe confirmation

- **Paths:** `README.md`, `EXAMPLES.md`, `docker-compose.prod.yml` (read-confirm; modify only if wrongly versioned)
- **Symbols / responsibilities:** Replace recommended client URLs for auth and docs with `/v1/...`; keep health examples at `/health...`; confirm compose healthcheck still uses `/health/live`.
- **Maps to:** FR-06, FR-07, AC-04, AC-05
- **Verify:** Grep `README.md` / `EXAMPLES.md` for stale `localhost:3000/auth` and `localhost:3000/docs` as the recommended contract; inspect compose healthcheck string.

### Phase 6 — Build and lint gate

- **Paths:** changed TypeScript/docs only (no new deps)
- **Symbols / responsibilities:** Ensure implementation compiles and lint-clean.
- **Maps to:** AC-06, AC-07
- **Verify:** `npm run build:api`, `npm run lint`.

## Dependency and compatibility impact

- **Dependencies:** no new npm packages; uses existing Nest `setGlobalPrefix` and `@nestjs/swagger`.
- **Compatibility:** **breaking** for all clients calling unversioned `/auth/*` and `/docs` / `/docs-json`. Health probes unchanged.
- **Future controllers:** inherit `/v1` automatically; health remains excluded only via bootstrap list.
- **Q5 / legacy parity:** later tasks that hard-code `@Controller('v1/...')` risk `/v1/v1/...` once this prefix exists — call out in that task’s plan; do not implement parity here.

## Targeted verification

1. Static: `main.ts` prefix + exclude; OpenAPI constants; auth operation strings; README/EXAMPLES; compose probe.
2. `npm run test:module` (focus `apps/api/src/openapi/openapi-contract.spec.ts`).
3. Optional runtime (infra available): `npm run start:api` or compose — curl `/v1/auth/me` (401), `/auth/login` (404), `/health/live` (200), `/v1/docs-json` (200 when docs enabled).

## Full verification

```bash
npm run build:api
npm run lint
npm run test:module
```

Optional broader gate (not required by AC unless human asks): `npm run test:unit`.

Record each command as: command, result, conclusion.

## Acceptance criteria mapping

| AC    | Implementation phase(s)       | Verification                                                                                              |
| ----- | ----------------------------- | --------------------------------------------------------------------------------------------------------- |
| AC-01 | Phase 1–4                     | OpenAPI paths/methods/schemas/security for `/v1/auth/...`; `test:module` + optional `/v1/docs-json` fetch |
| AC-02 | Phase 4                       | `npm run test:module` passes with updated expected paths                                                  |
| AC-03 | Phase 1, 4                    | Drift smoke + optional runtime: `/v1/...` works, unversioned `/auth/...` → 404                            |
| AC-04 | Phase 1, 2, 4, 5              | Runtime/OpenAPI/tests/docs/compose agree on unversioned `/health...`; `/v1/health` not documented         |
| AC-05 | Phase 5                       | Inspect `README.md` / `EXAMPLES.md` for approved paths only                                               |
| AC-06 | Phase 6                       | `npm run build:api`, `npm run lint`                                                                       |
| AC-07 | All phases (scope discipline) | Diff review: no Worker/Cron/Migrations/domain/application auth logic changes                              |

## Rollout strategy

- Single breaking cutover in one change set (Q3): ship prefix + docs + drift tests + README/EXAMPLES together.
- Operators keep existing `/health/live` probes (no compose URL change expected).
- Consumers update base URL to `/v1` for auth and docs.

## Rollback strategy

- Revert bootstrap `setGlobalPrefix`, docs path constants, drift-test expectations, auth operation strings, and README/EXAMPLES path updates.
- No migrations or data backfill.

## Risks

| Risk                                                                                          | Mitigation                                                                                           |
| --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Health exclude strings do not match Nest route matching for nested paths                      | Verify with smoke on `/health/live` and `/health/ready`; fall back to `RouteInfo` excludes if needed |
| OpenAPI omits `/v1` because prefix applied after `createDocument` or `ignoreGlobalPrefix` set | Apply prefix before document creation; never set `ignoreGlobalPrefix: true`                          |
| Drift test app diverges from production bootstrap                                             | Shared exclude list values mirrored in `createTestApp`                                               |
| Double-prefix later from legacy `@Controller('v1/...')`                                       | Document Q5 for migration/parity planners; out of scope here                                         |
| Incomplete docs grep leaves stale `/auth` examples                                            | Phase 5 explicit grep of README/EXAMPLES curl/tables                                                 |

## Open questions requiring human decision

None blocking implementation — Q1–Q4 and Q6 are decided in the approved specification.

**Deferred (Q5, non-blocking):** If a future legacy-parity task adds controllers with hard-coded `v1/...` path segments, that task’s planner must reconcile with this global prefix to avoid `/v1/v1/...`. No human decision required to implement TASK-002 itself.
