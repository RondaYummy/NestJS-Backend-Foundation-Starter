---
task_id: TASK-001
specification: docs/agent-tasks/TASK-001-api-contract-documentation.md
status: approved
owner: human-approval-required
---

# TASK-001 — Implementation plan

## Approved specification

- **Path:** `docs/agent-tasks/TASK-001-api-contract-documentation.md`
- **Frontmatter status:** `approved` (confirmed; planner did not change it)
- **INDEX drift:** `docs/agent-tasks/INDEX.md` still lists TASK-001 as `proposed`. That is documentation drift only. The specification file is the source of truth for approval. Implementer must not edit the specification; a human may update INDEX status separately after plan approval.

## Current implementation

### HTTP surface (8 routes)

| Method | Path             | Location                                              | Auth                                                                          |
| ------ | ---------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------- |
| `POST` | `/auth/register` | `apps/api/src/controllers/auth.controller.ts`         | Public + rate limit                                                           |
| `POST` | `/auth/login`    | same                                                  | Public + rate limit; session cookie via `SessionCookieService.attachIfNeeded` |
| `POST` | `/auth/logout`   | same                                                  | Public; Bearer and/or cookie + optional body `refreshToken`                   |
| `POST` | `/auth/refresh`  | same                                                  | Public + rate limit; JWT refresh body only                                    |
| `GET`  | `/auth/me`       | same                                                  | `AuthGuard` (Bearer **or** session cookie) + rate limit                       |
| `GET`  | `/health`        | `libs/infrastructure/src/health/health.controller.ts` | Public                                                                        |
| `GET`  | `/health/live`   | same                                                  | Public                                                                        |
| `GET`  | `/health/ready`  | same                                                  | Public                                                                        |

### Request DTOs (`apps/api/src/dto/auth/`)

- `RegisterDto` / `LoginDto`: `email` (`@IsEmail`), `password` (`@IsString` `@MinLength(8)`)
- `RefreshTokenDto`: required `refreshToken` (`@MinLength(1)`)
- `LogoutDto`: optional `refreshToken` (required at runtime for `AUTH_DRIVER=jwt` via `JwtAuthTokenService.revoke`)

### Response shapes (actual)

- Success envelope (Auth): `{ success: true, data?: ... }` — logout returns `{ success: true }` only
- Register `data`: `{ user: { id, email, roles } }` — no tokens
- Login `data`: `{ user, auth }` where `auth` is `AuthTokens` (`accessToken`/`refreshToken` for JWT; `sessionId`/`expiresAt` for session) plus `Set-Cookie` when session
- Refresh `data`: rotated JWT `AuthTokens`
- Me `data`: `{ id, email, roles }`
- Health `/health` and `/ready`: `{ status, services: { postgres, redis, bullmq } }` or `503` via `ServiceUnavailableException`
- Health `/live`: `{ status: 'ok' }`
- Errors: `GlobalExceptionFilter` → `{ success: false, error: { code, message, details } }`

### Auth driver differences (must document, must not change)

- `AUTH_DRIVER=jwt` (default): login returns tokens; refresh rotates refresh family; logout requires body `refreshToken`; optional Bearer access for access-token blacklist; cookie unused
- `AUTH_DRIVER=session`: login sets httpOnly cookie (`AUTH_SESSION_COOKIE_NAME`, default `sid`); refresh rejects with `REFRESH_TOKEN_NOT_SUPPORTED`; logout uses cookie session id and clears cookie; access token optional

### Bootstrap / config today

- `apps/api/src/main.ts`: ValidationPipe, CORS, cookie-parser, listen — **no Swagger**
- `libs/infrastructure/src/config/env.schema.ts`: no docs flag
- `package.json`: Nest `^11.1.26`; **no** `@nestjs/swagger`
- Peers already present: `class-validator`, `class-transformer`, `reflect-metadata`

### Docs / workflow gaps

- `README.md` / `EXAMPLES.md`: partial curl examples; no canonical OpenAPI URLs or enablement flag
- `EXAMPLES.md` §1 (“Додати новий HTTP endpoint”) ends at controller wiring + smoke curl — no OpenAPI update rule
- New-task artifacts (`TEMPLATE.md`, `AGENTS.md`, `.cursor/rules/50-new-task-delivery.mdc`, four task skills, four Cursor commands) do not require API-contract documentation for HTTP-changing tasks

