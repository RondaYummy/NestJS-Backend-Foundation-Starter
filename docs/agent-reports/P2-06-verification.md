# P2-06 — Independent verification

## Verdict

**approved**

## Scope checked

- Source issue: `docs/agent-backlog/NESTJS_STARTER_KIT_REQUIRED_FIXES.md` — section **P2-06**
- Approved plan: `docs/agent-plans/P2-06-authorization-freshness-policy.md` (`status: approved`)
- Implementation report: `docs/agent-reports/P2-06-implementation.md` (treated as untrusted; verified independently)
- Git scope: 20 modified files + 7 new files on `main` (uncommitted); no unrelated production areas outside auth freshness, user model, migration, README §16.1, and composition wiring
- Plan deviations reviewed: AC-8 deferred (approved default); migration `0004` includes incidental outbox index DDL (documented, additive)

## Root-cause assessment

**Addressed.**

Original defect: authorization identity (`id`, `email`, `roles`) was embedded at login into JWT claims or Redis session JSON and trusted on refresh/verify without reloading from `IUserRepository`; no revocation version existed.

Verified fixes:

1. **Refresh path** — `RefreshAuthSessionUseCase` calls `parseRefreshToken` → `userRepository.findById` → rejects missing user or `authVersion` mismatch → `rotateAuthSession(parsed, freshUser)`. `JwtAuthTokenService.rotateAuthSession` issues tokens from `freshUser`, not refresh payload claims.
2. **Session path** — `RedisSessionStore` persists `{ userId, authVersion }`; `SessionAuthTokenService.verifyAccessToken` loads fresh user via `resolveSessionUser` (wired in composition root) and rejects version mismatch.
3. **Revocation primitive** — `users.auth_version` column + `IUserRepository.incrementAuthVersion` + `authVersion` on `CurrentUser` and JWT payloads.
4. **Intentional residual window** — JWT `verifyAccessToken` still returns claims from the access token without a DB read (refresh-only freshness policy per approved plan). Documented in README.

Direct `JwtAuthTokenService.refreshAuthSession` now rejects with `REFRESH_ORCHESTRATION_REQUIRED`; `auth.controller.ts` uses `RefreshAuthSessionUseCase` only.

## Acceptance criteria matrix

| # | Criterion | Status | Evidence |
| - | --------- | ------ | -------- |
| AC-1 | Freshness policy documented in README §16.1 with max revocation delay | **passed** | README lines 2163–2183: policy table (JWT access / refresh / session), consumer contract, legacy JWT, session breaking change |
| AC-2 | `users.auth_version`; domain/mapper/repository/`CurrentUser` aligned | **passed** | Migration `0004_amusing_sauron.sql`; `users.schema.ts`; `User` entity; `UserMapper`; `UserDrizzleRepository`; `CurrentUser.authVersion` |
| AC-3 | JWT access/refresh embed `authVersion` at issuance | **passed** | `JwtAuthTokenService.issueTokenPair`; unit test `embeds authVersion in access and refresh JWT payloads` |
| AC-4 | Refresh reloads user; rejects missing/`authVersion` mismatch | **passed** | `RefreshAuthSessionUseCase.loadFreshUser`; unit tests for mismatch and missing user |
| AC-5 | Refresh issues tokens with fresh `email`/`roles` from DB | **passed** | Use case passes DB-built `CurrentUser` to `rotateAuthSession`; JWT unit test asserts fresh roles in signed payload |
| AC-6 | Session driver validates current user/version, not role snapshot | **passed** | `SessionRecord` storage; `verifyAccessToken` resolver + version check; unit tests for stale version and missing user |
| AC-7 | `incrementAuthVersion` available + README contract | **passed** | `IUserRepository.incrementAuthVersion` JSDoc; `UserDrizzleRepository.incrementAuthVersion`; README consumer contract |
| AC-8 | Optional high-risk endpoint check (conditional) | **passed (deferred)** | Not implemented; matches approved plan default (refresh-only freshness, no RolesGuard DB check) |
| AC-9 | `npm run build`, `npm run lint`, `npm run test:unit` pass | **passed (with repo-wide caveats)** | `npm run build` and `npm run build:api` exit 0; all P2-06 targeted unit suites pass (14 tests). Full `npm run lint` fails on 4 pre-existing unused-var errors in outbox files untouched by P2-06. Full `npm run test:unit` not re-run by verifier (implementation report cites 1 pre-existing outbox spec failure). |
| AC-10 | No `AuthModule` / token-service coupling to `IUserRepository` | **passed** | No `IUserRepository` in `libs/infrastructure/src/auth/`; refresh orchestration in application layer; `resolveSessionUser` wired in `AuthApplicationCompositionModule` |

## Dependency and DI verification

