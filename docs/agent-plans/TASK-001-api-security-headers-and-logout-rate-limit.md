---
task_id: TASK-001
specification: docs/agent-tasks/TASK-001-api-security-headers-and-logout-rate-limit.md
status: approved
owner: human-approval-required
---

# TASK-001 — Implementation plan

## Approved specification

- Task index: `docs/agent-tasks/INDEX.md` — **TASK-001** (technical / approved)
- Specification: `docs/agent-tasks/TASK-001-api-security-headers-and-logout-rate-limit.md`
- Review evidence cited by the spec: `docs/agent-reports/full-review-2026-07-28.md` (Helmet gap in `main.ts`; logout missing `RateLimiterGuard`)

**Re-validation (this planning pass):** both gaps still present on the current branch.

- `apps/api/src/main.ts` — cookie parser, CORS with credentials, `trust proxy`; **no** Helmet / security-header middleware.
- `apps/api/src/controllers/auth.controller.ts` — `login` / `refresh` / `forgot-password` / `reset-password` (and others) use `@UseGuards(RateLimiterGuard)` + `@RateLimit`; **`logout` does not**.
- Root `package.json` has **no** `helmet` dependency; Express arrives transitively via `@nestjs/platform-express` as **Express 5.2.1**.

## Current implementation

### API bootstrap

`apps/api/src/main.ts` creates `NestExpressApplication`, sets `trust proxy`, applies `cookieParser()`, global validation pipe, `v1` prefix, optional Swagger via `config.app().apiDocsEnabled`, then CORS with credentials, then `listen`.

### Auth logout vs siblings

`POST auth/logout` documents cookie/Bearer semantics and success/error envelopes but omits:

- `@UseGuards(RateLimiterGuard)`
- `@RateLimit({ … })`
- `@ApiTooManyRequestsResponse` (present on login, refresh, forgot, reset, me, change-password)

Sibling auth mutations use dedicated Redis key prefixes (`auth:login`, `auth:refresh`, …). Guard defaults for any `auth:*` prefix fall back to `RATE_LIMIT_AUTH_MAX` / `RATE_LIMIT_AUTH_TTL` when `limit` / `ttlSeconds` are omitted (`RateLimiterGuard`).

### Config pattern to reuse

Typed env via Zod in `libs/infrastructure/src/config/env.schema.ts`, mapped in `infrastructure-config.module.ts`, exposed by `AppConfigService`. Closest analogue: `API_DOCS_ENABLED` (`optionalBoolean` + transform default). Boolean coercion helpers already exist (`coerceBoolean` / `optionalBoolean`).

### OpenAPI / drift

- Decorators live on `AuthController`.
- Drift / contract test: `apps/api/src/openapi/openapi-contract.spec.ts` (lists logout route; does **not** currently assert `429` on any auth route).
- Document factory: `apps/api/src/openapi/create-openapi-document.ts` — no change expected beyond regenerated operation metadata from controller decorators.

### Tests / docs touchpoints

- Config unit tests: `libs/infrastructure/src/config/env.schema.spec.ts` (pattern for `API_DOCS_ENABLED`).
- No `main.ts` bootstrap unit test today (Redis assert blocks full bootstrap in unit gate).
- `.env.example` documents `API_DOCS_ENABLED` and rate-limit knobs near the top / rate-limit section.
- `EXAMPLES.md` §6 shows rate-limit decorator pattern; logout curl examples do not mention rate limiting.
- `README.md` §21 environment-variables sample should list any new knob.

## Architecture decision

1. **Security headers via `helmet` (recommended).** Add runtime dependency `helmet` (latest **8.x**, compatible with Express 5 / Nest 11 used here). Wire it only in the **API entrypoint** through a small pure helper so headers are testable without Redis bootstrap. Do **not** introduce a second header stack or Worker/Cron middleware.

2. **Config-gated enablement.** Introduce `SECURITY_HEADERS_ENABLED` following the existing boolean env pattern, mapped onto `AppConfigService.app()` (e.g. `securityHeadersEnabled: boolean`). Middleware registration in `main.ts` is conditional on this flag — not on hard-coded `NODE_ENV === 'production'`.

