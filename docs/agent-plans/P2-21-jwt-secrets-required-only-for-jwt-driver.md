---
issue_id: P2-21
status: approved
owner: human-approval-required
---

# P2-21 — Require JWT secrets in env schema only when `AUTH_DRIVER=jwt`

## Source issue

- Backlog ID: `P2-21`
- Index: `docs/agent-backlog/INDEX.md`
- Full text: `docs/agent-backlog/NESTJS_STARTER_KIT_REQUIRED_FIXES.md` § P2-21
- Review source: `docs/agent-reports/full-review-2026-08-02.md` (Medium — `envSchema` requires JWT secrets even when `AUTH_DRIVER=session`)

## Current behavior

Confirmed on current `main` (inspected 2026-08-02):

1. `libs/infrastructure/src/config/env.schema.ts` declares:
   - `JWT_SECRET: z.string().min(1)`
   - `JWT_REFRESH_SECRET: z.string().min(1)`
   so omitted or empty values fail object-level parse **regardless of** `AUTH_DRIVER`.
2. The same file’s production `superRefine` block (`NODE_ENV === 'production'`) always:
   - walks `JWT_SECRET_FIELDS` (`JWT_SECRET`, `JWT_REFRESH_SECRET`) for length ≥ `JWT_SECRET_MIN_LENGTH` (43) and placeholder denylist;
   - rejects identical access/refresh secrets;
   with **no** `AUTH_DRIVER === 'jwt'` gate.
3. Driver-conditional validation already exists in the same `superRefine` for `MAIL_DRIVER=smtp`, `STORAGE_DRIVER=s3`, and `GOOGLE_SSO_ENABLED` — JWT secrets do not follow that pattern.
4. `mapAppConfigToAuthOptions` (`libs/infrastructure/src/config/create-starter-kit-module-options.ts`) already omits `jwt` when `auth.driver === 'session'`; only JWT Auth options consume `config.jwt()`. Session deployments still must supply secrets solely because env validation forces them.
5. `libs/infrastructure/src/config/env.schema.spec.ts` covers production entropy and short-placeholder permissiveness in development/test, but has **no** cases for `AUTH_DRIVER=session` without JWT secrets, nor JWT-driver missing-secret failures.
6. `.env.example` always lists `JWT_SECRET` / `JWT_REFRESH_SECRET` with placeholders; comments do not state that they are required only for `AUTH_DRIVER=jwt`.
7. README § “Production JWT secrets” describes production entropy without saying it applies only when the JWT driver is selected.

## Confirmed root cause

Env schema treats JWT secrets as unconditionally required strings and applies production entropy/identity checks to those fields for every driver. Session-only deployments therefore cannot bootstrap without unused JWT credentials, adding friction and unnecessary secret surface for portable session composition.

## Dependency/runtime flow

```text
process.env / .env
  -> InfrastructureConfigModule validate (envSchema.safeParse)
       -> object parse: JWT_SECRET / JWT_REFRESH_SECRET currently min(1) ALWAYS
       -> superRefine: production entropy ALWAYS on JWT fields
       -> load -> AppConfigService.jwt() / auth()
            -> mapAppConfigToAuthOptions
                 session: AuthModuleOptions without jwt  (secrets unused)
                 jwt: AuthModuleOptions.jwt from config.jwt()

Desired:
  AUTH_DRIVER=session
    -> JWT secrets optional (omit / empty OK)
    -> no production JWT entropy / identity checks
  AUTH_DRIVER=jwt (default)
    -> JWT secrets required (non-empty after trim) in all NODE_ENV
    -> production: existing entropy + distinct-secret rules unchanged
```

## Goal

Make JWT secret presence and production entropy validation driver-conditional: required and entropy-checked only when `AUTH_DRIVER=jwt`; session-driver env without JWT secrets must validate successfully. Keep JWT-driver fail-fast behavior and existing production strength rules.

## Scope

- Change `envSchema` field definitions and `superRefine` so JWT secrets follow the existing driver-conditional pattern (same style as SMTP / S3 / Google SSO).
- Gate production entropy and “secrets must differ” checks behind `AUTH_DRIVER === 'jwt'`.
- Extend `env.schema.spec.ts` for both driver branches (AC-01..AC-04).
- Update `.env.example` comments; align README production-JWT wording (and a one-line Docker note if it still implies secrets are always mandatory).

## Out of scope

