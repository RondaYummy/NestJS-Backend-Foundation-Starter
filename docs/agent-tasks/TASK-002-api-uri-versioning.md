---
task_id: TASK-002
task_type: technical
status: approved
owner: human-approval-required
---

# TASK-002 — API URI versioning (`/v1`)

## Human decisions (2026-07-19)

1. **Versioning is required:** all public API business routes (today `/auth/*`) MUST be URI-versioned under `/v1`. (An earlier same-day note recorded this task as rejected — that was a misunderstanding; the human clarified: «я мав на увазі без версіонування ендпоінтів для /health, а API версіонувати треба 100%».)
2. **Q1 — Health endpoints: decided.** `/health`, `/health/live`, and `/health/ready` stay **version-neutral** (no `/v1` prefix) for probes and load balancers.
3. **Q2 — Docs endpoints: decided.** Swagger UI and OpenAPI JSON are served **under the prefix**: `/v1/docs` and `/v1/docs-json`.
4. **Q3 — Compatibility window: decided.** **Hard cutover** («повний перехід»): unversioned `/auth/*` routes are removed immediately; no dual-mount period.
5. **Q4 — Mechanism: decided.** Use **`setGlobalPrefix('v1')`** in `apps/api/src/main.ts`, with an exclusion list containing only the version-neutral health routes — e.g. `setGlobalPrefix('v1', { exclude: [...] })`. Nest `enableVersioning` is not used.
6. **Q6 — Cookie `Path`: decided.** Keep **`Path=/`** for the session cookie (no restriction to `/v1`).

## Original request

Поперше - всі маршрути мають бути версіоновані, наприклад зараз /v1

## Problem or opportunity

The API entrypoint currently exposes unversioned HTTP paths (`/auth/*`, `/health/*`). There is no NestJS URI versioning and no global `/v1` prefix. As a reusable starter kit, every public business route should live under an explicit API version so future breaking changes can introduce `/v2` without colliding with `/v1`, and so consumers and OpenAPI always know which contract they are calling.

Today this is a breaking public-surface gap: documentation, drift tests, Docker health probes, and curl examples all assume unversioned paths.

## Goal

Make every intentionally public API business route versioned under URI version `v1` (paths such as `/v1/auth/...`), using NestJS URI versioning (or an equivalent explicitly approved mechanism), while keeping health endpoints (`/health`, `/health/live`, `/health/ready`) version-neutral, and keep the generated OpenAPI document and drift checks aligned with the new runtime paths.

## Users and actors

- API HTTP clients (curl, frontends, integration tests) calling auth and health endpoints.
- Operators and orchestrators using liveness/readiness probes (`docker-compose.prod.yml` currently probes `GET /health/live`).
- Developers consuming Swagger UI (`/docs`) and OpenAPI JSON (`/docs-json`).
- Future NestJS starter consumers who expect a versioned HTTP convention.

## Current system context

Inspected state of the API entrypoint (no URI versioning today):

| Area                | Current behavior                                                                                                                                                                |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bootstrap           | `apps/api/src/main.ts` — no `enableVersioning()`, no `setGlobalPrefix()`                                                                                                        |
| Auth controller     | `apps/api/src/controllers/auth.controller.ts` — `@Controller('auth')`                                                                                                           |
| Health controller   | `libs/infrastructure/src/health/health.controller.ts` — `@Controller('health')`                                                                                                 |
| Controllers present | Only `AuthController` under `apps/api` (plus infrastructure `HealthController`)                                                                                                 |
| OpenAPI             | `apps/api/src/openapi/create-openapi-document.ts` — `DocumentBuilder.setVersion('1.0.0')` is **document** metadata, not URI versioning; docs served at `/docs` and `/docs-json` |
| Drift test          | `apps/api/src/openapi/openapi-contract.spec.ts` asserts unversioned paths                                                                                                       |
| Prod probe          | `docker-compose.prod.yml` — `GET http://127.0.0.1:3000/health/live`                                                                                                             |
| Docs                | `README.md`, `EXAMPLES.md` document unversioned `/auth/*`, `/health`, `/docs`                                                                                                   |

