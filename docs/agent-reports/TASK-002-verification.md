# TASK-002 — Independent verification

## Verdict

approved

## Approved specification

- Path: `docs/agent-tasks/TASK-002-api-uri-versioning.md`
- Frontmatter `status: approved` — confirmed
- Human decisions honored in implementation: Q1 health version-neutral, Q2 docs under `/v1`, Q3 hard cutover, Q4 `setGlobalPrefix` (no `enableVersioning`), Q6 cookie `Path=/` unchanged

**Note:** `docs/agent-tasks/INDEX.md` still lists TASK-002 as `proposed` while the specification file is `approved`. Spec frontmatter is the approval source of truth for this verification; INDEX lag is recorded under Findings (not an AC failure).

## Approved plan

- Path: `docs/agent-plans/TASK-002-api-uri-versioning.md`
- Frontmatter `status: approved` — confirmed
- Mechanism, exclusions, docs mount, hard cutover, and file list match the implemented production changes

## Scope checked

- Task under verification: **TASK-002 only**
- Production/docs files matching the plan:
  - `apps/api/src/main.ts` — `setGlobalPrefix('v1', { exclude: ['health', 'health/live', 'health/ready'] })` before OpenAPI setup
  - `apps/api/src/openapi/create-openapi-document.ts` — `API_DOCS_PATH` / `API_DOCS_JSON_PATH` = `v1/docs` / `v1/docs-json`
  - `apps/api/src/openapi/openapi-contract.spec.ts` — prefix mirrored; expected paths; hard-cutover smokes
  - `apps/api/src/controllers/auth.controller.ts` — `@ApiOperation` cites `POST /v1/auth/login`
  - `README.md`, `EXAMPLES.md` — versioned auth/docs URLs; health unversioned
- `docker-compose.prod.yml` — probe remains `GET http://127.0.0.1:3000/health/live` (read-confirm only; no edit needed)
- Cookie default `AUTH_SESSION_COOKIE_PATH=/` untouched in env schema / `.env.example`
- No Domain / Application / Worker / Cron / Migrations production edits for this task

**Coexisting working-tree noise (not treated as TASK-002 production scope expansion):**

- Untracked parallel specs: TASK-003…TASK-006, plan INDEX, implementation report
- Modified `docs/agent-tasks/INDEX.md` / `docs/agent-plans/README.md` from parallel task-definition work
- Staged `main.ts` also includes pre-existing Swagger UI theming (`customSiteTitle` / `customCss` / `customJsStr`) mixed in the same file hunk as `setGlobalPrefix` — plan listed theming as out of scope; see Findings

## Actual changed files

| Path                                              | Role in TASK-002   | Notes                                            |
| ------------------------------------------------- | ------------------ | ------------------------------------------------ |
| `apps/api/src/main.ts`                            | In scope           | Prefix + exclude; also co-staged Swagger theming |
| `apps/api/src/openapi/create-openapi-document.ts` | In scope           | Docs path constants + description                |
| `apps/api/src/openapi/openapi-contract.spec.ts`   | In scope           | Drift + routing smokes                           |
| `apps/api/src/controllers/auth.controller.ts`     | In scope           | OpenAPI copy only                                |
| `README.md`                                       | In scope           | Auth/docs URLs                                   |
| `EXAMPLES.md`                                     | In scope           | Curl/tables/checklist                            |
| `docs/agent-tasks/INDEX.md`                       | Parallel / process | Status still `proposed` for TASK-002             |
| `docs/agent-plans/README.md`                      | Parallel           | Index link only                                  |
| Untracked task/plan/report docs                   | Parallel           | Not production runtime                           |

## Requirements matrix

| Requirement | Evidence                                                                                                                                             | Result |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| FR-01       | `main.ts` calls `setGlobalPrefix('v1', { exclude: [...] })`; no `enableVersioning`; controllers stay `@Controller('auth')` / `@Controller('health')` | passed |
| FR-02       | Live: `POST /auth/login` → 404; drift smoke same; `POST /v1/auth/register` routed                                                                    | passed |
| FR-03       | Auth controller handlers/DTOs unchanged aside from register `@ApiOperation` path text; cookie examples still `Path=/`                                | passed |
| FR-04       | Live: `/health/live` → 200, `/v1/health/live` → 404; OpenAPI paths unversioned for health                                                            | passed |
| FR-05       | Live: `/v1/docs-json` → 200, `/docs` → 404; constants `v1/docs` / `v1/docs-json`; startup log shows `/v1/docs`                                       | passed |
| FR-06       | README/EXAMPLES greps: no recommended `localhost:3000/auth` or unversioned `/docs` contract                                                          | passed |
| FR-07       | `docker-compose.prod.yml` healthcheck still `/health/live`; live probe path works                                                                    | passed |
| FR-08       | `openapi-contract.spec.ts` expects `/v1/auth/*` + unversioned `/health*`; 3/3 tests pass under unit Jest config                                      | passed |
| NFR-01      | Diff limited to API HTTP surface + docs; no Worker/Cron/Migrations/domain/application logic                                                          | passed |
| NFR-02      | Single bootstrap prefix; health exclusions only in `main.ts` (+ mirrored in drift test app)                                                          | passed |
| NFR-03      | Live OpenAPI paths match controllers; drift gate green                                                                                               | passed |
| NFR-04      | Hard cutover documented and enforced (404 on unversioned auth/docs)                                                                                  | passed |
| NFR-05      | HealthController path unchanged; exclusion only in API bootstrap                                                                                     | passed |

## Acceptance criteria matrix

