# P1-03 — Implementation report

## Verdict

implemented

## Approved plan

`docs/agent-plans/P1-03-jwt-production-secret-policy.md` (`status: approved`)

## Changed files

| Path                                                | Change                                                                                                           |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `libs/infrastructure/src/config/env.schema.ts`      | Added `JWT_SECRET_MIN_LENGTH`, `JWT_SECRET_FIELDS`, `JWT_PLACEHOLDER_VALUES`; production JWT `superRefine` block |
| `libs/infrastructure/src/config/env.schema.spec.ts` | **Created** — V-05 unit coverage: production reject/accept matrix, dev/test permissiveness, no secret leakage    |
| `.env.example`                                      | Comment clarifying dev/test-only JWT placeholders                                                                |
| `README.md`                                         | §21 — **Production JWT secrets** subsection with entropy rules and `openssl` generation examples                 |
| `DOCKER_PRODUCTION.md`                              | Preparation bullet reminding operators to set strong JWT secrets before deploy                                   |

## Completed steps

1. Added module-level constants `JWT_SECRET_MIN_LENGTH` (43), `JWT_SECRET_FIELDS`, and `JWT_PLACEHOLDER_VALUES` denylist in `env.schema.ts`.
2. Added production-only JWT validation block at the end of `superRefine`:
   - minimum 43 trimmed characters per secret;
   - exact-match denylist for known placeholders;
   - distinct access/refresh secrets (trimmed comparison).
3. Left base field definitions unchanged (`z.string().min(1)`).
4. Created `env.schema.spec.ts` with 16 tests covering reject/accept cases, dev/test permissiveness, and no-secret-leakage assertion.
5. Updated `.env.example`, `README.md` §21, and `DOCKER_PRODUCTION.md`.
6. Left `infrastructure-config.module.ts` unchanged — secret-leakage unit test passed without formatting changes.

## Deviations

None from the approved plan.

## Commands executed

```bash
npm run test:unit -- libs/infrastructure/src/config/env.schema.spec.ts
npm run build
npx eslint libs/infrastructure/src/config/env.schema.ts libs/infrastructure/src/config/env.schema.spec.ts --max-warnings=0
npm run lint
npm run test:unit
NODE_ENV=production JWT_SECRET=x JWT_REFRESH_SECRET=y DATABASE_URL=postgresql://u:p@localhost:5432/app npm run start:api
```

## Command results

| Command                                           | Result                       | Conclusion                                                                                                                    |
| ------------------------------------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Targeted unit tests (`env.schema.spec.ts`)        | Exit 0 — 16 tests passed     | V-05 production policy, dev/test permissiveness, and no-leakage assertion confirmed                                           |
| `npm run build`                                   | Exit 0                       | All entrypoints compile with updated env schema                                                                               |
| Targeted ESLint (changed source files)            | Exit 0                       | No lint issues in P1-03 files                                                                                                 |
| `npm run lint` (full)                             | Exit 1                       | Pre-existing failures in `outbox-processor.defaults.ts` and `outbox-processor.options.schema.ts`; **not introduced by P1-03** |
| `npm run test:unit` (full)                        | Exit 1 — 53 passed, 1 failed | Failure in `outbox-processor.options.schema.spec.ts` (pre-existing); all 16 `env.schema` tests passed                         |
| Optional V-05 runtime (`start:api`, weak secrets) | Bootstrap failed immediately | Static validation messages only; no submitted secret values echoed                                                            |

## Acceptance criteria self-check

| #   | Criterion                                                                                 | Status                                                                                                   |
| --- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| 1   | Production bootstrap rejects JWT secrets shorter than 43 trimmed characters               | Pass — unit tests + runtime check                                                                        |
| 2   | Production bootstrap rejects known placeholder/sample values                              | Pass — 7 placeholder values covered in `it.each`                                                         |
| 3   | Production bootstrap rejects identical access and refresh secrets                         | Pass — unit test asserts static distinctness message                                                     |
| 4   | Independently generated valid distinct secrets (≥ 43 chars) pass production validation    | Pass — base64-style and 64-char hex accept tests                                                         |
| 5   | Development and test environments continue to accept short/doc placeholder secrets        | Pass — development `.env.example` and test short-secret tests                                            |
| 6   | Validation error messages do not contain submitted secret values                          | Pass — dedicated leakage test; runtime error uses static messages only                                   |
| 7   | Safe secret generation documented in README (referenced from `.env.example` / Docker doc) | Pass — README §21 subsection, `.env.example` comment, `DOCKER_PRODUCTION.md` bullet                      |
| 8   | `npm run lint`, `npm run build`, and targeted unit tests pass                             | Partial — build and targeted lint/tests pass; full lint/test suite blocked by pre-existing outbox issues |
| 9   | V-05 scenarios covered by `env.schema.spec.ts` (and optional runtime check)               | Pass — 16 unit tests + runtime fail-fast confirmed                                                       |

## Remaining risks

- Existing production deployments using `.env.example` placeholders will fail bootstrap until secrets are rotated (intentional security improvement).
- 32-character raw ASCII secrets are rejected (length 32 < 43); operators should use `openssl rand -base64 32` or `openssl rand -hex 32` as documented.
- Worker/Cron/Migrations still validate JWT secrets in production even when `AUTH_DRIVER=session` (pre-existing shared-config coupling; out of scope).

## Unverified areas

- Runtime bootstrap with valid distinct `openssl rand -base64 32` secrets was not executed end-to-end (would require compliant secrets and available PostgreSQL/Redis; config validation path is covered by unit tests).
- §16.1 JWT mode callout was not added; plan allowed §21-only documentation and that path was used.
