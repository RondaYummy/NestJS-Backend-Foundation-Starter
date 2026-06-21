# P2-06 — Implementation report

## Verdict

implemented

## Approved plan

`docs/agent-plans/P2-06-authorization-freshness-policy.md` (`status: approved`)

## Follow-up completion (2026-06-21)

Verification noted JWT access tokens could remain stale up to `JWT_EXPIRES_IN` because `verifyAccessToken` trusted embedded claims without a DB read. Session driver already reloaded fresh user state via `resolveSessionUser`.

| Path                                                          | Change                                                                                                        |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `libs/infrastructure/src/auth/auth.module-options.ts`         | Added optional `resolveAccessUser` callback on JWT driver branch                                              |
| `libs/infrastructure/src/auth/jwt-auth-token.service.ts`      | When `resolveAccessUser` is wired, `verifyAccessToken` reloads user and rejects `authVersion` mismatch        |
| `apps/api/src/composition/auth-application.module.ts`         | Wires shared `resolveFreshUser` for both JWT (`resolveAccessUser`) and session (`resolveSessionUser`) drivers |
| `libs/infrastructure/src/auth/jwt-auth-token.service.spec.ts` | V-11 tests: stale version returns null; fresh roles returned from resolver                                    |
| `README.md` §16.1                                             | Updated max revocation delay table — JWT access is immediate when resolver is wired (starter kit default)     |

`AuthModule` remains DB-agnostic; resolver is supplied at the composition boundary (AC-10 preserved).

## Changed files (full scope)

See prior implementation in git history: migration `0004`, `authVersion` on user model, refresh orchestration, session record shape, unit tests, README §16.1.

## Completed steps

1. Data model — `auth_version` column, domain/mapper/repository/`CurrentUser` aligned.
2. JWT issuance — `authVersion` embedded in access/refresh payloads.
3. Refresh freshness — `RefreshAuthSessionUseCase` reloads user before rotation.
4. Session parity — Redis stores `{ userId, authVersion }`; verify uses resolver.
5. **JWT access parity** — `resolveAccessUser` wired in starter-kit API composition (follow-up).
6. Documentation — README §16.1 policy table updated.
7. Tests — V-11 unit scenarios for JWT access, refresh, and session paths.

## Deviations

| Item                                     | Notes                                                                                                                            |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| JWT access freshness                     | Implemented via optional composition callback (extends plan default of refresh-only; closes stale access window for starter kit) |
| `JwtAuthTokenService.refreshAuthSession` | Rejects with `REFRESH_ORCHESTRATION_REQUIRED`                                                                                    |
| Migration `0004`                         | Includes incidental outbox index DDL (additive)                                                                                  |

## Commands executed

```bash
npm run build
npm run build:api
npm run build:migrations
npm run lint
npm run test:unit -- jwt-auth-token
npm run test:unit -- refresh-auth-session
npm run test:unit -- session-auth-token
npm run test:unit
```

## Command results

| Command                                     | Result              | Conclusion                             |
| ------------------------------------------- | ------------------- | -------------------------------------- |
| `npm run build`                             | Exit 0              | All entrypoints compile                |
| `npm run build:api`                         | Exit 0              | API composition with new DI            |
| `npm run lint`                              | Exit 0              | Full lint gate passes                  |
| `npm run test:unit -- jwt-auth-token`       | 6 passed            | JWT access freshness + refresh covered |
| `npm run test:unit -- refresh-auth-session` | 3 passed            | Refresh orchestration covered          |
| `npm run test:unit -- session-auth-token`   | 4 passed            | Session stale version covered          |
| `npm run test:unit`                         | Exit 0 — 118 passed | Full unit suite green                  |

## Acceptance criteria self-check

| #     | Criterion                                                            | Status                                                                  |
| ----- | -------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| AC-1  | Freshness policy documented in README §16.1                          | Pass                                                                    |
| AC-2  | `users.auth_version`; domain/mapper/repository/`CurrentUser` aligned | Pass                                                                    |
| AC-3  | JWT tokens embed `authVersion` at login/refresh                      | Pass                                                                    |
| AC-4  | Refresh reloads user; rejects missing/mismatch                       | Pass                                                                    |
| AC-5  | Refresh issues tokens with fresh email/roles                         | Pass                                                                    |
| AC-6  | Session driver validates against current user/version                | Pass                                                                    |
| AC-7  | `incrementAuthVersion` available + README contract                   | Pass                                                                    |
| AC-8  | Optional high-risk endpoint check                                    | Pass — JWT access resolver wired at composition (Option A via callback) |
| AC-9  | `npm run build`, `npm run lint`, `npm run test:unit` pass            | Pass                                                                    |
| AC-10 | No `AuthModule` coupling to `IUserRepository`                        | Pass                                                                    |

## Remaining risks

- Downstream custom entrypoints must wire `resolveAccessUser` / `resolveSessionUser` for immediate access freshness.
- No in-repo callers of `incrementAuthVersion` until apps add admin/security flows.
- Session deploy invalidates existing Redis sessions (documented).

## Unverified areas

- V-11 manual HTTP scenarios (login → DB bump → refresh/`/auth/me`) — requires PostgreSQL + Redis bootstrap.
- `npm run test:int`.
- Production migration apply of `0004`.