| AC    | Evidence                                                                                                                                                                                                                                    | Result |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| AC-01 | Live `/v1/docs-json`: all five `/v1/auth/*` methods present; register has request body + 201/4xx/5xx; login 201 → `LoginResponseDto`; `/v1/auth/me` security `bearerAuth` + `sessionCookie`; `ErrorEnvelopeDto` present; health unversioned | passed |
| AC-02 | Designated drift invocation: `openapi-contract.spec.ts` via `jest.unit.config.ts` — 3/3 passed. Plan’s `test:module` does **not** match this file (`*.module.spec.ts` only); AC-02 allows the designated drift invocation                   | passed |
| AC-03 | Drift smoke + live compose: versioned auth routed (`/v1/auth/me` → 401); unversioned `/auth/login` → 404                                                                                                                                    | passed |
| AC-04 | Live `/health/live` → 200; `/v1/health/live` → 404; OpenAPI + compose + README health paths agree                                                                                                                                           | passed |
| AC-05 | README/EXAMPLES use `/v1/...` for auth/docs; health stays `/health...`                                                                                                                                                                      | passed |
| AC-06 | `npm run build:api` exit 0; `npm run lint` exit 0                                                                                                                                                                                           | passed |
| AC-07 | No Worker/Cron/Migrations/domain/application auth-logic changes for versioning. Residual: Swagger theming co-staged in `main.ts` (see Findings) — does not alter auth/health/docs path contract                                             | passed |

## Architecture and DI verification

- Dependency direction preserved; no new tokens/ports/providers
- Versioning applied only in API composition root (`apps/api/src/main.ts`)
- OpenAPI created after `setGlobalPrefix`; `createDocument` does not set `ignoreGlobalPrefix: true`
- Health module internals untouched; portable for non-API consumers
- No transaction/Outbox/queue changes

## Database and migration verification

- None required; none present in diff

## Security verification

- Authn/authz rules unchanged; paths only
- Session cookie `Path=/` retained (`AUTH_SESSION_COOKIE_PATH` default `/`; OpenAPI examples still `Path=/`)
- CORS/CSRF/rate-limit key naming unchanged
- Docs remain gated by `API_DOCS_ENABLED`

## Commands executed

```text
Command: npm run build:api
Result: exit 0
Conclusion: API build gate passes (AC-06)

Command: npm run lint
Result: exit 0 (--max-warnings=0)
Conclusion: Lint gate passes (AC-06)

Command: node node_modules/jest/bin/jest.js --config jest.unit.config.ts --runInBand apps/api/src/openapi/openapi-contract.spec.ts
Result: exit 0 — 1 suite, 3 tests passed
Conclusion: OpenAPI drift + hard-cutover/health routing smokes pass (AC-01–AC-04). Expected handler errors in logs are from mocked DI during smoke (non-404), not test failures.

Command: npm run test:module
Result: exit 1 — 9/10 suites passed; only apps/cron/src/cron.module.spec.ts failed (ioredis mock / BullMQ)
Conclusion: Failure is pre-existing and unrelated to TASK-002 (no cron/BullMQ/ioredis diff). openapi-contract.spec.ts is not in the module suite.

Command: Live HTTP smoke against docker compose API (127.0.0.1:3000)
Result:
  GET /health/live -> 200
  GET /v1/auth/me -> 401
  POST /auth/login -> 404
  GET /docs -> 404
  GET /v1/docs-json -> 200
  GET /v1/health/live -> 404
Conclusion: Runtime matches approved hard cutover + health neutrality + versioned docs (AC-03, AC-04, AC-05 support)

Command: Fetch /v1/docs-json and inspect paths/schemas/security
Result: paths = /health, /health/live, /health/ready, /v1/auth/{login,logout,me,refresh,register}; info.version 1.0.0; me.security bearer+session; ErrorEnvelopeDto present
Conclusion: Generated OpenAPI aligns with controllers and AC-01
```

## Findings

1. **Low — Swagger theming co-mingled in `main.ts`:** Staged diff for `apps/api/src/main.ts` includes `customSiteTitle` / `customCss` / `customJsStr` alongside `setGlobalPrefix`. Plan listed theming as out of scope. Functional versioning is correct; recommend separating theming into its own commit for clean history. Not treated as an AC failure.
2. **Low — INDEX status lag:** `docs/agent-tasks/INDEX.md` still shows TASK-002 as `proposed` while the approved specification frontmatter is `approved`. Process/docs hygiene for humans.
3. **Info — Drift runner vs plan wording:** Plan emphasized `npm run test:module`, but `openapi-contract.spec.ts` is matched by `jest.unit.config.ts` (`**/*.spec.ts` excluding `*.module.spec.ts`). Spec AC-02 explicitly allows the designated drift invocation; that invocation passes.
4. **Info — `test:module` red:** Unrelated `cron.module.spec.ts` ioredis/BullMQ mock failure; not introduced by TASK-002.

## Documentation alignment

- README and EXAMPLES advertise `/v1/auth/*` and `/v1/docs` / `/v1/docs-json`; health remains unversioned
- OpenAPI description mentions URI `/v1` and version-neutral health
- Compose prod probe documentation/path remains `/health/live`
- INDEX row status not yet updated to reflect approved specification

## Remaining risks

- Breaking cutover by design: clients on `/auth/*` or `/docs` get 404 until they move to `/v1/...`
- Future legacy-parity controllers hard-coding `v1/...` risk `/v1/v1/...` (spec Q5; out of scope)
- Commit set may accidentally include Swagger theming and/or parallel task-definition docs if not carefully staged

## Unverified areas

- Full `npm run test:unit` suite was not completed in this verifier run (shell/Node path glitch on one attempt); targeted drift suite was re-run successfully and is the AC-02 gate
- Production deploy / Kubernetes probe wiring beyond `docker-compose.prod.yml` inspection
- End-to-end authenticated login cookie round-trip under `/v1` (path prefix only; cookie `Path=/` inspected statically)
