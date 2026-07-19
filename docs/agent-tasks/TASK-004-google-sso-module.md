---
task_id: TASK-004
task_type: feature
status: approved
owner: human-approval-required
---

# TASK-004 — Optional Google SSO auth module

## Original request

Третє що я хочу, це модуль для роботи з Google SSO ( Авторизація через гугл ), щоб я міг її спокійно та без проблем підключити.

## Human decisions (2026-07-19)

1. **Account linking (OQ-02):** **Auto-link** when Google email matches an existing local user (require Google email to be verified before linking).
2. **Reference implementation:** `E:\Projects\levych-api` Google SSO may be used as a **non-normative example** of authorization-code redirect + social login by email. It is **not** the quality bar — anything weak there must be improved in this starter (see “Improvements over levych-api” below).

### Improvements over levych-api (required design intent)

| levych-api pattern                                   | Starter improvement                                                                                                                                                                  |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `process.env` inside `GoogleStrategy`                | Typed module options / `AppConfigService` at composition root only                                                                                                                   |
| Match user **only by email**; no Google `sub` column | Persist durable Google subject (`sub`) + unique constraint; resolve by `sub` first, then email-link policy                                                                           |
| Popup HTML + `window.opener.postMessage(..., '*')`   | Do **not** copy wildcard `postMessage` or inline HTML popup as the primary UX; prefer documented redirect-to-allowlisted-frontend or JSON callback (see open questions for final UX) |
| Fat `AuthService.socialLogin` in one layer           | Domain → Application use case → Contracts port → Infrastructure Google adapter → thin API controller                                                                                 |
| Passport always registered                           | Optional/off by default; credentials required only when enabled                                                                                                                      |
| No verified-email gate before link                   | Link only when Google asserts verified email                                                                                                                                         |
| Password-less users poorly modeled                   | Nullable `password_hash` (recommended) + password login rejects null hashes                                                                                                          |
| OpenAPI incomplete for OAuth redirects               | Full OpenAPI for start/callback (and any token endpoint if approved)                                                                                                                 |

## Problem or opportunity

The starter kit today supports only email/password authentication under `/auth/*`, with `AUTH_DRIVER=jwt|session`. There is no Google Sign-In / OAuth 2.0 / OIDC integration. Consumers of this reusable foundation need an optional, portable Google SSO module they can enable via configuration without rewriting auth layering, composition, or session/JWT issuance.

## Goal

Deliver an optional Google SSO capability that:

1. follows existing Domain → Application → Contracts → Infrastructure → API composition boundaries;
2. is disabled by default and easy to enable when Google credentials are configured (same optional-driver spirit as `MAIL_DRIVER` / `STORAGE_DRIVER`);
3. after a successful Google identity proof, issues the same auth artifacts as `POST /auth/login` for the active `AUTH_DRIVER`;
4. documents and ships OpenAPI for every added HTTP endpoint;
5. can be connected by a starter consumer without inventing ad-hoc OAuth plumbing.

Account-linking policy is **decided** (auto-link on verified email match). Primary OAuth flow is **Candidate A (authorization-code redirect)**, aligned with levych’s shape but with the improvements above. Remaining open questions cover callback UX details and a few secondary policies.

## Users and actors

- **Starter-kit consumer / integrator** — enables Google SSO via env/module registration for their product.
- **End user** — signs in (or links) with a Google account.
- **API process** — validates Google identity, creates/links local users, issues JWT or session credentials.
- **Google Identity Platform** — external OAuth 2.0 / OIDC IdP (authorization server and token/userinfo endpoints).

## Current system context

Inspected behavior (code is source of truth):