**Current HTTP routes (runtime):**

| Method | Path             | Auth                                               | Notes                                            |
| ------ | ---------------- | -------------------------------------------------- | ------------------------------------------------ |
| `POST` | `/auth/register` | Public (+ rate limit)                              | Creates account; no tokens/cookie                |
| `POST` | `/auth/login`    | Public (+ rate limit)                              | JWT body tokens or session `Set-Cookie`          |
| `POST` | `/auth/logout`   | Public (credential in body/cookie/optional Bearer) | Clears session cookie when applicable            |
| `POST` | `/auth/refresh`  | Public (+ rate limit); JWT-only                    | Body `refreshToken`                              |
| `GET`  | `/auth/me`       | Bearer JWT **or** session cookie (+ rate limit)    |                                                  |
| `GET`  | `/health`        | Public                                             | Aggregate dependency check; `503` when unhealthy |
| `GET`  | `/health/live`   | Public                                             | Process liveness; no dependency probes           |
| `GET`  | `/health/ready`  | Public                                             | Readiness; `503` when not ready                  |
| `GET`  | `/docs`          | Public when `API_DOCS_ENABLED`                     | Swagger UI (not a Nest controller route)         |
| `GET`  | `/docs-json`     | Public when `API_DOCS_ENABLED`                     | OpenAPI JSON                                     |

Worker and Cron entrypoints do not host these HTTP controllers.

Related but separate: migration/parity documentation elsewhere discusses legacy hard-coded paths such as `/v1/auth/*` as compatibility surfaces. This task is about **starter-kit URI versioning for the current API routes**, not about implementing legacy parity controllers.

## Functional requirements

- **FR-01:** Apply the `/v1` URI prefix via **`setGlobalPrefix('v1')`** in `apps/api/src/main.ts` (human decision Q4), excluding only the version-neutral health routes (Q1) through the `exclude` option or an equivalent documented mechanism. Do not manually prefix `@Controller('v1/...')` strings and do not use `enableVersioning`.
- **FR-02:** After the prefix is enabled, every business/auth route currently listed under Current system context must be reachable **only** under the `/v1/...` path form; unversioned `/auth/*` must return 404 (hard cutover, human decision Q3 — no dual-mount).
- **FR-03:** Auth route contracts (request bodies, success envelopes, status codes, error envelope, rate limits, Bearer/session auth, `Set-Cookie` behavior) must remain behaviorally unchanged aside from the path prefix. Controller OpenAPI operation text that hard-codes unversioned paths (for example “Call `POST /auth/login`”) must be updated to the versioned paths.
- **FR-04:** Health routes remain **version-neutral** at `/health`, `/health/live`, `/health/ready` (human decision 2026-07-19). The global prefix must exclude the health routes (e.g. `setGlobalPrefix('v1', { exclude: ['health', 'health/live', 'health/ready'] })` or equivalent), applied consistently in runtime, OpenAPI, drift tests, and deployment probes.
- **FR-05:** Swagger UI and OpenAPI JSON move under the prefix: **`/v1/docs`** and **`/v1/docs-json`** (human decision Q2). Since `SwaggerModule.setup` mounts docs outside Nest routing, the setup path must be updated explicitly (e.g. `SwaggerModule.setup('v1/docs', ...)`); old `/docs` and `/docs-json` must no longer respond. The generated document must describe the versioned runtime paths (and unversioned health) accurately.
- **FR-06:** Update canonical documentation (`README.md`, `EXAMPLES.md`, and any other starter docs that publish these URLs) so examples and tables use the approved versioned paths.
- **FR-07:** Operational probes that call health endpoints (at minimum the `docker-compose.prod.yml` liveness check) keep the unversioned `/health/...` paths; verify they still work after versioning is enabled (no probe URL change expected).
- **FR-08:** Update `apps/api/src/openapi/openapi-contract.spec.ts` (and any related module/bootstrap tests) so expected OpenAPI `paths` keys and smoke requests match runtime after versioning. The OpenAPI drift test remains the contract gate for HTTP surface changes.

