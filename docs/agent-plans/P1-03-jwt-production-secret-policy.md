---
issue_id: P1-03
status: approved
owner: human-approval-required
---

# P1-03 — Strengthen production policy for JWT secrets

## Source issue

`docs/agent-backlog/NESTJS_STARTER_KIT_REQUIRED_FIXES.md` — section **P1-03. Посилити production policy для JWT secrets**.

Related verification scenario: backlog **V-05** (Production JWT weak/equal/placeholder secrets fail-fast).

## Current behavior

1. `envSchema` in `libs/infrastructure/src/config/env.schema.ts` defines:
   - `JWT_SECRET: z.string().min(1)`
   - `JWT_REFRESH_SECRET: z.string().min(1)`
2. Existing `superRefine` validates conditional mail/SMTP, storage/S3, session cookie, outbox, and job-execution cross-field rules — **no JWT production policy**.
3. `InfrastructureConfigModule` validates all entrypoints (API, Worker, Cron, Migrations) via `ConfigModule.forRoot({ validate: envSchema })` and throws `new Error(\`Invalid env: ${parsed.error.message}\`)` on failure.
4. `.env.example` and README §21 document dev placeholders:
   - `JWT_SECRET=dev-secret` (`.env.example`)
   - `JWT_SECRET=dev-access-secret-change-me`, `JWT_REFRESH_SECRET=dev-refresh-secret-change-me` (README)
5. `NODE_ENV=production` with a one-character secret, identical access/refresh secrets, or documented placeholder values **passes bootstrap today**.
6. No unit tests exist for `envSchema` (no `libs/infrastructure/src/config/*.spec.ts` files).

**Investigation (2026-06-20, branch `main`, clean working tree):** defect confirmed — `env.schema.ts` lines 39–41 still enforce only non-empty JWT secrets. Issue is **not stale**.

## Confirmed root cause

Environment validation treats JWT secrets as opaque non-empty strings for all `NODE_ENV` values. Production deployments can start with cryptographically weak, identical, or well-known placeholder secrets because no production-specific entropy, distinctness, or denylist checks exist in `superRefine`.

## Dependency/runtime flow

```text
process.env
  -> InfrastructureConfigModule (all entrypoints import this)
       ConfigModule.forRoot({ validate: (env) => envSchema.safeParse(env) })
         -> envSchema (Zod object + superRefine)
              JWT_SECRET / JWT_REFRESH_SECRET parsed
              mapped to nested config.auth / config.jwt
         -> AppConfigService.jwt()
              -> JwtAuthTokenService (libs/infrastructure/src/auth/jwt-auth-token.service.ts)
                   sign/verify access and refresh tokens
```

**Symbols on the validation path:**

| File                                                             | Symbol                      | Role                                         |
| ---------------------------------------------------------------- | --------------------------- | -------------------------------------------- |
| `libs/infrastructure/src/config/env.schema.ts`                   | `envSchema`, `superRefine`  | Source of truth for env validation           |
| `libs/infrastructure/src/config/infrastructure-config.module.ts` | `validate` callback         | Fail-fast bootstrap on invalid env           |
| `libs/infrastructure/src/config/app-config.service.ts`           | `jwt()`                     | Runtime consumer of validated secrets        |
| `libs/infrastructure/src/auth/jwt-auth-token.service.ts`         | constructor / sign / verify | Uses `config.jwt().secret` / `refreshSecret` |
| `libs/infrastructure/src/auth/auth.module.ts`                    | JWT provider registration   | Wired when `AUTH_DRIVER=jwt`                 |

Production policy applies at bootstrap for **every entrypoint** that imports `InfrastructureConfigModule`, regardless of whether JWT auth is the active driver.

## Goal

Reject weak, placeholder, and identical JWT secrets when `NODE_ENV=production`, while preserving permissive dev/test configuration and documenting safe secret generation without committing real secrets to the repository.

## Scope

1. Add production-only JWT secret validation inside `envSchema.superRefine`.
2. Require minimum length equivalent to 32 random bytes in base64 representation (≥ 43 trimmed characters per backlog example).
3. Reject known placeholder / sample values from backlog and repository docs.
4. Reject `JWT_SECRET` equal to `JWT_REFRESH_SECRET` (trimmed comparison).
5. Add focused unit tests in `env.schema.spec.ts`.
6. Document production vs dev/test JWT secret policy in README and `.env.example`; add brief note to `DOCKER_PRODUCTION.md`.

## Out of scope