- **Auth composition:** `apps/api/src/composition/auth-application.module.ts` wires `RegisterUseCase`, `LoginUseCase`, `LogoutUseCase`, `RefreshAuthSessionUseCase`, `GetCurrentUserUseCase`, `SessionCookieService`, and `AuthModule.forRootAsync`.
- **HTTP surface:** `apps/api/src/controllers/auth.controller.ts` exposes `POST /auth/register|login|logout|refresh` and `GET /auth/me`. Login attaches a session cookie via `SessionCookieService` only when `auth.sessionId` is present (`AUTH_DRIVER=session`).
- **Auth engine:** `libs/infrastructure/src/auth/auth.module.ts` registers exactly one driver (`jwt` or `session`) against `TOKENS.AuthTokenService`. Session and JWT stores are Redis-backed.
- **User model:** `libs/domain/src/entities/user.entity.ts` and `libs/infrastructure/src/database/drizzle/schema/users.schema.ts` require non-null `passwordHash`; there is no Google subject / provider identity column; repository lookup is by `id` or `email` only (`IUserRepository`).
- **Config toggle pattern:** `MAIL_DRIVER` / `STORAGE_DRIVER` in `libs/infrastructure/src/config/env.schema.ts` default to safe null/local drivers; provider credentials are required only when the corresponding driver is selected (`superRefine`). Modules use typed `forRoot` / `forRootAsync` options and must not read `process.env` inside adapters.
- **OpenAPI:** Auth endpoints already use typed response DTOs and `ErrorEnvelopeDto`; document assembly is in `apps/api/src/openapi/create-openapi-document.ts`.
- **Dependencies:** root `package.json` includes `passport` and `passport-jwt`, but not `@nestjs/passport` or `passport-google-oauth20`. No Google OAuth routes or adapters exist in production code.
- **Migration note (non-binding for this task):** `docs/migration/HTTP_PARITY_MATRIX.md` describes legacy `GET /v1/auth/google` and `GET /v1/auth/google/redirect` (popup `postMessage`) as future migration work (TASK-003). That legacy `/v1/auth` surface is **not** the deliverable of this starter-module task unless a human explicitly merges scopes later.

## Functional requirements

- **FR-01:** Provide a provider-neutral application use case (or small set of use cases) that, given a verified Google identity (email + stable Google subject/`sub`, and any other fields approved in planning), finds or creates a local user and creates an auth session through existing `IAuthTokenService.createAuthSession` so JWT and session drivers both work without a third auth driver.
- **FR-02:** Provide a Contracts port for Google identity verification / profile retrieval that does not expose Google SDK types to Application or Domain.
- **FR-03:** Provide an Infrastructure adapter implementing that port for Google OAuth 2.0 / OIDC, registered only through typed module options (`forRoot` / `forRootAsync` or equivalent), not via direct `process.env` reads in adapters.
- **FR-04:** Make Google SSO optional and off by default. When disabled, the API must not require Google credentials to boot. When enabled, missing required Google configuration must fail fast at config validation (same spirit as SMTP/S3 required fields).
- **FR-05:** Expose HTTP endpoints under `/auth/google…` for **Candidate A** (authorization-code redirect): at minimum `GET /auth/google` (start) and `GET /auth/google/callback` (or `/redirect` if naming must match consumer docs — planner freezes one name). Complete Google sign-in and return or establish the same client-visible auth artifacts as successful `POST /auth/login` for the active `AUTH_DRIVER`.
- **FR-06:** On first successful Google sign-in for an unknown identity, create a local user (roles default consistent with `RegisterUseCase`, currently `['user']`).
- **FR-07:** When Google identity email matches an existing local user **and** Google email is verified, **auto-link** the Google `sub` to that user and sign them in. If email is present but **not** verified, reject linking/sign-in for that path with a stable error (do not auto-link on unverified email).
- **FR-08:** Persist a durable association between the local user and the Google subject so subsequent logins resolve by provider identity, not only by email (schema/migration as needed). Lookup order: by Google `sub` first; if missing, apply email auto-link policy then store `sub`.
- **FR-09:** Support Google-only users with **nullable `password_hash`**; `POST /auth/login` MUST reject accounts with null password hash (stable code). Do not store guessable placeholder passwords.
- **FR-10:** Protect redirect/callback flows with CSRF defenses appropriate to the chosen flow (OAuth `state` at minimum for authorization-code redirect; document nonce/`aud`/`iss` checks for ID-token verification).
- **FR-11:** Rate-limit Google SSO HTTP entrypoints consistently with other auth routes (`RATE_LIMIT_AUTH_*` / `auth:*` key prefixes).
- **FR-12:** Document enablement in `.env.example`, and briefly in `EXAMPLES.md` and/or `README.md` / module overview, so a consumer can connect Google SSO without reading implementation source.
- **FR-13:** Emit domain/outbox events for newly created users on Google first login if registration today emits `UserRegisteredEvent` (keep parity with password registration side effects unless human decides otherwise).
- **FR-14:** Keep Worker and Cron free of Google SSO HTTP concerns; Google SSO is an API composition feature.

## Non-functional requirements