## Non-functional requirements

- **NFR-01:** Change is limited to the API HTTP surface and docs/probes that reference it; do not alter domain/application auth semantics, Worker, Cron, or Migrations entrypoints.
- **NFR-02:** The global prefix must be configured once in the API bootstrap so future controllers inherit the convention without repeating `v1` in controller path strings; the health exclusion list is the single place where version-neutral routes are declared.
- **NFR-03:** Generated OpenAPI must remain the canonical HTTP contract; drift checks must fail if documented paths diverge from controllers.
- **NFR-04:** Breaking-change impact must be explicit in Compatibility and Rollout sections; no silent dual behavior unless human-approved.
- **NFR-05:** Portable Health module consumers must remain usable: health stays version-neutral, so enabling URI versioning in the API bootstrap must not force the HealthModule (or its other consumers) under `/v1`.

## Public API and interface impact

### HTTP API contract

This task **changes every versioned route’s path**. Method, bodies, auth, cookies, and status codes stay as today unless noted.

#### Auth (expected after versioning)

| Method | New path            | Auth                                      | Request                                                                        | Success                                                              | Errors                                                          | Headers / cookies                                                                |
| ------ | ------------------- | ----------------------------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------- | --------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `POST` | `/v1/auth/register` | Public + rate limit                       | `RegisterDto` JSON                                                             | `201` `{ success: true, data: { user } }` (`RegisterResponseDto`)    | `400` validation, `409` email conflict, `429` rate limit, `500` | None issued                                                                      |
| `POST` | `/v1/auth/login`    | Public + rate limit                       | `LoginDto` JSON                                                                | `201` `{ success: true, data: { user, auth } }` (`LoginResponseDto`) | `400`, `429`, `500`                                             | `Set-Cookie` when `AUTH_DRIVER=session` (cookie name from config, default `sid`) |
| `POST` | `/v1/auth/logout`   | Public (credentials as today)             | `LogoutDto` (JWT may require `refreshToken`); optional `Authorization: Bearer` | `201` `{ success: true }` (`LogoutResponseDto`)                      | `400`, `401`, `500`                                             | Clears session cookie when session mode                                          |
| `POST` | `/v1/auth/refresh`  | Public + rate limit; JWT-only             | `RefreshTokenDto`                                                              | `201` rotated tokens (`RefreshResponseDto`)                          | `400`, `401` (incl. session mode unsupported), `429`, `500`     | None                                                                             |
| `GET`  | `/v1/auth/me`       | Bearer **or** session cookie + rate limit | —                                                                              | `200` `{ success: true, data: user }` (`CurrentUserResponseDto`)     | `401`, `404`, `429`, `500`                                      | Uses `Authorization: Bearer` and/or configured session cookie                    |

Shared error shape remains `ErrorEnvelopeDto` for documented 4xx/5xx responses.

#### Health (decided: version-neutral, unchanged paths)

| Method | Path            | Auth   | Success                     | Errors                                             |
| ------ | --------------- | ------ | --------------------------- | -------------------------------------------------- |
| `GET`  | `/health`       | Public | `200` `HealthResponseDto`   | `503` / `500` with error envelope where documented |
| `GET`  | `/health/live`  | Public | `200` `LivenessResponseDto` | `500`                                              |
| `GET`  | `/health/ready` | Public | `200` `HealthResponseDto`   | `503` / `500`                                      |

#### Documentation endpoints (decided: prefixed)

| Method | Path            | Notes                                                            |
| ------ | --------------- | ---------------------------------------------------------------- |
| `GET`  | `/v1/docs`      | Swagger UI (moved under prefix per Q2)                           |
| `GET`  | `/v1/docs-json` | OpenAPI 3.x JSON; path keys must reflect approved runtime routes |

