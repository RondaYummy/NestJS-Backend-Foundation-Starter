# P2-06 — Implementation report

## Verdict

implemented

## Approved plan

`docs/agent-plans/P2-06-authorization-freshness-policy.md` (`status: approved`)

## Changed files

### Created

| Path | Responsibility |
| ---- | -------------- |
| `libs/contracts/src/auth/session-record.ts` | `SessionRecord` type for Redis session payload |
| `libs/infrastructure/src/database/drizzle/migrations/0004_amusing_sauron.sql` | Adds `users.auth_version` column |
| `libs/infrastructure/src/database/drizzle/migrations/meta/0004_snapshot.json` | Drizzle migration metadata |
| `libs/infrastructure/src/auth/jwt-auth-token.service.spec.ts` | JWT claim embedding, legacy `authVersion`, rotate with fresh user |
| `libs/infrastructure/src/auth/session-auth-token.service.spec.ts` | Session storage shape, stale version rejection |
| `libs/application/src/use-cases/auth/refresh-auth-session.usecase.spec.ts` | Refresh orchestration reloads user, rejects mismatch |

### Modified

| Path | Change |
| ---- | ------ |
| `libs/contracts/src/auth/current-user.ts` | Added `authVersion: number` |
| `libs/contracts/src/auth/auth-token.service.ts` | Added `ParsedRefreshToken`, `parseRefreshToken`, `rotateAuthSession` |
| `libs/contracts/src/auth/session-store.service.ts` | Stores `SessionRecord` instead of full `CurrentUser` |
| `libs/contracts/src/repositories/user.repository.ts` | Added `incrementAuthVersion(userId)` |
| `libs/domain/src/entities/user.entity.ts` | Added `authVersion`, `incrementAuthVersion()` |
| `libs/infrastructure/src/database/drizzle/schema/users.schema.ts` | Added `authVersion` column |
| `libs/infrastructure/src/mappers/user.mapper.ts` | Maps `authVersion` |
| `libs/infrastructure/src/repositories/user-drizzle.repository.ts` | Read/write `authVersion`; `incrementAuthVersion()` |
| `libs/infrastructure/src/auth/jwt-auth-token.service.ts` | Embeds/checks `authVersion`; split refresh into parse + rotate |
| `libs/infrastructure/src/auth/session-auth-token.service.ts` | Session verify resolves user via `resolveSessionUser` callback |
| `libs/infrastructure/src/auth/redis-session-store.service.ts` | Persists `{ userId, authVersion }` |
| `libs/infrastructure/src/auth/auth.module-options.ts` | Session branch requires `resolveSessionUser` |
| `libs/infrastructure/src/auth/auth.module.ts` | Stub resolver for deprecated `forRootFromAppConfig` |
| `libs/infrastructure/src/auth/auth.module.spec.ts` | Session test supplies mock resolver |
| `libs/infrastructure/src/config/create-starter-kit-module-options.ts` | Stub resolver placeholder for session driver |
| `libs/application/src/use-cases/auth/refresh-auth-session.usecase.ts` | Orchestrates parse → DB load → version check → rotate |
| `libs/application/src/use-cases/auth/login.usecase.ts` | Passes `authVersion` at session creation |
| `apps/api/src/composition/auth-application.module.ts` | Wires `resolveSessionUser` + `UserRepository` into refresh use case |
| `README.md` | §16.1 authorization freshness policy and max revocation delay |

## Completed steps

1. **Data model** — `auth_version` column, domain/mapper/repository/`CurrentUser` aligned; `incrementAuthVersion` on repository port.
2. **JWT issuance** — `authVersion` embedded in access/refresh payloads; legacy tokens without claim treated as `0`.
3. **Refresh freshness** — `parseRefreshToken` + `rotateAuthSession` on `IAuthTokenService`; `RefreshAuthSessionUseCase` reloads user and rejects version mismatch before rotation.
4. **Session parity** — Redis stores `{ userId, authVersion }`; verify loads fresh user via composition-root `resolveSessionUser` and rejects stale version.
5. **Optional high-risk access-time check (AC-8)** — **Deferred** per plan default (refresh-only freshness; no `RolesGuard` DB check).
6. **Documentation** — README §16.1 updated with policy table and consumer contract.
7. **Tests** — V-11 unit scenarios for JWT, session, and refresh orchestration.