- **NFR-01:** Preserve dependency direction: Domain has no Nest/Google SDKs; Application depends on Contracts ports only; Infrastructure implements ports; API is composition + HTTP adapter.
- **NFR-02:** Reusable module registration must accept typed options; `AppConfigService` may map env → options at the composition root but must not be the only public configuration API (module portability rule).
- **NFR-03:** Do not register both JWT and session token service implementations when only one `AUTH_DRIVER` is selected.
- **NFR-04:** Secrets (`GOOGLE_CLIENT_SECRET`, etc.) must never appear in logs, OpenAPI examples, or error payloads.
- **NFR-05:** Changes must remain backward compatible for consumers who leave Google SSO disabled (default).
- **NFR-06:** Build, lint, and relevant unit/module tests must pass for the completed implementation; OpenAPI drift checks must cover new endpoints.

## Public API and interface impact

### HTTP API contract

**Primary flow (decided):** Candidate A — Authorization-code redirect. Candidate B (ID-token POST) is **out of scope** unless a later task adds it.

#### Candidate A — Authorization-code redirect (server-side OAuth)

| Method | Path (recommended)      | Auth   | Input                                                 | Success                                                                                                                                                                                                                                                                                                                                 | Errors                                                                                                                                                                           |
| ------ | ----------------------- | ------ | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`  | `/auth/google`          | Public | Optional query (e.g. `returnUrl` if approved)         | `302` to Google authorization endpoint; sets CSRF `state` (cookie or server store as planned)                                                                                                                                                                                                                                           | `503` when Google SSO disabled; `400` on invalid query                                                                                                                           |
| `GET`  | `/auth/google/callback` | Public | Google callback query (`code`, `state`, error params) | On success: same **auth success envelope** as login for active driver — `{ success: true, data: { user, auth } }` **or** `302` to a configured allowlisted frontend return URL per approved UX (OQ-04); session mode sets `Set-Cookie` for `AUTH_SESSION_COOKIE_NAME`. **Must not** use `postMessage` to `'*'` as the primary contract. | `400` invalid/missing `state` or code; `401`/`400` Google error / unverified email / identity rejection; `503` when disabled; shared `ErrorEnvelopeDto` for JSON error responses |

#### Shared contract rules

- **Success user payload:** `{ id, email, roles }` — same public shape as login (`AuthUserDto`); never include `passwordHash` or Google raw tokens.
- **Success auth payload:** reuse `AuthTokensDto` semantics (`accessToken`/`refreshToken` for jwt; `sessionId`/`expiresAt` metadata + httpOnly cookie for session).
- **Disabled behavior:** endpoints remain documented in OpenAPI; runtime returns `503` with stable code `GOOGLE_SSO_DISABLED` (always register routes — planning default unless OQ-05 overridden).
- **Authentication/authorization:** Google start/callback are public (unauthenticated). Authenticated “link Google while logged in” remains out of scope for MVP (OQ-07 deferred).
- **Headers/cookies:**
  - Session driver: `Set-Cookie` for configured session cookie on successful sign-in (same flags as `SessionCookieService`: httpOnly, Secure in production, SameSite/path/domain from config).
  - JWT driver: no session cookie required; tokens in JSON body unless a later approved cookie-transport task extends this.
  - Redirect flow: CSRF `state` cookie or equivalent must be documented in OpenAPI if visible to clients.
- **OpenAPI schemas/decorators to add or update:**
  - New controller (or extensions on Auth) with `@ApiTags`, `@ApiOperation`, success/error decorators mirroring `AuthController`.
  - Request DTOs for Candidate B body; query/callback documentation for Candidate A.
  - Reuse `LoginResponseDto` / `AuthUserDto` / `AuthTokensDto` / `ErrorEnvelopeDto` where shapes match; add Google-specific error codes to docs.
  - Register any new DTOs in `create-openapi-document.ts` `extraModels` if needed.
  - Update OpenAPI drift test (`apps/api/src/openapi/openapi-contract.spec.ts` or equivalent) so generated document matches runtime.

- **Acceptance criterion that verifies generated OpenAPI against runtime behavior:** **AC-08**.

### Other interfaces

- New Contracts token(s) for the Google identity port (e.g. under `TOKENS`).
- Typed Google SSO module options (client id/secret, redirect URI, enabled flag, allowed hosted domains if approved).
- Possible Domain/User factory changes and repository methods (`findByGoogleSubject`, etc.).

## Data model and migration impact

- Likely migration required to store Google subject (`sub`) and optionally provider metadata; unique constraint on provider+subject recommended.
- `password_hash` is currently `NOT NULL`. Supporting Google-only accounts uses **nullable `password_hash`** + login rejection for null hashes (decision locked for planning unless human overrides OQ-03).
- Email uniqueness already exists; **auto-link** when verified Google email matches an existing user (human decision).
- No Worker/Cron schema consumers expected for this feature beyond existing user/outbox handlers.

## Events, queues and background processing

- First-time Google user creation should append the same registration outbox event used by password registration (`UserRegisteredEvent`) unless human opts out — keeps welcome-mail / handlers consistent.
- No new BullMQ queues required for core SSO.
- Google token exchange is synchronous in the API request path; do not move IdP calls to Worker for the MVP unless planning proves a need.

## Security and authorization

- Validate OAuth `state` (redirect flow) or ID-token signature/`iss`/`aud`/`exp` (token flow).
- Use HTTPS redirect URIs in non-local environments; document localhost exceptions for development.
- Do not log authorization codes, ID tokens, access tokens, or client secrets.
- Enforce rate limits on SSO endpoints.
- Reject disabled/banned users if such statuses exist at implementation time; today the starter user model has roles only — do not invent ban semantics here.
- Account-linking must consider email-verified claims from Google; do not link on unverified email if the chosen Google response can lack verification.
- CORS / frontend return URL allowlisting if redirect-to-frontend UX is chosen (**OQ-04**).

## Entrypoints and deployment impact

- **API:** composition wiring, controller(s), OpenAPI, env validation.
- **Worker / Cron / Migrations app:** no Google HTTP; Migrations entrypoint runs any new SQL migration as a one-shot job when deployed.
- **Env:** new variables (names illustrative until plan freezes them), e.g. `GOOGLE_SSO_ENABLED`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` (and any flow-specific settings). Required only when enabled.
- Default local/dev posture: Google SSO disabled so `npm run start:api` works without Google credentials.