3. **Swagger-safe Helmet profile (documented, not a second product CSP).** Default Helmet CSP / aggressive cross-origin embedder policies commonly break Swagger UI. Configure Helmet so the **FR-01 minimum** is always applied when enabled:

   - `X-Content-Type-Options` (nosniff)
   - `X-Frame-Options` / frameguard
   - `Referrer-Policy`
   - hide / disable `X-Powered-By`

   Explicitly set `contentSecurityPolicy: false` (CSP authoring is **out of scope** per the specification). Also disable Helmet defaults that risk breaking credentialed CORS + docs UI unless proven safe (at minimum `crossOriginEmbedderPolicy: false`; adjust `crossOriginResourcePolicy` only if needed to keep NFR-04). Document the gated headers in `.env.example` / a short code comment.

4. **Default `SECURITY_HEADERS_ENABLED=true` in all environments (recommended).** Matches FR-03 (“headers on by default is acceptable”). Operators whose proxy already injects headers set `SECURITY_HEADERS_ENABLED=false` without code edits (AC-02 / rollout).

5. **Logout rate limit with dedicated prefix `auth:logout` (recommended).** Reuse `RateLimiterGuard` + `@RateLimit` only — no new limiter stack. Omit explicit `limit` / `ttlSeconds` so logout uses the same `RATE_LIMIT_AUTH_*` defaults as login. Dedicated prefix avoids sharing the login abuse bucket (session thrash vs credential stuffing).

6. **OpenAPI alignment only.** Add `@ApiTooManyRequestsResponse` on logout to match sibling convention. No new success schemas, paths, or status codes beyond documenting `429`.

## Scope

- Add `helmet` dependency + lockfile update as required.
- Env schema, config mapping, `AppConfigService` shape, `.env.example`, brief README / EXAMPLES notes for the new knob and logout rate limit.
- API helper + conditional Helmet registration in `main.ts`.
- Guard + rate-limit decorator + `429` OpenAPI decorator on logout.
- Unit tests for env default/override and for the security-headers helper (enabled vs disabled header assertions via a minimal Express/Nest test app or middleware invocation).
- OpenAPI drift test still green; optional explicit assert that logout documents `429`.

## Out of scope

- CSP policy authoring for a frontend app beyond disabling Helmet CSP / documenting that gate.
- HSTS preload / certificate management (Helmet may set HSTS on HTTPS; no preload submission).
- Global rate-limit architecture changes; Worker / Cron / Migrations HTTP (none).
- Changing cookie names, paths, auth drivers, or logout business semantics.
- Fixing unrelated P1 auth / idempotency backlog issues.
- Inventing multi-profile Helmet “modes” beyond enable/disable + the fixed Swagger-safe options object (FR-02 is satisfied by enable/disable).

## Files to create

| Path | Responsibility |
| --- | --- |
| `apps/api/src/security/apply-api-security-headers.ts` | Export `applyApiSecurityHeaders(app, { enabled })` — when enabled, `app.disable('x-powered-by')` (or rely on Helmet) and `app.use(helmet({ …swaggerSafeOptions }))`; when disabled, no-op. |
| `apps/api/src/security/apply-api-security-headers.spec.ts` | Unit test: enabled → expect FR-01 headers on a response; disabled → those headers absent / middleware not applied. Prefer lightweight NestExpress or raw Express listen via existing Jest/supertest patterns **without** Redis. |

## Files to modify