- P2-16 / P2-17 / P2-18 / P2-19 / P2-20 and any other backlog items.
- P2-19 (`AuthModule.forRootAsync` JwtModule isolation) — related portability concern, separate DI change; do not implement here.
- Changing `AuthModule`, JWT/session token services, or composition roots.
- Making `JWT_EXPIRES_IN` / `JWT_REFRESH_EXPIRES_IN` driver-conditional (they already have safe defaults and are unused under session).
- Changing `JWT_SECRET_MIN_LENGTH`, `JWT_PLACEHOLDER_VALUES`, or the production entropy algorithm itself beyond gating by driver.
- Redesigning `AppConfigService` / `ConfigShape.jwt` into a discriminated union (empty-string defaults keep `string` typing; optional follow-up only if human expands scope).
- HTTP endpoint, OpenAPI, or Postman changes (none; see note below).

### HTTP / OpenAPI / Postman

This fix does **not** add or change HTTP endpoints. No OpenAPI decorator/schema updates and no `docs/postman/` collection updates are required. Do not run `npm run test:postman-coverage` as acceptance for this issue.

### Contract changes

No public HTTP contract changes. Env validation contract changes only: JWT secrets become optional unless `AUTH_DRIVER=jwt`. Nest DI tokens and `AuthModuleOptions` shapes stay as today.

## Files to create

- None.

## Files to modify

| Path | Symbols / responsibility |
| --- | --- |
| `libs/infrastructure/src/config/env.schema.ts` | `JWT_SECRET` / `JWT_REFRESH_SECRET`: change from `z.string().min(1)` to optional-with-empty-default (match `SMTP_*` / `S3_*` style, e.g. `z.string().optional().default('')`). In `superRefine`: when `AUTH_DRIVER === 'jwt'`, require non-empty trimmed secrets with clear messages (`… is required when AUTH_DRIVER=jwt`). Wrap the existing production entropy + distinct-secret block so it runs only when `NODE_ENV === 'production' && AUTH_DRIVER === 'jwt'`. Leave `JWT_SECRET_FIELDS`, `JWT_SECRET_MIN_LENGTH`, `JWT_PLACEHOLDER_VALUES` as shared constants used by that gated block. |
| `libs/infrastructure/src/config/env.schema.spec.ts` | Add driver-branch coverage: session without JWT secrets (dev + production) succeeds; JWT without secrets fails; production entropy still enforced for JWT (existing cases: keep/adjust `minimalProductionEnv` to set `AUTH_DRIVER: 'jwt'` explicitly or rely on default); production session may omit secrets and must not fail entropy; optional: session + production + weak unused secrets still succeeds (matches “entropy only for JWT driver”). Keep existing non-JWT describes working (fixtures may keep dummy secrets). |
| `.env.example` | Comment `JWT_SECRET` / `JWT_REFRESH_SECRET` (and nearby JWT TTL lines if helpful) as required only when `AUTH_DRIVER=jwt`; may be omitted for session-only local/prod. Do not remove example values for the default `AUTH_DRIVER=jwt` path. |
| `README.md` | “Production JWT secrets” section: state that presence + entropy checks apply when `AUTH_DRIVER=jwt`; session-only production does not require JWT secrets. |
| `DOCKER_PRODUCTION.md` | One-line clarify that strong JWT secrets are required for JWT driver / when using default `AUTH_DRIVER=jwt`, not for pure session deployments. |
| `docs/agent-plans/INDEX.md` | Register this plan row while `proposed` / in progress (planner hygiene; not production). |

## Files to delete

- None.

## Contract and DI changes

- **HTTP / OpenAPI / Postman:** none.
- **`libs/contracts`:** none.
- **Env type (`Env`):** `JWT_SECRET` / `JWT_REFRESH_SECRET` remain `string` after parse (empty default when omitted), so `infrastructure-config.module.ts` mapping `jwt: { secret: e.JWT_SECRET, … }` and `AppConfigService.jwt()` need no signature change.
- **Auth DI:** no change; `mapAppConfigToAuthOptions` already ignores `config.jwt()` for session.
- **Breaking behavior (intentional):** session deployments may omit JWT secrets; JWT deployments that omit them continue to fail (via `superRefine` instead of `min(1)`).

## Implementation steps

1. **`env.schema.ts` — field shape**
   - Replace `JWT_SECRET` / `JWT_REFRESH_SECRET` `z.string().min(1)` with `z.string().optional().default('')` (same pattern as optional SMTP/S3 strings).
   - Keep `JWT_EXPIRES_IN` / `JWT_REFRESH_EXPIRES_IN` defaults unchanged.