## Observability and operations

- Structured logs for SSO start, success, and failure with `userId` after resolution; never log secrets or raw tokens.
- Distinct error codes for disabled feature, invalid state, invalid Google token, linking conflict, and IdP errors.
- Optional health detail is out of scope unless human requests an IdP reachability check.

## Compatibility requirements

- Existing `/auth/register|login|logout|refresh|me` contracts remain unchanged.
- Consumers with Google SSO disabled see no breaking schema requirement beyond applying migrations that must remain safe when the feature is unused (nullable columns / unused tables are acceptable; destructive rewrites are not).
- Do not replace or fork `AUTH_DRIVER`; Google SSO is an identity source that feeds the existing auth session factory.
- Legacy migration routes under `/v1/auth/google*` are out of scope for this task (see Out of scope / OQ-06).

## Dependencies

- Google Cloud OAuth client (external).
- Possible new npm packages (e.g. `google-auth-library`, or `@nestjs/passport` + `passport-google-oauth20`) — choose in planning; `passport` is already present but insufficient alone.
- Existing Redis (session/JWT stores), PostgreSQL (users), and Auth module.

## Assumptions

- **A-01:** This is a new **feature** for the reusable starter, not a bugfix from `docs/agent-backlog/`.
- **A-02:** Google SSO should follow the Mail/Storage optional-driver pattern: off by default, credentials required only when enabled.
- **A-03:** Successful Google sign-in must reuse `IAuthTokenService.createAuthSession` so both `AUTH_DRIVER` values work.
- **A-04:** Public JSON success shape should align with `LoginResponseDto` / `AuthUserDto` / `AuthTokensDto` unless a human-approved redirect UX intentionally omits JSON.
- **A-05:** Starter paths live under `/auth/google…`. If TASK-002 (URI versioning) is implemented first, these routes inherit the `/v1` prefix automatically (`/v1/auth/google…`); this is the starter versioning convention, not legacy migration parity.
- **A-06:** One Google provider is enough for this task; other social IdPs are out of scope.
- **A-07:** Email from Google is treated as an Email value object (normalized) consistent with existing auth use cases.
- **A-08:** Primary flow is authorization-code redirect (Candidate A); improve on levych-api rather than cloning it.
- **A-09:** Auto-link on verified email match is approved.
- **A-10:** Nullable `password_hash` for Google-only users is the planning default.

## Out of scope

