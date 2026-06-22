# P1-06 — Implementation report

## Verdict

implemented

## Approved plan

`docs/agent-plans/P1-06-user-repository-di-visibility.md` (`status: approved`)

## Changed files

| Path | Change |
| ---- | ------ |
| `apps/api/src/composition/auth-application.module.ts` | Hoisted `repositoriesModule`; passed into `AuthModule.forRootAsync({ imports })` and reused in composition `imports` |
| `apps/api/src/composition/auth-application.module.spec.ts` | New DI regression spec for composition bootstrap |
| `docs/infrastructure-modules/README.md` | Optional guidance note under `AuthModule` for `TOKENS.UserRepository` import visibility |

## Completed steps

1. **`auth-application.module.ts`** — Created `const repositoriesModule = RepositoriesModule.register({ imports: [drizzleModule] })`; added `repositoriesModule` to `AuthModule.forRootAsync` imports; replaced inline `RepositoriesModule.register(...)` in composition `imports` with the same variable.
2. **`auth-application.module.spec.ts`** — Added composition-level compile test with mocked `ioredis`, typed `RedisModule`/`DrizzleModule`, minimal test env for `InfrastructureConfigModule`, `AppLogger` override, and assertions for `JwtService`, `TOKENS.UserRepository`, and `TOKENS.AuthTokenService`.
3. **`docs/infrastructure-modules/README.md`** — Documented that composition roots injecting `TOKENS.UserRepository` into `AuthModule.forRootAsync` must include `RepositoriesModule.register(...)` in `imports`.

## Deviations

None. Scope matches the approved plan.

- JWT-driver spec only (session-driver case deferred per plan open question; one JWT case is sufficient for the DI defect).
- `npm run start:api` not executed (optional per plan; targeted DI spec is primary evidence).

## Commands executed

```bash
npm run test:unit -- apps/api/src/composition/auth-application.module.spec.ts
npm run build:api
npm run lint
npm run test:unit
```

## Command results

| Command | Result | Conclusion |
| ------- | ------ | ---------- |
| `npm run test:unit -- apps/api/src/composition/auth-application.module.spec.ts` | Exit 0 — 1 test passed | Composition DI regression spec passes; `TOKENS.UserRepository` resolves in Auth/JWT subgraph |
| `npm run build:api` | Exit 0 | API compiles |
| `npm run lint` | Exit 0 | No new lint errors |
| `npm run test:unit` | Exit 0 — 24 suites, 119 tests passed | Full unit suite green |

## Acceptance criteria self-check

| ID | Criterion | Status |
| -- | --------- | ------ |
| AC-1 | API auth composition bootstrap completes without DI error for `TOKENS.UserRepository` | Pass — targeted spec `compile()` succeeds |
| AC-2 | `JWT_MODULE_OPTIONS` resolves in Nest runtime | Pass — `moduleRef.get(JwtService)` succeeds |
| AC-3 | Single `RepositoriesModule.register(...)` instance per composition root | Pass — one `const repositoriesModule` reused in Auth imports and composition imports |
| AC-4 | `npm run build:api` passes | Pass |
| AC-5 | Targeted DI test passes | Pass |
| AC-6 | `npm run lint` passes | Pass |

## Remaining risks

- Session-driver DI path not covered by a dedicated spec (JWT case exercises the same `TOKENS.UserRepository` visibility defect).
- `DrizzleModule.forRoot` may open a pool during compile; spec calls `moduleRef.close()` to mitigate open handles.

## Unverified areas

- `npm run start:api` with live PostgreSQL + Redis (optional end-to-end bootstrap).
- `npm run test:int`.