## Architecture decision

### AD-1 — Nest OpenAPI only in API bootstrap (proposed)

Use official `@nestjs/swagger` **11.x** (peer-compatible with Nest 11). Call `DocumentBuilder` + `SwaggerModule.createDocument` + `SwaggerModule.setup` **only** from `apps/api/src/main.ts` (or a thin helper imported solely by API main). Worker / Cron / Migrations must not import Swagger setup.

### AD-2 — Documentation URLs (proposed for human approval)

| Surface      | Path         | Rationale                                                                       |
| ------------ | ------------ | ------------------------------------------------------------------------------- |
| Swagger UI   | `/docs`      | Nest `SwaggerModule.setup('docs', …)` default; short, stable, conventional      |
| OpenAPI JSON | `/docs-json` | Nest default companion route for the same path prefix; clients/codegen-friendly |

Do **not** remount under `/api` or change Nest defaults unless a human rejects this choice. Document both URLs in README/EXAMPLES.

### AD-3 — Config / env flag (proposed for human approval)

| Item              | Choice                                                                                            |
| ----------------- | ------------------------------------------------------------------------------------------------- |
| Env name          | `API_DOCS_ENABLED`                                                                                |
| Config path       | `app.apiDocsEnabled` on `AppConfigService.app()` (extend existing `app` shape)                    |
| Parsing           | `z.preprocess` / coerce boolean from `"true"`/`"false"`/`1`/`0`; optional override                |
| Default           | **ON** when `NODE_ENV` is `development` or `test`; **OFF** when `NODE_ENV` is `production`        |
| Production opt-in | Explicit `API_DOCS_ENABLED=true` required to expose `/docs` and `/docs-json`                      |
| Disabled behavior | Skip `SwaggerModule.setup` entirely; no docs routes; log one info line that API docs are disabled |

Rationale: matches NFR-05 (safe production default) and FR-02 (explicit operator control) while keeping local/dev ergonomics without mandatory `.env` edits.

### AD-4 — JWT vs session documentation without runtime change (proposed)

Document **both** drivers in one OpenAPI document (document is not driver-specific at bootstrap):

1. **Security schemes**
   - `bearerAuth`: HTTP Bearer JWT access token
   - `sessionCookie`: API key / cookie scheme named after `AUTH_SESSION_COOKIE_NAME` default `sid` (document that the real name follows env)
2. **`GET /auth/me`**: security requirement = either scheme (document “Bearer **or** session cookie depending on `AUTH_DRIVER`”)
3. **Login / register / refresh / logout**: operation descriptions + `@ApiResponse` examples covering JWT and session variants; use typed response DTO classes with optional fields matching `AuthTokens`, plus explicit prose for cookie `Set-Cookie` / `Clear-Cookie`
4. **Refresh**: mark as JWT-only; document `401`/`AUTHENTICATION` style error when `AUTH_DRIVER=session`
5. **Logout**: document optional body `refreshToken` required for JWT; cookie clear always; logout allowed without valid access token when JWT refresh (or session id) is provided as today

No dual OpenAPI documents, no runtime branching of business handlers for docs.

### AD-5 — Where OpenAPI lives vs Health controller (proposed)

- Auth DTOs, response schema classes, security decorators: **`apps/api` only**
- Health controller already lives in infrastructure and already depends on Nest HTTP. **Allow** `@nestjs/swagger` decorators on `HealthController` / health response types under `libs/infrastructure/src/health/` so routes are discoverable by `createDocument`. This does **not** violate NFR-06 (Domain / Application / Contracts stay free of Swagger).
- Shared error envelope schema class: prefer `apps/api/src/openapi/` (or `apps/api/src/dto/common/`) so Domain stays clean; reference it from Auth and Health `@ApiResponse` decorators.

### AD-6 — Automated drift check (proposed for human approval)