| Path | Change |
| --- | --- |
| `package.json` / `package-lock.json` | Add `helmet` (^8.x). Lockfile only as required by install. |
| `libs/infrastructure/src/config/env.schema.ts` | Add `SECURITY_HEADERS_ENABLED: optionalBoolean`; transform default `true` when unset. |
| `libs/infrastructure/src/config/env.schema.spec.ts` | Cases: default true (dev/test/production), explicit true/false/`0`/`1`, reject invalid. |
| `libs/infrastructure/src/config/infrastructure-config.module.ts` | Map `securityHeadersEnabled: e.SECURITY_HEADERS_ENABLED` under `app`. |
| `libs/infrastructure/src/config/app-config.service.ts` | Extend `ConfigShape['app']` with `securityHeadersEnabled: boolean`. |
| `apps/api/src/main.ts` | After app create / logger (and before or after cookie parser — prefer **early**, before routes), call `applyApiSecurityHeaders(application, { enabled: config.app().securityHeadersEnabled })`. Optional one-line info log when enabled (allowed by spec, not required). |
| `apps/api/src/controllers/auth.controller.ts` | On `logout`: `@UseGuards(RateLimiterGuard)`, `@RateLimit({ keyPrefix: 'auth:logout' })`, `@ApiTooManyRequestsResponse({ description: 'Logout rate limit exceeded.', type: ErrorEnvelopeDto })`. |
| `apps/api/src/openapi/openapi-contract.spec.ts` | Assert `document.paths['/v1/auth/logout']?.post?.responses?.['429']` is defined (aligns AC-04 with sibling convention). |
| `.env.example` | Document `SECURITY_HEADERS_ENABLED` (default true; note CSP disabled for Swagger; set false if edge already sets headers). |
| `README.md` | Add `SECURITY_HEADERS_ENABLED` to §21 env sample / short API bootstrap note if one exists near docs/CORS. |
| `EXAMPLES.md` | Optional one-line under §6 or logout curl section: logout is rate-limited like other auth mutations (`auth:logout`). Keep minimal. |

## Files to delete

None.

## Domain changes

None.

## Application changes

None.

## Contract and DI changes

None. Reuse existing `RateLimiterGuard`, `RateLimit` decorator, and `RateLimiterModule` already composed in `ApiModule`. No new tokens.

## Infrastructure changes

Config-only:

- `env.schema.ts` / mapping / `AppConfigService` / `.env.example` as above.
- No Redis, Drizzle, Outbox, or rate-limiter module internals changes.

## Interface and entrypoint changes

- **API only:** `main.ts` + security helper; `AuthController.logout` guards/OpenAPI.
- Worker / Cron / Migrations: untouched.

## Database and migration changes

None.

## Security and authorization changes

- Defense-in-depth response headers when enabled; does not replace authn/authz.
- Logout abuse protection via existing IP-keyed Redis limiter (`auth:logout:${req.ip}`) with `trust proxy` already set.
- Cookie / CORS credential behavior unchanged (Helmet options chosen to avoid breaking credentialed cross-origin clients and Swagger).

## Observability changes

None required. Optional startup `logger.info` when security headers are enabled/disabled is acceptable.

## Implementation phases

### Phase 1 — Config knob

- **Paths:** `env.schema.ts`, `env.schema.spec.ts`, `infrastructure-config.module.ts`, `app-config.service.ts`, `.env.example`
- **Symbols:** `SECURITY_HEADERS_ENABLED`, `app.securityHeadersEnabled`
- **ACs:** AC-02, AC-06
- **Verify:** `npm run test:unit -- --testPathPattern="env.schema.spec"`

### Phase 2 — Helmet dependency + API helper

- **Paths:** `package.json`, `package-lock.json`, `apps/api/src/security/apply-api-security-headers.ts`, `*.spec.ts`
- **Symbols:** `applyApiSecurityHeaders`, Helmet options object (CSP off; FR-01 headers on)
- **ACs:** AC-01, AC-02, NFR-03
- **Verify:** unit spec for helper; `npm install` / lockfile intentional

### Phase 3 — Wire bootstrap

- **Paths:** `apps/api/src/main.ts`
- **Symbols:** call site using `AppConfigService.app().securityHeadersEnabled`
- **ACs:** AC-01, AC-02
- **Verify:** static inspection; optional manual curl against `GET /health` when API is running

### Phase 4 — Logout rate limit + OpenAPI

- **Paths:** `auth.controller.ts`, `openapi-contract.spec.ts`, light `EXAMPLES.md` / `README.md` notes
- **Symbols:** `@UseGuards(RateLimiterGuard)`, `@RateLimit({ keyPrefix: 'auth:logout' })`, `@ApiTooManyRequestsResponse`
- **ACs:** AC-03, AC-04
- **Verify:** `npm run test:unit -- --testPathPattern="openapi-contract"`