- Changing `AUTH_DRIVER=session` to skip JWT env vars (schema still requires them today; unchanged).
- Rotating or generating secrets in CI/CD or Docker build.
- Modifying `JwtAuthTokenService` signing logic.
- Broad env-schema refactors unrelated to JWT.
- Adding real secret values anywhere in the repository.
- Changing `InfrastructureConfigModule` error formatting unless a test proves Zod leaks secret values (prefer static custom messages; add assertion test).

## Files to create

| Path                                                | Responsibility                                                                   |
| --------------------------------------------------- | -------------------------------------------------------------------------------- |
| `libs/infrastructure/src/config/env.schema.spec.ts` | Unit tests for production JWT policy, dev/test permissiveness, no secret leakage |

## Files to modify

| Path                                           | Symbol / responsibility                                                          |
| ---------------------------------------------- | -------------------------------------------------------------------------------- |
| `libs/infrastructure/src/config/env.schema.ts` | Module-level constants; production JWT block in `superRefine`                    |
| `.env.example`                                 | Comments on `JWT_SECRET` / `JWT_REFRESH_SECRET` clarifying dev-only placeholders |
| `README.md`                                    | §16.1 and/or §21 — production JWT requirements and safe generation command       |
| `DOCKER_PRODUCTION.md`                         | Reminder to generate strong JWT secrets before production deploy                 |

## Files to delete

None.

## Contract and DI changes

- **No new env vars.**
- **No contract/token changes.**
- **No DI registration changes.**
- **Behavior change (intended):** `NODE_ENV=production` bootstrap fails when JWT secrets are short, placeholder, or identical.
- **Behavior change (none):** `NODE_ENV=development` and `NODE_ENV=test` retain current permissive `min(1)` policy.

## Implementation steps

1. **Add module-level constants in `env.schema.ts`**
   - `JWT_SECRET_MIN_LENGTH = 43` (32 bytes base64 without padding).
   - `JWT_SECRET_FIELDS = ['JWT_SECRET', 'JWT_REFRESH_SECRET'] as const`.
   - `JWT_PLACEHOLDER_VALUES`: lowercase denylist including backlog literals and doc samples:
     - `secret`, `changeme`, `development`
     - `dev-secret`, `dev-refresh-secret`
     - `dev-access-secret-change-me`, `dev-refresh-secret-change-me`

2. **Add production block at end of existing `superRefine` callback**
   - Guard: `if (env.NODE_ENV !== 'production') return` (or skip block).
   - For each field in `JWT_SECRET_FIELDS`:
     - `const value = env[field].trim()`
     - Fail when `value.length < JWT_SECRET_MIN_LENGTH` **or** `JWT_PLACEHOLDER_VALUES.has(value.toLowerCase())`.
     - Static message (no secret interpolation): `` `${field} must contain at least 32 bytes of non-placeholder entropy` ``.
   - After loop, fail when `env.JWT_SECRET.trim() === env.JWT_REFRESH_SECRET.trim()`:
     - Path: `['JWT_REFRESH_SECRET']`
     - Message: `'JWT access and refresh secrets must be different'`.

3. **Do not change base field definitions**
   - Keep `JWT_SECRET: z.string().min(1)` and `JWT_REFRESH_SECRET: z.string().min(1)` for dev/test compatibility.

4. **Create `env.schema.spec.ts`**
   - Add `minimalProductionEnv(overrides?)` helper supplying:
     - `NODE_ENV: 'production'`
     - `DATABASE_URL: 'postgresql://user:pass@localhost:5432/app'`
     - Valid distinct secrets ≥ 43 chars (fixed test constants, not real deployment secrets).
   - **Reject cases (production):**
     - Single-character secret
     - 42-character secret (below minimum)
     - Placeholder: `secret`, `changeme`, `development`, each doc sample value
     - Identical access and refresh secrets (even if long enough)
   - **Accept cases (production):**
     - Two distinct secrets ≥ 43 chars (base64-style test strings)
     - Hex-length secret (64 chars) if used in test matrix
   - **Dev/test permissiveness:**
     - `NODE_ENV: 'development'` with `.env.example`-style placeholders passes
     - `NODE_ENV: 'test'` with short distinct secrets passes
   - **No secret leakage:**
     - On failure, assert formatted error (`parsed.error.message` or `issues[].message`) does **not** contain the submitted secret substring.