| Item       | Choice                                                                                                                                                                                                                                                                        |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| File       | `apps/api/src/openapi/openapi-contract.spec.ts`                                                                                                                                                                                                                               |
| Suite      | **Unit** (`npm run test:unit`) — not `*.module.spec.ts`                                                                                                                                                                                                                       |
| Why unit   | Contract assertion, not DI wiring; must run in the fast agent gate; avoid Redis/Postgres                                                                                                                                                                                      |
| Mechanism  | `Test.createTestingModule` with Auth + Health controllers, stubbed use cases / health service / config / logger; `SwaggerModule.createDocument(app, DocumentBuilder…)` using the **same** document factory helper as production bootstrap                                     |
| Assert     | (1) all 8 paths exist with correct methods; (2) components include named schemas for error envelope + key request/response bodies (`RegisterDto`, login/register success, health result, etc.); (3) securitySchemes include bearer + cookie; (4) `/auth/me` declares security |
| Fail modes | Missing path/method, missing required schema name, missing security scheme                                                                                                                                                                                                    |

Optional thin helper: `apps/api/src/openapi/create-openapi-document.ts` shared by `main.ts` and the unit test so title/version/security schemes cannot drift between runtime and test.

### AD-7 — Workflow artifacts for FR-11 / FR-12 (proposed exact list)

Update **all** of the following (no silent omissions):

