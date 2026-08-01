---
task_id: TASK-001
task_type: technical
status: approved
owner: human-approval-required
---

# TASK-001 — API security headers (Helmet) and logout rate limit

## Original request

Add conditional Helmet / security headers for the API entrypoint, and apply rate-limiting to the logout endpoint (same class of abuse protection already used on login/refresh/forgot/reset).

## Problem or opportunity

`apps/api/src/main.ts` enables cookie parsing, CORS with credentials, and `trust proxy`, but does not apply standard HTTP security headers (Helmet or an equivalent explicit set). `POST /v1/auth/logout` is also missing `@UseGuards(RateLimiterGuard)` while sibling auth mutations already use it. Both gaps weaken production readiness of the portable starter without changing business auth semantics.

## Goal

1. Apply configurable security headers on the API HTTP server in a portable, environment-aware way.
2. Rate-limit logout consistently with other auth mutation endpoints.

## Users and actors

- API operators deploying the starter.
- Browser and non-browser clients calling auth endpoints.
- Agents implementing further API hardening.

## Current system context

- Bootstrap: `apps/api/src/main.ts` (`NestExpressApplication`).
- Auth controller: `apps/api/src/controllers/auth.controller.ts` — `logout` lacks rate limiter; login/refresh/forgot/reset already use `RateLimiterGuard`.
- Rate limiting: `RateLimiterModule` + `RateLimiterGuard` composed in `ApiModule`.
- Config: typed `AppConfigService` / env schema under `libs/infrastructure/src/config/`.
- No `helmet` dependency in root `package.json` today.
- Review evidence: `docs/agent-reports/full-review-2026-07-28.md`.

## Functional requirements

- **FR-01:** API bootstrap MUST apply HTTP security headers via Helmet (preferred) or an equivalent explicit middleware set covering at least: `X-Content-Type-Options`, `X-Frame-Options` / `frameguard`, `Referrer-Policy`, and disabling/`X-Powered-By` hiding as applicable.
- **FR-02:** Security-header middleware MUST be configurable (enable/disable and/or profile) through the existing typed config / env pattern — not hardcoded only for `production`.
- **FR-03:** Defaults MUST be safe for local development (headers on by default is acceptable if they do not break Swagger/OpenAPI UI; if a header breaks docs UI, document and gate that header).
- **FR-04:** `POST /v1/auth/logout` MUST use `RateLimiterGuard` with a key/policy consistent with other auth mutations on the same controller (reuse existing decorator/guard pattern; do not invent a second rate-limit stack).
- **FR-05:** OpenAPI for logout MUST continue to document auth/cookie behavior; if rate-limit responses (`429`) are already documented on sibling routes, logout MUST align.

## Non-functional requirements

- **NFR-01:** No secrets in header config.
- **NFR-02:** Portable: consumers can disable or tune headers without editing Helmet internals.
- **NFR-03:** Minimal dependency churn; if adding `helmet`, pin a version compatible with Express 5 / Nest 11 used by the repo and update `package-lock.json` only as required.
- **NFR-04:** Do not break CORS credentialed flows or session cookies.

## Public API and interface impact

### HTTP API contract

- Methods and paths: no new routes. Changed behavior on all API responses (security headers) and `POST /v1/auth/logout` (rate limit / possible `429`).
- Request/response bodies: unchanged for successful logout.
- Error status codes: logout may return the same rate-limit error envelope as other guarded auth routes.
- Authentication: logout auth/cookie semantics unchanged.
- Significant headers: new security response headers on API responses when enabled.
- OpenAPI schemas/decorators to add or update: align logout operation docs with rate-limit/`429` if siblings document them; no fabricated new success schema.
- Acceptance criterion: generated OpenAPI still passes the repository OpenAPI drift test; documented logout errors match runtime.

## Data model and migration impact

None.

## Events, queues and background processing

None.

## Security and authorization

- Headers are defense-in-depth for browsers; they must not replace authn/authz.
- Rate-limiting logout reduces abuse (session thrash / lock churn) keyed consistently with existing IP-based guard behavior and `trust proxy`.

## Entrypoints and deployment impact

- **API only** for Helmet/headers and logout guard.
- Worker / Cron / Migrations: out of scope.
- `.env.example` and config schema updated if new env knobs are introduced.

## Observability and operations

- No required new metrics. Optional debug log when security headers middleware is enabled is acceptable but not required.

## Compatibility requirements

- Backward compatible for API clients: adding headers and `429` on abusive logout is allowed.
- Do not change cookie names, paths, or auth driver behavior.

## Dependencies

- Existing `RateLimiterGuard` / `RateLimiterModule`.
- Optional new runtime dependency: `helmet` (or confirm explicit `res.setHeader` approach in plan if human rejects Helmet).

## Assumptions

- “Conditional Helmet” means environment/config-gated enablement and sensible defaults, not per-route Helmet.
- Logout rate-limit policy can mirror login/refresh unless planning chooses a dedicated limiter key prefix already supported by the module.

## Out of scope

- CSP policy authoring for a frontend app (beyond what Helmet defaults / documented knobs provide).
- HSTS preload submission / certificate management.
- Changing global rate-limit architecture.
- Worker/Cron HTTP (none).
- Fixing P1 auth/idempotency defects (separate backlog issues).

## Acceptance criteria

- **AC-01:** With security headers enabled, a successful API response includes the agreed security headers (verified via bootstrap or integration/supertest-style check if the repo pattern allows; otherwise a focused unit/module test around the middleware wiring).
- **AC-02:** Security headers can be disabled via config/env without code edits.
- **AC-03:** `POST /v1/auth/logout` is decorated/guarded with `RateLimiterGuard` like sibling auth mutations.
- **AC-04:** OpenAPI drift test still passes; logout docs mention rate limiting/`429` if that is the project convention for guarded auth routes.
- **AC-05:** `npm run build:api`, `npm run lint`, and relevant unit tests pass.
- **AC-06:** `.env.example` (and schema) document any new variables.

## Verification strategy

- Static inspection of `main.ts`, auth controller, config schema.
- `npm run build:api`, `npm run lint`, targeted unit tests.
- OpenAPI drift test if OpenAPI touched.
- Manual or automated header assertion when infrastructure allows.

## Rollout and rollback

- Rollout: deploy API with defaults; operators may disable headers via env if a proxy already injects them.
- Rollback: revert config default to disabled or remove middleware registration.

## Open questions requiring human decision

1. Prefer `helmet` package vs explicit hand-rolled header middleware?
2. Default `SECURITY_HEADERS_ENABLED` (or equivalent) to `true` in all envs, or only `production`?
3. Should logout share the exact same rate-limit bucket/key prefix as login, or a dedicated `logout` prefix?