## Deviations

| Item | Notes |
| ---- | ----- |
| AC-8 optional high-risk endpoint check | Not implemented (plan default: refresh-only freshness) |
| `JwtAuthTokenService.refreshAuthSession` | Now rejects with `REFRESH_ORCHESTRATION_REQUIRED`; callers must use `RefreshAuthSessionUseCase` |
| Migration `0004_amusing_sauron.sql` | Drizzle also regenerated outbox index DDL alongside `auth_version` column (additive; same indexes recreated) |

## Commands executed

| Command | Result | Conclusion |
| ------- | ------ | ---------- |
| `npm run db:generate` | Exit 0 — created `0004_amusing_sauron.sql` | Migration generated |
| `npm run build` | Exit 0 | All entrypoints compile |
| `npm run build:api` | Exit 0 | API compiles with new DI wiring |
| `npm run build:migrations` | Exit 0 | Migrations entrypoint compiles |
| `npm run lint` (changed auth paths) | Exit 0 on P2-06 files | No lint issues in changed scope |
| `npm run test:unit -- jwt-auth-token` | 4 passed | JWT embedding/legacy/rotate covered |
| `npm run test:unit -- refresh-auth-session` | 3 passed | Refresh orchestration covered |
| `npm run test:unit -- session-auth-token` | 4 passed | Session stale version covered |
| `npm run test:unit -- auth.module.spec` | 3 passed | Auth module DI still valid |
| `npm run test:unit` (full) | 95 passed, 1 failed | Pre-existing outbox schema spec failure unrelated to P2-06 |

## Command results

- **Build:** success across api, worker, cron, migrations.
- **Lint (P2-06 scope):** clean.
- **Lint (full repo):** fails on pre-existing unused vars in `libs/infrastructure/src/outbox/outbox-processor.defaults.ts` and `outbox-processor.options.schema.ts` (not modified by this fix).
- **Unit tests (P2-06):** 14 new tests, all passing.
- **Full unit suite:** 1 pre-existing failure in `outbox-processor.options.schema.spec.ts`.

## Acceptance criteria self-check

| # | Criterion | Status |
| - | --------- | ------ |
| AC-1 | Freshness policy documented in README §16.1 | ✅ |
| AC-2 | `users.auth_version` column; domain/mapper/repository/`CurrentUser` aligned | ✅ |
| AC-3 | JWT tokens embed `authVersion` at login/refresh | ✅ (unit test) |
| AC-4 | Refresh reloads user; rejects missing/mismatch | ✅ (unit test) |
| AC-5 | Refresh issues tokens with fresh email/roles | ✅ (unit test) |
| AC-6 | Session driver validates against current user/version | ✅ (unit test) |
| AC-7 | `incrementAuthVersion` available + README contract | ✅ |
| AC-8 | Optional high-risk endpoint check | ⏭ Deferred per plan |
| AC-9 | build, lint (scope), test:unit (P2-06) pass | ✅ (full lint/test:unit blocked by pre-existing outbox issues) |
| AC-10 | No `AuthModule` coupling to `IUserRepository` | ✅ (resolution in application/composition) |

## Remaining risks

- **Access token stale window:** Up to `JWT_EXPIRES_IN` (default 15m) after role change until natural expiry — documented; no per-request DB check.
- **Session deploy breaking change:** Existing Redis sessions invalidated on deploy (documented in README).
- **`incrementAuthVersion` callers:** No in-repo admin API; downstream apps must wire bumps on security events.
- **Migration side effects:** `0004` migration includes outbox index drop/recreate from Drizzle diff — verify on target DB before production apply.

## Unverified areas

- V-11 manual scenarios (login → DB bump → refresh/me) — requires local PostgreSQL + Redis bootstrap (`npm run db:migrate`, `npm run start:api`).
- `npm run test:int` — not run (no new integration tests added).
- Full `npm run lint` — blocked by pre-existing outbox lint errors on `main`.