| Artifact                                      | Change                                                                                                                                                            |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.cursor/rules/50-new-task-delivery.mdc`      | Add always-applied bullet: HTTP endpoint add/change tasks must include API-contract requirements, plan steps, implementation updates, and verification of OpenAPI |
| `AGENTS.md`                                   | Under new-task definition / planning / implementation / verification / definition of done: require OpenAPI updates for HTTP contract changes                      |
| `docs/agent-tasks/TEMPLATE.md`                | Add checklist subsection “HTTP API contract (if applicable)” covering inputs, outputs, status codes, errors, auth, headers/cookies, OpenAPI update AC             |
| `docs/agent-tasks/README.md`                  | One short rule pointing to OpenAPI as canonical contract for HTTP tasks                                                                                           |
| `.cursor/skills/task-definition/SKILL.md`     | When HTTP surface changes → require FR/AC for OpenAPI                                                                                                             |
| `.cursor/skills/task-planning/SKILL.md`       | Map OpenAPI file/schema updates into plan phases + verification                                                                                                   |
| `.cursor/skills/task-implementation/SKILL.md` | Implement OpenAPI annotations/schemas in same task; fail done-check if docs omitted                                                                               |
| `.cursor/skills/task-verification/SKILL.md`   | Independently verify OpenAPI vs real controllers/DTOs/filter; run drift test                                                                                      |
| `.cursor/commands/define-task.md`             | Remind analyst to include API-contract FR/AC when endpoints change                                                                                                |
| `.cursor/commands/plan-task.md`               | Remind planner to plan OpenAPI updates                                                                                                                            |
| `.cursor/commands/implement-task.md`          | Remind implementer to update OpenAPI                                                                                                                              |
| `.cursor/commands/verify-task.md`             | Remind verifier to check OpenAPI + drift test                                                                                                                     |
| `EXAMPLES.md` §1                              | Add mandatory OpenAPI documentation step + link to `/docs`                                                                                                        |
| `README.md`                                   | New short section: enablement (`API_DOCS_ENABLED`), URLs, canonical-contract rule                                                                                 |

Do **not** invent a separate always-apply rule file unless the human prefers splitting; extending `50-new-task-delivery.mdc` keeps one delivery gate.

## Scope

- Add `@nestjs/swagger@^11` dependency + lockfile update as direct consequence
- Env/config for `API_DOCS_ENABLED` with production-safe default
- OpenAPI bootstrap in API `main.ts` only (gated)
- Typed Swagger decorators/schemas for all 8 routes
- Document JWT/session/security/error envelope accurately
- Sync README + EXAMPLES; harden “add endpoint” checklist
- Encode FR-11/FR-12 into listed workflow artifacts
- Unit OpenAPI drift test via shared document factory
- Startup log when docs enabled (URLs) or disabled

## Out of scope

- New business endpoints; Auth/Health behavior changes
- SDK generation / developer portal
- Worker/Cron/Migrations HTTP docs
- DB / queues / Outbox / email changes
- Changing Nest default docs paths away from `/docs` and `/docs-json` (unless human rejects AD-2)
- Fixing INDEX status drift (human housekeeping)

## Files to create

| Path                                                                                     | Responsibility                                                                                       |
| ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `apps/api/src/openapi/create-openapi-document.ts`                                        | Shared `DocumentBuilder` + `createDocument` factory (title, version, security schemes, extra models) |
| `apps/api/src/openapi/openapi-contract.spec.ts`                                          | Drift unit test (AD-6)                                                                               |
| `apps/api/src/dto/common/error-envelope.dto.ts` (or `apps/api/src/openapi/schemas/*.ts`) | Typed `{ success: false, error: { code, message, details } }` + success wrappers                     |
| `apps/api/src/dto/auth/*-response.dto.ts` (as needed)                                    | Typed success bodies for register/login/refresh/me/logout aligned with use-case returns              |
| `libs/infrastructure/src/health/health-response.dto.ts` (optional)                       | Typed health result schema for Swagger                                                               |

## Files to modify

| Path                                                             | Responsibility                                                               |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `package.json` / `package-lock.json`                             | Add `@nestjs/swagger` ^11                                                    |
| `apps/api/src/main.ts`                                           | Conditional Swagger setup + startup log                                      |
| `apps/api/src/controllers/auth.controller.ts`                    | `@ApiTags`, `@ApiOperation`, `@ApiBody`, `@ApiResponse`, security decorators |
| `apps/api/src/dto/auth/*.ts`                                     | `@ApiProperty` / `@ApiPropertyOptional` on request DTOs                      |
| `libs/infrastructure/src/health/health.controller.ts`            | Swagger operation/response decorators                                        |
| `libs/infrastructure/src/config/env.schema.ts`                   | `API_DOCS_ENABLED`                                                           |
| `libs/infrastructure/src/config/infrastructure-config.module.ts` | Map into `app.apiDocsEnabled`                                                |
| `libs/infrastructure/src/config/app-config.service.ts`           | Extend `app` type                                                            |
| `libs/infrastructure/src/config/env.schema.spec.ts`              | Default ON/OFF and production override cases                                 |
| `.env.example`                                                   | Document `API_DOCS_ENABLED` with comment                                     |
| `README.md`                                                      | Docs section + sync references                                               |
| `EXAMPLES.md`                                                    | §1 checklist + pointer to canonical OpenAPI                                  |
| Workflow artifacts listed in AD-7                                | FR-11/FR-12 enforcement                                                      |

## Files to delete

None.

## Domain changes

None. No Domain imports of Swagger.

## Application changes

None. Use cases unchanged; documentation mirrors existing return shapes.

## Contract and DI changes

None for auth/health ports/tokens. No new TOKENS.

Config shape only: `app.apiDocsEnabled: boolean` (infrastructure config, not contracts lib).

## Infrastructure changes

- Env schema + mapping + `AppConfigService` for docs flag
- Optional Swagger decorators / health response DTO on Health controller
- No Worker/Cron/Migrations module imports of OpenAPI bootstrap

## Interface and entrypoint changes

- **API only:** `main.ts` + Auth controller/DTOs + openapi helper/test
- Worker / Cron / Migrations: no composition changes

## Database and migration changes

None.

## Security and authorization changes

- Document Bearer + session cookie schemes; no change to `AuthGuard` or cookie options
- Production default hides interactive docs
- Examples use fictitious tokens/emails only
- Error docs must not promise stack traces (match `GlobalExceptionFilter`)

## Observability changes

- When enabled: log info with `/docs` and `/docs-json` (and host/port already known from config) — no secrets
- When disabled: single info/debug that docs are disabled
- Health probes unchanged regardless of docs flag

## Implementation phases

### Phase 1 — Dependency and configuration

- Install `@nestjs/swagger@^11` (compatible with `@nestjs/common`/`core` ^11.1.26)
- Add `API_DOCS_ENABLED` to `env.schema.ts` with AD-3 defaults
- Wire `app.apiDocsEnabled` through config module + `AppConfigService`
- Update `.env.example` and `env.schema.spec.ts`
- **AC:** AC-01 (config default), AC-09 (build later), AC-10 (no business change)
- **Verify:** `npm run test:unit -- libs/infrastructure/src/config/env.schema.spec.ts` (or full unit after later phases)

### Phase 2 — Shared OpenAPI factory and schema types

- Create `create-openapi-document.ts` with DocumentBuilder metadata, `bearerAuth`, `sessionCookie`, extraModels
- Add typed error envelope + Auth/Health response schema classes with `@ApiProperty`
- Annotate request DTOs with `@ApiProperty` / `@ApiPropertyOptional`
- **AC:** AC-05, AC-04 (schemes present)
- **Verify:** Typecheck via `npm run build:api` after Phase 3 wiring

### Phase 3 — Controller annotations (Auth + Health)

- Decorate `AuthController` and `HealthController` for all 8 routes: summary, body, responses (2xx + representative 4xx/5xx with error envelope), security where applicable
- Encode JWT vs session differences per AD-4 in descriptions/examples (no runtime forks)
- **AC:** AC-02, AC-03, AC-04, AC-05, AC-10
- **Verify:** static review of decorators vs controllers/DTOs/filter; drift test in Phase 5

### Phase 4 — API bootstrap gate

- In `apps/api/src/main.ts`, after Nest app creation and pipes: if `config.app().apiDocsEnabled`, create document via shared factory and `SwaggerModule.setup('docs', app, document)`; else skip
- Log enabled URLs or disabled state
- Confirm worker/cron/migrations entrypoints untouched
- **AC:** AC-01, AC-09, NFR-02/03/05
- **Verify:** local `npm run start:dev:api` with docs on/off; curl `/docs` and `/docs-json`; with `NODE_ENV=production` and unset flag, routes absent

### Phase 5 — Automated OpenAPI drift test

- Implement `openapi-contract.spec.ts` per AD-6 using shared factory
- Assert 8 routes, key schemas, security schemes
- **AC:** AC-08, AC-02 (partial automation)
- **Verify:** `npm run test:unit -- apps/api/src/openapi/openapi-contract.spec.ts`

### Phase 6 — User documentation sync

- README: canonical OpenAPI section (URLs, `API_DOCS_ENABLED`, production default, “do not duplicate conflicting contracts”)
- EXAMPLES §1: mandatory OpenAPI update steps + link to `/docs`
- Align any contradictory curl-only claims to “see OpenAPI”
- **AC:** AC-06, AC-09 (docs-only)
- **Verify:** manual doc review against AD-2/AD-3

### Phase 7 — Workflow enforcement (FR-11 / FR-12)

- Update every artifact in AD-7
- Keep wording consistent: specification must include API-contract FR/AC; plan must list OpenAPI files; implementation must update OpenAPI; verification must check OpenAPI + drift test
- **AC:** AC-07
- **Verify:** diff inspection of all listed workflow files

### Phase 8 — Full verification gate

- Run commands in Full verification
- Confirm no business path/auth/validation changes in diff
- **AC:** AC-09, AC-10, and re-check AC-01–AC-08

## Dependency and compatibility impact

| Dependency        | Action                                                                                                           |
| ----------------- | ---------------------------------------------------------------------------------------------------------------- |
| `@nestjs/swagger` | Add `^11` (11.x line; e.g. current 11.4.x)                                                                       |
| Peers             | Already satisfied (`@nestjs/common`, `@nestjs/core`, `reflect-metadata`, `class-validator`, `class-transformer`) |
| `@fastify/static` | Not required (Express platform)                                                                                  |
| Lockfile          | Update only as consequence of this dependency                                                                    |

Backward compatible: existing Auth/Health contracts unchanged; new routes only under `/docs*`.

## Targeted verification

```bash
npm run build:api
npm run test:unit -- apps/api/src/openapi/openapi-contract.spec.ts
npm run test:unit -- libs/infrastructure/src/config/env.schema.spec.ts
npm run lint
```

Manual (local, safe env):

1. `API_DOCS_ENABLED=true` (or development default) → `npm run start:dev:api` → open `/docs`, fetch `/docs-json`
2. `API_DOCS_ENABLED=false` → docs routes not registered
3. Confirm Worker/Cron/Migrations builds do not reference Swagger setup

## Full verification

```bash
npm run build:api
npm run lint
npm run test:all
```

Optional smoke: `npm run build` (all entrypoints) to prove no accidental Swagger coupling in worker/cron/migrations compile graph beyond shared health decorator imports.

API bootstrap with docs enabled in local non-production env; confirm health probes still work with docs off.

## Acceptance criteria mapping

| AC        | Phase(s) | Verification                                                                                                        |
| --------- | -------- | ------------------------------------------------------------------------------------------------------------------- |
| **AC-01** | 1, 4     | Env default OFF in production; ON in non-prod; bootstrap gates `SwaggerModule.setup`; manual start with flag on/off |
| **AC-02** | 3, 5     | Drift test asserts 8 paths/methods; inspect `/docs-json`                                                            |
| **AC-03** | 3        | Review decorators vs DTOs/controllers; `/docs` UI; drift test schemas                                               |
| **AC-04** | 3, AD-4  | Inspect security schemes + Auth operation docs for JWT/session/refresh/logout                                       |
| **AC-05** | 2, 3     | Typed schema classes + `$ref` reuse; compare to use-case returns + filter                                           |
| **AC-06** | 6        | Diff `README.md`, `EXAMPLES.md` §1                                                                                  |
| **AC-07** | 7        | Diff all AD-7 workflow artifacts                                                                                    |
| **AC-08** | 5        | Unit drift test fails when path/schema removed (intentional temporary break in review, then restore)                |
| **AC-09** | 4, 8     | `build:api`, `lint`, `test:all`; confirm non-API entrypoints unchanged for Swagger setup                            |
| **AC-10** | all      | `git diff` shows no Auth/Health behavior changes beyond decorators/docs/config                                      |

## Rollout strategy

1. Merge dependency + gated docs (default safe in production)
2. Enable automatically in development/test; operators opt in for production via `API_DOCS_ENABLED=true` only if intentionally exposing internal docs
3. No migrations; no client breaking changes
4. After merge, human may set INDEX status for TASK-001 to match approved specification

## Rollback strategy

1. Immediate: set `API_DOCS_ENABLED=false` (or rely on production default) — docs routes disappear; business API unchanged
2. Full revert: revert commit(s) removing `@nestjs/swagger`, annotations, config key, workflow text, and drift test

## Risks

| Risk                                                                                  | Mitigation                                                                                      |
| ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Swagger decorators on Health pull `@nestjs/swagger` into infrastructure compile graph | Acceptable under NFR-06; keep bootstrap-only in API `main.ts`; verify worker/cron still build   |
| Dual-driver docs confuse clients                                                      | Explicit operation descriptions + examples; single document (AD-4)                              |
| Drift test too coupled to Nest TestingModule                                          | Share factory with `main.ts`; stub controllers’ deps like existing module specs                 |
| Over-documenting errors that vary by case                                             | Document shared envelope + representative status codes per route, not every domain code variant |
| INDEX status drift confuses agents                                                    | Note in plan; human updates INDEX; implementer trusts specification frontmatter                 |

## Open questions requiring human decision

Specification left these to the plan. **Proposed defaults above; human approval of this plan accepts them unless overridden:**

1. **URLs:** `/docs` + `/docs-json` (AD-2) — approve or specify alternatives?
2. **Flag:** `API_DOCS_ENABLED` with non-prod default ON / production default OFF (AD-3) — approve or prefer always-explicit flag with default always OFF?
3. **JWT/session docs:** single OpenAPI document with dual schemes + descriptive examples (AD-4) — approve or require two generated documents?
4. **Drift test:** unit suite `openapi-contract.spec.ts` asserting paths + key schemas + security (AD-6) — approve or prefer module suite / `test:release` script instead?
5. **Workflow list:** AD-7 artifact set (rule + AGENTS + TEMPLATE + README tasks + 4 skills + 4 commands + EXAMPLES + README) — approve or add/remove items (e.g. separate `60-api-contract-docs.mdc`)?

No other blocking questions. INDEX status drift is housekeeping, not a blocker for implementation after plan approval.