### Phase 5 — Full gates

- **ACs:** AC-05
- **Verify:** commands in Full verification below

## Dependency and compatibility impact

- **New dependency:** `helmet` ^8.x (TypeScript types bundled; no `@types/helmet` expected).
- **Lockfile:** update only for this dependency.
- **Clients:** additive response headers; logout may return same `429` envelope as other guarded auth routes under abuse.
- **Backward compatible** per specification; no cookie / auth-driver changes.

## Targeted verification

```bash
npm run test:unit -- --testPathPattern="env.schema.spec"
npm run test:unit -- --testPathPattern="apply-api-security-headers"
npm run test:unit -- --testPathPattern="openapi-contract"
npm run build:api
npm run lint
```

Manual (when PostgreSQL/Redis allow API bootstrap):

```bash
# SECURITY_HEADERS_ENABLED=true (default)
curl -sI http://localhost:3000/health
# Expect: X-Content-Type-Options, X-Frame-Options (or frame-ancestors equivalent), Referrer-Policy; no X-Powered-By

# SECURITY_HEADERS_ENABLED=false
curl -sI http://localhost:3000/health
# Expect: FR-01 headers not injected by the app
```

## Full verification

```bash
npm run build:api
npm run lint
npm run test:unit
```

OpenAPI drift is covered by the unit-gated `openapi-contract.spec.ts` (no separate script). Bootstrap smoke is optional and infrastructure-dependent — separate missing Redis/Postgres from code failure.

## Acceptance criteria mapping

| AC | Phase | Verification |
| --- | --- | --- |
| **AC-01** Headers present when enabled | 2–3 | `apply-api-security-headers.spec.ts`; optional curl `/health` |
| **AC-02** Disable via config/env | 1–3 | env schema tests + helper disabled path + `.env.example` |
| **AC-03** Logout uses `RateLimiterGuard` | 4 | Static inspection of `auth.controller.ts` |
| **AC-04** OpenAPI drift + logout `429` docs | 4 | `openapi-contract.spec.ts` (assert logout `429`) |
| **AC-05** build:api, lint, unit tests | 5 | commands above |
| **AC-06** `.env.example` + schema document knob | 1 | file inspection + schema tests |

## Rollout strategy

1. Deploy API with default `SECURITY_HEADERS_ENABLED=true` and logout rate limit.
2. If an edge proxy already sets conflicting headers, set `SECURITY_HEADERS_ENABLED=false`.
3. No migration or dual-write steps.

## Rollback strategy

1. Set `SECURITY_HEADERS_ENABLED=false` (immediate, no redeploy of alternative code if already shipping the flag), **or**
2. Revert the TASK-001 commit(s) removing Helmet registration and logout guards.

## Risks

| Risk | Mitigation |
| --- | --- |
| Helmet defaults break Swagger UI | CSP (and COEP) disabled by design; document in `.env.example` |
| Helmet CORP/COOP affects credentialed SPA clients | Prefer conservative options; verify CORS login/cookie flow if API is bootstrapped |
| Unit test cannot boot full `main.ts` (Redis) | Test helper in isolation; treat full bootstrap as optional |
| Human rejects Helmet in favor of hand-rolled headers | See open questions — implementer must not silently switch without plan revision |

## Open questions requiring human decision

These match the approved specification. Recommendations below are **planner proposals**; human plan approval should confirm or override them before implementation.

1. **Helmet package vs hand-rolled middleware?**  
   **Recommendation:** add `helmet` ^8.x (FR-01 preferred path / NFR-03 acceptable churn).

2. **Default `SECURITY_HEADERS_ENABLED`?**  
   **Recommendation:** default **`true` in all envs** (including production); operators opt out via env.

3. **Logout rate-limit key prefix?**  
   **Recommendation:** dedicated **`auth:logout`** with default `RATE_LIMIT_AUTH_*` limits (not shared with `auth:login`).

If any recommendation is rejected, revise this plan before implementation (do not invent an alternate approach silently).