| Check | Result |
| ----- | ------ |
| `AuthModule` does not inject `IUserRepository` | Confirmed — grep over `libs/infrastructure/src/auth/` shows no repository imports |
| `JwtAuthTokenService` constructor | `JwtService`, `AUTH_MODULE_OPTIONS`, `IJwtTokenStore` only |
| Refresh orchestration in application layer | `RefreshAuthSessionUseCase` injects `IAuthTokenService` + `IUserRepository`; factory in `auth-application.module.ts` |
| Session resolver in composition root | `AuthModule.forRootAsync` `useFactory` receives `TOKENS.UserRepository` and supplies `resolveSessionUser` for session driver only |
| Controller entrypoint | `auth.controller.ts` calls `RefreshAuthSessionUseCase.execute`, not `IAuthTokenService.refreshAuthSession` directly |
| Both drivers implement extended contract | `parseRefreshToken` / `rotateAuthSession` on JWT and session services (session rejects refresh with `REFRESH_TOKEN_NOT_SUPPORTED`) |

## Commands executed

| Command | Result | Conclusion |
| ------- | ------ | ---------- |
| `git status` / `git diff` | 20 modified + 7 untracked P2-06 files | Scope matches plan; no unexpected production edits |
| `npm run build` | Exit 0 (1st attempt exit -1073741819 transient crash; 2nd attempt succeeded) | Full build passes |
| `npm run build:api` | Exit 0 (1st attempt crashed; 2nd succeeded) | API composition compiles with new DI |
| `npm run test:unit -- jwt-auth-token` | 4 passed | AC-3, legacy `authVersion`, rotate with fresh user covered |
| `npm run test:unit -- refresh-auth-session` | 3 passed | AC-4, AC-5, V-11 stale refresh covered |
| `npm run test:unit -- session-auth-token` | 4 passed | AC-6, session storage shape, stale version covered |
| `npm run test:unit -- auth.module.spec` | 3 passed | Auth module driver branching still valid |
| `npm run lint` | Exit 1 — 4 errors in `outbox-processor.defaults.ts`, `outbox-processor.options.schema.ts` | Pre-existing; not introduced by P2-06 |

## V-11 unit scenario coverage (plan Step 7)

| Plan scenario | Covered in tests | Notes |
| ------------- | ---------------- | ----- |
| Refresh stale roles / authVersion bump | Yes | `refresh-auth-session.usecase.spec.ts` — `rejects refresh when authVersion mismatch` |
| Refresh fresh user | Yes | `reloads user from repository and rotates with fresh roles` |
| Session stale version | Yes | `session-auth-token.service.spec.ts` — `returns null when authVersion is stale` |
| Legacy missing `authVersion` claim | Yes | JWT tests — `treats missing claim as 0` (parse + verify) |
| Access token stale until expiry | Documented only | No unit assertion; matches approved refresh-only access policy |

Manual V-11 HTTP scenarios (login → DB bump → refresh/`/auth/me`) were **not** executed — requires PostgreSQL + Redis bootstrap.

## Findings

1. **No blocking gaps** — implementation matches approved plan for required scope.
2. **AC-8 correctly deferred** — no per-request access-time DB check; documented stale access window up to `JWT_EXPIRES_IN`.
3. **Migration side effect** — `0004_amusing_sauron.sql` drops/recreates outbox indexes in addition to `auth_version` column; additive but should be reviewed before production apply.
4. **Full lint gate** — repo-wide lint still fails (P2-11 backlog); P2-06 files are not the source.
5. **Build flakiness** — first `npm run build` / `npm run build:api` invocations crashed (Windows exit -1073741819); immediate retries succeeded. Not attributable to P2-06 code.
6. **Implementation report claims** — independently confirmed for build, targeted tests, DI layout, and core behavior; full `test:unit` suite not re-run by verifier.

## Documentation alignment

README §16.1 authorization freshness section aligns with implemented behavior: refresh immediate rejection on version mismatch, session immediate rejection, JWT access bounded by expiry, legacy claim = 0, session format breaking change noted.

## Remaining risks

- **JWT access stale window** — up to `JWT_EXPIRES_IN` (default 15m) after role/`authVersion` change; by design per plan.
- **No in-repo callers of `incrementAuthVersion`** — downstream apps must wire security events; field unused until then except at default `0`.
- **Session deploy** — existing Redis sessions invalidated on deploy (documented).
- **Migration outbox index DDL** — verify on target DB; unrelated to auth but bundled in same migration file.
- **Family-wide refresh revocation on version bump** — out of scope; stale refresh families could remain until natural expiry if version not bumped on token (mitigated when apps call `incrementAuthVersion`).

## Unverified areas

- V-11 manual HTTP scenarios (`POST /auth/login`, DB `auth_version` bump, `POST /auth/refresh`, `GET /auth/me` with old access token)
- `npm run test:int` — not run; no new integration tests added
- Full `npm run test:unit` — not re-run by verifier (1 pre-existing failure reported in implementation report)
- `npm run db:migrate` / API bootstrap with live PostgreSQL + Redis
- Production migration apply of `0004` including outbox index statements