5. **Update documentation**
   - **`.env.example`:** Comment above JWT lines, e.g. dev/test placeholders only; production requires independently generated secrets (see README).
   - **`README.md` §21 (Environment variables):** Add subsection **Production JWT secrets** with:
     - Minimum entropy requirement (32 bytes; recommend base64 or hex).
     - Access and refresh must differ.
     - Generation examples (no real values):
       ```bash
       openssl rand -base64 32
       openssl rand -hex 32
       ```
     - Explicit note: dev/test may use short placeholders; production bootstrap rejects them.
   - **`DOCKER_PRODUCTION.md`:** One bullet under preparation: set strong `JWT_SECRET` and `JWT_REFRESH_SECRET` before `docker compose ... up`.

6. **Leave `infrastructure-config.module.ts` unchanged** unless secret-leakage test fails — if it fails, format errors from `parsed.error.issues` using field path + static message only (minimal change).

## Migration and rollout concerns

- **No DB migration.**
- **Breaking change for production deployments** using weak or placeholder JWT secrets: bootstrap will fail until secrets are rotated to compliant values.
- **Dev/local/docker-compose dev flows:** unchanged when `NODE_ENV` is not `production`.
- **Production Docker:** operators must replace `.env.example` placeholders before first successful prod boot post-fix.
- **Worker/Cron/Migrations:** also fail-fast on weak JWT secrets even when not signing tokens — consistent with shared config module; acceptable per current architecture.

## Targeted verification

During implementation:

```bash
npm run test:unit -- libs/infrastructure/src/config/env.schema.spec.ts
npm run build
```

## Full verification

Before marking implementation complete:

```bash
npm run build
npm run lint
npm run test:unit
```

**Optional runtime check (V-05, infrastructure permitting):**

```bash
NODE_ENV=production JWT_SECRET=x JWT_REFRESH_SECRET=y DATABASE_URL=postgresql://u:p@localhost:5432/app npm run start:api
```

Expect immediate bootstrap failure with validation error (no secret values echoed).

Repeat with two distinct `openssl rand -base64 32` values; expect bootstrap to proceed past config validation (may still fail on missing Redis/Postgres — that is infrastructure, not this fix).

## Acceptance criteria

1. Production bootstrap rejects JWT secrets shorter than 43 trimmed characters.
2. Production bootstrap rejects known placeholder/sample values listed in the issue and repository docs.
3. Production bootstrap rejects identical access and refresh secrets.
4. Independently generated valid distinct secrets (≥ 43 chars) pass production validation.
5. Development and test environments continue to accept short/doc placeholder secrets.
6. Validation error messages do not contain submitted secret values.
7. Safe secret generation is documented in README (and referenced from `.env.example` / `DOCKER_PRODUCTION.md`) without adding real secrets to the repo.
8. `npm run lint`, `npm run build`, and targeted unit tests pass.
9. **V-05** scenarios are covered by `env.schema.spec.ts` (and optional runtime check above).

## Risks

| Risk                                                           | Mitigation                                                                                       |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Existing production deploys use `.env.example` placeholders    | Document rotation steps; fail-fast is intentional security improvement                           |
| 32-char raw ASCII secrets rejected (length 32 < 43)            | Align with backlog example (base64-length proxy); document recommended `openssl rand -base64 32` |
| False positive on random secret matching denylist exact string | Denylist uses exact lowercase match on trimmed value, not substring                              |
| Worker/Cron fail on JWT policy despite not using JWT           | Pre-existing shared-config coupling; out of scope for P1-03                                      |
| Zod error formatting exposes input values                      | Use static custom messages; add unit test assertion; adjust throw formatting only if test fails  |
| Placeholder list incomplete                                    | Include all values from `.env.example` and README §21; extend list in one constant array         |

## Rollback strategy

Revert changes to `env.schema.ts`, delete `env.schema.spec.ts`, and revert documentation edits. Production bootstrap returns to accepting weak JWT secrets. No migration rollback needed.

## Open questions requiring human decision

1. **Minimum length semantics:** Confirm backlog threshold of 43 (base64 of 32 bytes) vs also accepting exactly 32-character raw secrets or 64-character hex as explicit formats with dedicated checks.
2. **Denylist scope:** Exact-match only (recommended) vs also blocking secrets containing substrings like `change-me` or `dev-secret`.
3. **AUTH_DRIVER=session in production:** Should JWT secret validation still run when session driver is selected, or only when `AUTH_DRIVER=jwt`? Current plan: always in production (matches unconditional schema fields).
4. **Error throw formatting:** If Zod `error.message` ever includes input values for non-custom issues, approve minimal change to `infrastructure-config.module.ts` throw path?
5. **README placement:** Prefer new subsection under §21 only, or also a short callout in §16.1 JWT mode?