#### OpenAPI schemas/decorators to add or update

- Controllers: ensure the global prefix is reflected in generated OpenAPI paths (Nest Swagger respects `setGlobalPrefix` unless `ignoreGlobalPrefix` is set; exclusions must render unprefixed).
- `create-openapi-document.ts`: description/title may mention URI version `v1`; do not confuse OpenAPI `info.version` (`1.0.0`) with URI versioning unless intentionally aligned.
- Auth operation descriptions that cite `/auth/...` must cite `/v1/auth/...`.
- `openapi-contract.spec.ts`: expected route list, schema refs, security on `/v1/auth/me`, and `/v1/docs-json` path assertions must use the approved paths.
- No change to request/response DTO schemas is required solely for path prefixing.

#### Acceptance criterion that verifies generated OpenAPI against runtime behavior

See **AC-01**, **AC-02**, **AC-03**.

## Data model and migration impact

None. No database schema or Drizzle migration changes.

## Events, queues and background processing

None. Outbox, BullMQ, Worker, and Cron behavior are unchanged.

## Security and authorization

- Authn/authz rules stay the same; only URL paths change.
- Session cookie keeps `Path=/` (human decision Q6); it remains valid for `/v1/...` routes and version-neutral health routes alike.
- Rate-limit key prefixes may stay logical (`auth:login`, etc.); path change alone does not require renaming Redis keys unless a plan chooses to.
- CORS and CSRF posture unchanged.

## Entrypoints and deployment impact

- **API:** bootstrap versioning in `apps/api/src/main.ts` (and any test app factories that must mirror production routing for drift/e2e).
- **Worker / Cron / Migrations:** no HTTP route changes.
- **Deploy:** update `docker-compose.prod.yml` healthcheck URL if health paths change; document probe path for Kubernetes/other orchestrators in README if documented there.
- **Health module portability:** composition choice for versioned vs neutral health must not force every HealthModule consumer into API-only versioning without documentation.

## Observability and operations

- Liveness/readiness probe URLs are an operational contract; they must match the approved health versioning decision.
- Log messages that embed absolute paths (if any) should be updated for consistency; structured fields need not change.

## Compatibility requirements

- **Breaking change** for all clients using unversioned `/auth/*`. Health paths are unchanged (version-neutral).
- Unversioned business paths return Nest’s normal 404 after the hard cutover (decided Q3); no dual-mount or compatibility shim.
- Starter documentation and examples must not continue to advertise removed paths.
- If parallel migration/parity work introduces separate legacy controllers under hard-coded `/v1/...` path strings, planners must reconcile with Nest URI versioning to avoid double-prefixing (`/v1/v1/...`) — see Open questions.

## Dependencies

- Nest `setGlobalPrefix(prefix, { exclude })` already available via `@nestjs/common` / `INestApplication`.
- `@nestjs/swagger` must generate paths that include the global prefix for prefixed controllers (verify `ignoreGlobalPrefix` behavior in document setup).
- No new npm dependencies expected.

## Assumptions

- **A1:** This request is a new technical task, not a bugfix from `docs/agent-backlog/`.
- **A2:** Scope is the current API entrypoint HTTP surface only (auth + health + docs alignment), not implementing legacy OLD_BACKEND parity routes.
- **A3:** The first URI version string is `1`, exposed as path prefix `/v1` (Nest URI versioning convention).
- **A4:** Request/response JSON shapes, status codes, error envelope, and auth schemes do not change; only path prefixing (and docs/probes) change.
- **A5:** Docs endpoints are versioned: `/v1/docs` and `/v1/docs-json` (human decision Q2).
- **A6:** `DocumentBuilder.setVersion('1.0.0')` may remain the OpenAPI document version independently of URI `/v1`.
- **A7:** Parent agent owns `docs/agent-tasks/INDEX.md` updates for this parallel task-definition run.