2. **`env.schema.ts` — `superRefine` JWT presence**
   - After other driver-conditional blocks (or adjacent to them), when `env.AUTH_DRIVER === 'jwt'`:
     - for each of `JWT_SECRET`, `JWT_REFRESH_SECRET`, if `!value.trim()`, `ctx.addIssue` with message like `` `${field} is required when AUTH_DRIVER=jwt` ``.
   - Do not require JWT secrets when `AUTH_DRIVER === 'session'`.

3. **`env.schema.ts` — gate production entropy**
   - Change `if (env.NODE_ENV === 'production')` JWT block to `if (env.NODE_ENV === 'production' && env.AUTH_DRIVER === 'jwt')`.
   - Keep length, placeholder, and distinct-secret logic identical inside that gate.
   - Ensure empty defaults under session never call misleading entropy checks (gated out).

4. **`env.schema.spec.ts`**
   - Session + missing/omitted JWT secrets + `NODE_ENV=development` → `success` (AC-01).
   - Session + missing JWT secrets + `NODE_ENV=production` → `success` (AC-01; no entropy failure).
   - JWT (explicit or default) + missing/empty secrets → `success === false` with required-when-jwt messaging (AC-02).
   - Keep/adjust existing production entropy suite so it runs under JWT driver (AC-03).
   - Ensure both driver branches have dedicated unit cases (AC-04).

5. **Docs**
   - `.env.example` comments; README production JWT section; short `DOCKER_PRODUCTION.md` clarify.

6. **Do not** change Auth modules, composition, or HTTP docs for this issue.

## Migration and rollout concerns

- **Backward compatible for JWT (default):** existing `.env` files that already set secrets continue to work; production entropy unchanged for JWT.
- **Relaxation for session:** operators can remove unused JWT secrets from session-only deployments after this ships.
- **No DB migrations, no lockfile, no runtime dependency changes.**
- **Coordination with P2-19:** optional; session can omit secrets even if JwtModule still registers a placeholder until P2-19 lands — env validation and DI isolation are independent.

## Targeted verification

```bash
node node_modules/jest/bin/jest.js libs/infrastructure/src/config/env.schema.spec.ts
npm run build
npm run lint
```

Optional smoke (if local env available): temporarily set `AUTH_DRIVER=session` and unset `JWT_SECRET` / `JWT_REFRESH_SECRET`, then bootstrap API or run a minimal `envSchema.safeParse` script — treat missing infra as non-blocking.

## Full verification

```bash
npm run build
npm run lint
npm run test:unit
```

`test:module` / `test:int` / Postman coverage are not required for this env-schema-only change unless an unexpected consumer fails.

## Acceptance criteria

- **AC-01:** Valid session-driver env without JWT secrets loads successfully (`envSchema.safeParse` / config validate).
- **AC-02:** JWT driver without secrets fails validation.
- **AC-03:** Production entropy checks still enforce strong, distinct JWT secrets when `AUTH_DRIVER=jwt`.
- **AC-04:** Unit coverage for both driver branches (session optional secrets; JWT required + production entropy).
- Docs (`.env.example`, README production JWT note) state JWT secrets are required only for the JWT driver.
- No HTTP/OpenAPI/Postman churn.

## Risks

- **Empty-string defaults:** `AppConfigService.jwt()` may return empty strings under session; safe today because session mapping ignores them, but any future code calling `config.jwt()` without checking driver could misuse empties — mitigate by keeping session mapping JWT-free (already true) and not expanding callers.
- **Whitespace-only secrets under JWT:** must fail via trim check (align with SMTP/S3 required-field style).
- **Session + leftover weak production secrets:** under the issue wording, entropy is skipped for session even if weak secrets remain in env; if humans prefer “validate when present,” that is an open question below.
- **Test fixture churn:** many specs inject JWT secrets into `process.env`; they should keep passing; only `env.schema.spec.ts` needs new driver cases.

## Rollback strategy

Revert the single schema + spec + comment/doc changes. No data migration. Operators who removed JWT secrets from session env would need to re-add placeholders only if rolling back before switching driver back to JWT.

## Open questions requiring human decision

1. **Weak JWT secrets present under `AUTH_DRIVER=session` in production:** Issue text says apply entropy **only** for the JWT driver (recommended: skip entropy entirely for session, even if secrets are set). Alternative: if secrets are non-empty under session, still run entropy. Default plan = skip unless human chooses the stricter “validate if present” policy.
2. **README / `DOCKER_PRODUCTION.md`:** Issue lists `.env.example` explicitly; this plan also updates README + Docker one-liner for consistency. Confirm that doc scope is acceptable, or restrict to `.env.example` only.
3. **Discriminated `ConfigShape.jwt`:** Out of scope here; confirm no requirement to make `jwt` optional on `AppConfigService` in this fix.