- Apple / Facebook / generic OIDC multi-provider framework.
- Full legacy `/v1/auth` parity, popup `postMessage` to `'*'`, or `POPUP_SECRET_KEY` HTML behavior from levych-api.
- Candidate B ID-token POST endpoint (separate task if needed).
- Changing password-hashing algorithms or auth drivers.
- Admin-only Google login, role elevation via Google Workspace groups (unless later approved).
- Authenticated “link Google while logged in” endpoint (OQ-07 deferred).
- Frontend SPA implementation beyond documenting how to call the API.
- Production Google Cloud console setup beyond documenting required redirect URIs and env vars.

## Acceptance criteria

- **AC-01:** With Google SSO disabled (default), API boots without Google env vars and existing email/password auth tests/behaviors still pass.
- **AC-02:** With Google SSO enabled and valid config, a successful Google identity proof creates a session via `IAuthTokenService` and returns/sets auth artifacts consistent with `POST /auth/login` for the active `AUTH_DRIVER` (verified for **both** jwt and session, at least one automated test each or one driver automated + the other manually evidenced).
- **AC-03:** First-time Google sign-in creates a local user and persists a Google subject association; second sign-in reuses the same user id.
- **AC-04:** Auto-link: existing password user with matching **verified** Google email receives the Google `sub` association and signs in as that user; unverified Google email does not auto-link (negative test).
- **AC-05:** Password-less Google users (null `password_hash`) cannot authenticate via `POST /auth/login` (negative test).
- **AC-06:** CSRF/`state` or ID-token validation rejects forged callbacks/tokens (negative tests).
- **AC-07:** When Google SSO is disabled, calling the SSO endpoint(s) returns the documented disabled error (stable code) without contacting Google.
- **AC-08:** Generated OpenAPI documents every added/changed SSO endpoint’s inputs, outputs, status codes, errors, auth requirements, and cookies/headers; OpenAPI drift test passes; runtime behavior matches the document for success and primary error paths.
- **AC-09:** `.env.example` and consumer-facing docs describe how to enable Google SSO.
- **AC-10:** `npm run build:api`, `npm run lint`, and relevant `test:unit` / module tests for auth/Google changes succeed; migration (if any) is generated and `build:migrations` succeeds.
- **AC-11:** No Google SDK types leak into `libs/domain` or `libs/application`; composition remains in `apps/api`.

## Verification strategy

1. Static review of layering, tokens, module options, and env validation against this specification.
2. Unit tests for application use case(s): create, link/conflict, password-less login rejection, disabled gate.
3. Adapter tests with mocked Google HTTP/OIDC responses (no live Google required in CI).
4. API/OpenAPI drift test for new routes and DTOs.
5. Optional manual smoke against a real Google OAuth client in a non-production project (report as unverified if secrets unavailable — not an automatic code defect).
6. Confirm Worker/Cron entrypoints unchanged regarding Google HTTP.

## Rollout and rollback

- **Rollout:** deploy migrations first; ship API with `GOOGLE_SSO_ENABLED=false` (or equivalent); enable per environment after configuring Google Cloud redirect URIs and secrets.
- **Rollback:** disable the feature flag/env without reverting user rows; keep identity columns/tables for safety. Full rollback of migration only with explicit human approval if data was written.
- **Compatibility:** password auth remains available throughout.

## Open questions requiring human decision

- **OQ-01 — Primary OAuth flow:** **Decided — Candidate A** (authorization-code redirect). Candidate B deferred.
- **OQ-02 — Account linking:** **Decided — auto-link** when Google email is verified and matches an existing user.
- **OQ-03 — Password storage for Google-only users:** Confirm **nullable `password_hash`** (planning default) vs non-usable hash.
- **OQ-04 — Post-login UX for redirect flow:** JSON response from callback vs `302` to allowlisted frontend return URL? (**Must not** use levych-style `postMessage` to `'*'`.) Recommendation: **302 to allowlisted frontend** for browser apps with session cookies; **JSON** acceptable for BFF/API-only consumers — pick one primary for the plan.
- **OQ-05 — Disabled routing:** Confirm **always register + 503** (planning default).
- **OQ-06 — Relationship to any legacy `/v1/auth/google*` migration docs:** keep this starter module independent (planning default).
- **OQ-07 — Authenticated “link Google to my account” endpoint:** confirm **out of MVP scope** (planning default).
- **OQ-08 — Hosted domain restriction** (`hd` / Workspace-only): optional config defaulting to unrestricted (planning default)?