## Out of scope

- Implementing `/v2` or header/media-type versioning.
- Changing auth business rules, DTO fields, cookie names, or JWT/session drivers.
- Legacy OLD_BACKEND `/v1/*` parity controllers and response-shape compatibility (separate migration tasks).
- Worker, Cron, or Migrations HTTP (they are not API servers).
- Frontend client updates outside this repository.
- Approving or implementing a temporary unversioned compatibility shim unless humans answer that open question.

## Acceptance criteria

- **AC-01:** With the API bootstrapped as in production, generated OpenAPI (`/v1/docs-json` when docs enabled) lists every approved auth route under `/v1/auth/...` with the same methods, and documents for each: request body/requiredness (where applicable), success status + typed schema, at least one 4xx/5xx error using the shared error envelope, and auth/security schemes (`bearerAuth` / `sessionCookie`) plus cookie/`Set-Cookie` notes where they apply today.
- **AC-02:** `npm run test:module` (or the project’s designated OpenAPI drift invocation covering `openapi-contract.spec.ts`) passes with expected paths updated to the approved versioned (and version-neutral, if any) routes; assertions that previously targeted `/auth/...` and health paths are updated accordingly.
- **AC-03:** Runtime smoke (supertest or equivalent in the drift/module test, and/or manual bootstrap when infra is available) confirms versioned auth routes respond on `/v1/...` and unversioned `/auth/...` return 404 (hard cutover per Q3).
- **AC-04:** Health endpoints remain reachable at unversioned `/health`, `/health/live`, `/health/ready` after versioning is enabled; OpenAPI, drift tests, and `docker-compose.prod.yml` (and README probe docs if present) all agree on these unversioned paths, and `/v1/health...` is not the documented contract.
- **AC-05:** `README.md` and `EXAMPLES.md` curl/tables for auth, health, and docs use the approved paths; no stale unversioned auth examples remain as the recommended contract.
- **AC-06:** `npm run build:api` and `npm run lint` succeed for the implementation.
- **AC-07:** No production behavior changes outside the API HTTP path/docs/probe scope described above.

## Verification strategy

1. Static inspection: `main.ts` `setGlobalPrefix` config and exclusion list; OpenAPI path keys; docs and compose probe URLs.
2. `npm run test:module` with focus on `apps/api/src/openapi/openapi-contract.spec.ts`.
3. `npm run build:api` and `npm run lint`.
4. Optional runtime: `npm run start:api` (or compose) and `curl`/`fetch` against `/v1/auth/me` (expect 401 without creds) and unversioned `/health/live`; confirm old `/auth/login` is 404.
5. Compare generated OpenAPI paths to controller methods one-by-one (drift test is necessary but not sufficient alone for probe/docs files).

## Rollout and rollback

- **Rollout:** Single breaking cutover (decided Q3): publish versioned paths, update docs and probes in the same change. Consumers must update base URLs to `/v1`.
- **Rollback:** Revert the `setGlobalPrefix` bootstrap change and documentation/probe edits; restore unversioned paths.

## Open questions requiring human decision

1. **Q1 — Health endpoints:** **Decided — version-neutral.** `/health`, `/health/live`, `/health/ready` keep their unversioned paths.
2. **Q2 — Docs endpoints:** **Decided — prefixed.** Docs move to `/v1/docs` and `/v1/docs-json`.
3. **Q3 — Compatibility window:** **Decided — hard cutover.** Unversioned routes removed immediately; no dual-mount.
4. **Q4 — Mechanism:** **Decided — `setGlobalPrefix('v1')`** with exclusions for health only.
5. **Q5 — Migration/parity interaction:** If upcoming legacy-parity work adds controllers with hard-coded `v1/...` path segments, planners must reconcile with the global prefix to avoid `/v1/v1/...` (defer detailed design to that task).
6. **Q6 — Cookie `Path`:** **Decided — keep `Path=/`.**
