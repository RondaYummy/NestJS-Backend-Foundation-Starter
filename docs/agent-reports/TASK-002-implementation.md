# TASK-002 — Implementation report

## Verdict

implemented

## Approved specification

- `docs/agent-tasks/TASK-002-api-uri-versioning.md` — frontmatter `status: approved` (verified before editing).
- Decisions honored: Q1 health version-neutral, Q2 docs under `/v1/docs` + `/v1/docs-json`, Q3 hard cutover, Q4 `setGlobalPrefix('v1', { exclude })`, Q6 cookie `Path=/` untouched.

## Approved plan

- `docs/agent-plans/TASK-002-api-uri-versioning.md` — frontmatter `status: approved` (verified before editing).
- All six phases implemented in order; no production files outside the plan's "Files to modify" list were changed.

## Changed files

Verified with `git diff HEAD --name-only` / `--stat` after completion:

| File                                                      | Change                                                                                                                                                                                                                                                           | By this task?                                                                                                                                     |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/src/main.ts`                                    | Added `setGlobalPrefix('v1', { exclude: ['health', 'health/live', 'health/ready'] })` before OpenAPI setup and `listen`                                                                                                                                          | Yes (the Swagger `customSiteTitle`/`customCss`/`customJsStr` hunk in the same file is a **pre-existing staged user change**, preserved untouched) |
| `apps/api/src/openapi/create-openapi-document.ts`         | `API_DOCS_PATH = 'v1/docs'`, `API_DOCS_JSON_PATH = 'v1/docs-json'` (normalized, no leading slash); description mentions URI `/v1`; `setVersion('1.0.0')` unchanged; no `ignoreGlobalPrefix`                                                                      | Yes                                                                                                                                               |
| `apps/api/src/controllers/auth.controller.ts`             | Register `@ApiOperation` description now cites `POST /v1/auth/login`                                                                                                                                                                                             | Yes                                                                                                                                               |
| `apps/api/src/openapi/openapi-contract.spec.ts`           | Test app mirrors production prefix + exclude; expected paths `/v1/auth/*` + unversioned `/health*`; docs smoke on `/v1/docs` and `/v1/docs-json`; new hard-cutover test (unversioned auth/docs 404, `/v1/health*` 404, versioned auth and neutral health routed) | Yes                                                                                                                                               |
| `README.md`                                               | Docs URLs → `/v1/docs`, `/v1/docs-json`; auth examples → `/v1/auth/*`; health untouched                                                                                                                                                                          | Yes                                                                                                                                               |
| `EXAMPLES.md`                                             | Curl examples, idempotency list, checklist and tutorial URLs → `/v1/...`; health untouched                                                                                                                                                                       | Yes                                                                                                                                               |
| `docs/agent-plans/README.md`, `docs/agent-tasks/INDEX.md` | Pre-existing working-tree changes from the parallel task-definition run                                                                                                                                                                                          | No — preserved, not touched                                                                                                                       |

`docker-compose.prod.yml` was read-confirmed only: probe stays `GET http://127.0.0.1:3000/health/live` (correct per Q1, no edit needed).

## Completed phases

1. **Phase 1 — Bootstrap prefix:** `setGlobalPrefix('v1', { exclude: [...] })` added in `bootstrap()` after global pipes, before `createOpenApiDocument`/`SwaggerModule.setup`/`listen`.
2. **Phase 2 — Docs constants:** `API_DOCS_PATH`/`API_DOCS_JSON_PATH` normalized to `v1/docs`/`v1/docs-json`; startup log renders `/v1/docs` and `/v1/docs-json` without double slashes.
3. **Phase 3 — Auth operation text:** register description updated; grep confirms no remaining unversioned `/auth/...` client-path citations in the controller.
4. **Phase 4 — Drift test parity:** test app applies the identical prefix/exclude; assertions updated; new 404/routing smoke test added.
5. **Phase 5 — Docs and probe:** README/EXAMPLES updated; repo-wide grep for `localhost:3000/auth|docs` finds no stale references outside the plan document itself; compose probe confirmed unchanged.
6. **Phase 6 — Build and lint gate:** `npm run build:api` and `npm run lint` pass.

## Acceptance criteria self-check

| AC    | Status               | Evidence                                                                                                                                                                                                                              |
| ----- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-01 | Met                  | Drift spec asserts every `/v1/auth/*` route with methods, request schema refs, success + error responses, `bearerAuth`/`sessionCookie` security on `/v1/auth/me`; `/v1/docs-json` smoke returns the document with `/v1/auth/register` |
| AC-02 | Met (see Deviations) | Drift spec passes; it is covered by the unit Jest config, not the module config — `npm run test:unit` (130 tests) passes and is the designated invocation covering `openapi-contract.spec.ts`                                         |
| AC-03 | Met                  | Supertest smoke in drift spec: `POST /auth/register` and `POST /auth/login` → 404; `POST /v1/auth/register` routed (non-404); `/docs`/`/docs-json` → 404                                                                              |
| AC-04 | Met                  | `/health`, `/health/live`, `/health/ready` routed unprefixed in tests; `/v1/health` and `/v1/health/live` → 404; OpenAPI keys unversioned for health; compose probe unchanged                                                         |
| AC-05 | Met                  | README/EXAMPLES greps show only `/v1/...` auth/docs URLs; health examples remain unversioned                                                                                                                                          |
| AC-06 | Met                  | `npm run build:api` exit 0; `npm run lint` exit 0                                                                                                                                                                                     |
| AC-07 | Met                  | Diff limited to API bootstrap, OpenAPI helpers/spec, auth controller doc string, README, EXAMPLES; no Worker/Cron/Migrations/domain/application changes                                                                               |

## Contract and DI changes

None. No tokens, ports, providers or composition-module changes. `HealthController` stays `@Controller('health')`; the exclusion lives only in the API bootstrap (NFR-02/NFR-05).

## Database and migration changes

None.

## Commands executed

```bash
npm run test:module                                                     # initial targeted check
node node_modules/jest/bin/jest.js --config jest.unit.config.ts --runInBand apps/api/src/openapi/openapi-contract.spec.ts
node node_modules/jest/bin/jest.js --config jest.module.config.ts --runInBand apps/cron/src/cron.module.spec.ts   # pre-existing failure isolation
npm run build:api
npm run lint
npm run test:module                                                     # final
npm run test:unit
git diff HEAD --name-only
git diff HEAD --stat
```

## Command results

| Command                                | Result                                                                                                                                               | Conclusion                                                                                                                                                                                                                                                                                      |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run build:api`                    | Exit 0                                                                                                                                               | AC-06 build gate passes                                                                                                                                                                                                                                                                         |
| `npm run lint`                         | Exit 0 (`--max-warnings=0`)                                                                                                                          | AC-06 lint gate passes                                                                                                                                                                                                                                                                          |
| Drift spec via unit config             | Exit 0 — 3/3 tests pass                                                                                                                              | AC-01/AC-02/AC-03/AC-04 drift assertions pass                                                                                                                                                                                                                                                   |
| `npm run test:unit`                    | Exit 0 — 19 suites, 130 tests pass (includes `openapi-contract.spec.ts`)                                                                             | No unit regressions                                                                                                                                                                                                                                                                             |
| `npm run test:module`                  | Exit 1 — 9/10 suites pass; only `apps/cron/src/cron.module.spec.ts` fails (`ioredis_1.default is not a constructor` in its BullMQ/ioredis jest mock) | **Pre-existing failure unrelated to TASK-002**: the diff touches no cron, BullMQ, ioredis or libs file; the same failure reproduces in isolation and occurred on the first run before the drift-spec edits were exercised by this config (the spec is not matched by `*.module.spec.ts` at all) |
| `git diff HEAD --name-only` / `--stat` | 8 files (6 from this task + 2 pre-existing docs changes)                                                                                             | Matches the changed-file list above                                                                                                                                                                                                                                                             |

## Deviations

1. **Drift test runner (minor, no scope change):** the plan assumed `npm run test:module` covers `openapi-contract.spec.ts`, but the module config only matches `**/*.module.spec.ts`. The spec is actually executed by the unit config (`npm run test:unit`), which the specification's AC-02 explicitly allows ("or the project's designated OpenAPI drift invocation"). Both the isolated drift run and the full `test:unit` suite pass. No config was modified.
2. **`test:module` exits 1** due to the pre-existing, unrelated `cron.module.spec.ts` ioredis-mock failure described above. All 9 other module suites (including both API module suites) pass. Not fixed here — that would be an unapproved scope expansion into Cron/BullMQ test mocks.

## Documentation changes

- `README.md`: Swagger/OpenAPI URLs (§3.1.1), registration flow (§7), refresh/token-family/logout sections (§16) now use `/v1/...`; health untouched.
- `EXAMPLES.md`: all auth curl examples, session-driver notes, idempotency exclusion list, endpoint-tutorial verification URL and the feature checklist now use `/v1/...`; health untouched.
- Generated OpenAPI description now states that business routes are versioned under `/v1` and health is version-neutral.

## Remaining risks

- Breaking change by design (Q3 hard cutover): external clients calling `/auth/*`, `/docs`, `/docs-json` get 404 until they switch to `/v1/...`.
- Future legacy-parity tasks adding `@Controller('v1/...')` would double-prefix to `/v1/v1/...` (documented Q5; deferred to those tasks' planners).
- Pre-existing `cron.module.spec.ts` failure keeps `npm run test:module` red until fixed in its own bugfix.

## Unverified areas

- Manual runtime curl against a live bootstrapped API (`/v1/auth/me` → 401, `/health/live` → 200) was optional in the plan and not run: the local docker compose stack was stopped by the user during implementation. Equivalent supertest smoke coverage in `openapi-contract.spec.ts` passes; the production-identical prefix/exclude call order in `main.ts` was verified by static inspection and `npm run build:api`.
- `docker-compose.prod.yml` probe verified by inspection only (no production deploy performed).
