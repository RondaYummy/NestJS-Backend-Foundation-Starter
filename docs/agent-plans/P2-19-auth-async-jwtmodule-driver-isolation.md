---
issue_id: P2-19
status: approved
owner: human-approval-required
---

# P2-19 — Register JwtModule in `AuthModule.forRootAsync` only for JWT driver

## Source issue

- Backlog ID: `P2-19`
- Index: `docs/agent-backlog/INDEX.md`
- Full text: `docs/agent-backlog/NESTJS_STARTER_KIT_REQUIRED_FIXES.md` § P2-19
- Review source: `docs/agent-reports/full-review-2026-08-02.md`

## Current behavior

Confirmed on current `main` (inspected 2026-08-02):

1. `AuthModule.forRoot` (`libs/infrastructure/src/auth/auth.module.ts`) correctly imports `JwtModule.register({ secret })` **only** when `isJwtAuthOptions(options)` is true.
2. `AuthModule.forRootAsync` **always** adds `JwtModule.registerAsync(...)` to `imports`.
3. When resolved options are not JWT, the Jwt async factory returns `{ secret: 'session-driver-jwt-placeholder' }`.
4. `buildAsyncDriverProviders()` always injects Nest `JwtService` into the `TOKENS.AuthTokenService` factory, even for the session branch (session branch ignores the injected instance after the `isJwtAuthOptions` check).
5. Production composition uses only the async path: `AuthApplicationCompositionModule.register` → `AuthModule.forRootAsync` in `apps/api/src/composition/auth-application.module.ts`.
6. Existing specs cover sync driver isolation and async JWT happy-path (`JwtService` defined); there is **no** async session assertion that JwtModule / placeholder are absent (`libs/infrastructure/src/auth/auth.module.spec.ts`).

## Confirmed root cause

Nest `DynamicModule.imports` must be declared when `forRootAsync` is **called**, before `useFactory` resolves `AuthModuleOptions`. The current implementation therefore always wires `JwtModule` and uses a hardcoded placeholder secret for session mode so `JwtService` can still be constructed and injected.

That violates the starter portability rule: do not create both JWT and Session implementations / JWT wiring when only one driver is selected.

## Dependency/runtime flow

```text
AuthApplicationCompositionModule.register
  -> AuthModule.forRootAsync({ imports, inject, useFactory })
       -> AUTH_MODULE_OPTIONS (async factory)
       -> JwtModule.registerAsync  (ALWAYS today; placeholder secret when session)
       -> TOKENS.SessionStore factory  (null when JWT; RedisSessionStore when session)
       -> TOKENS.AuthTokenService factory
            injects JwtService always
            -> JwtAuthTokenService | SessionAuthTokenService

Desired (session):
  AuthModule.forRootAsync
    -> NO JwtModule import
    -> NO JwtService injection
    -> SessionAuthTokenService only

Desired (JWT):
  AuthModule.forRootAsync
    -> Jwt secret from resolved options only (no placeholder)
    -> JwtAuthTokenService issues/verifies tokens as today
```

## Goal

Align `forRootAsync` with sync `forRoot` driver isolation: session mode must not register `JwtModule`, must not register the placeholder secret, and must not inject `JwtService`. JWT mode via `forRootAsync` must keep issuing/verifying tokens. Sync `forRoot` behavior stays unchanged.

## Scope

- Change async provider/import graph in `AuthModule.forRootAsync` / `buildAsyncDriverProviders`.
- Extend unit/module tests for async session vs JWT isolation.
- Adjust composition-module assertions if they currently require a container-level `JwtService` that the chosen approach no longer registers.
- Minimal docs touch only if public AuthModule async behavior description becomes inaccurate (`docs/infrastructure-modules/README.md` AuthModule section).

## Out of scope

- P2-16 / P2-17 / P2-18 and any other backlog items.
- P2-21 (env schema requiring JWT secrets when `AUTH_DRIVER=session`) — related but separate.
- Changing sync `AuthModule.forRoot` JWT-only `JwtModule` registration (already correct).
- HTTP endpoint, OpenAPI, or Postman changes (none; see note below).
- Worker/Cron entrypoints (they do not register `AuthModule`).
- Redesigning `AuthModuleOptions`, `mapAppConfigToAuthOptions`, or Google SSO modules.
- Changing async export asymmetry (`SessionStore` always exported from `forRootAsync` today) unless required for DI after the Jwt change.

### HTTP / OpenAPI / Postman

This fix does **not** add or change HTTP endpoints. No OpenAPI decorator/schema updates and no `docs/postman/` collection updates are required. Do not run `npm run test:postman-coverage` as acceptance for this issue.

## Files to create

- None (tests extend existing `auth.module.spec.ts`; optional small helper stays in the same file).

## Files to modify

| Path | Symbols / responsibility |
| --- | --- |
| `libs/infrastructure/src/auth/auth.module.ts` | `AuthModule.forRootAsync`: remove unconditional `JwtModule.registerAsync` + `'session-driver-jwt-placeholder'`. `buildAsyncDriverProviders`: stop injecting `JwtService` on the session path; for JWT, obtain a `JwtService` only when `isJwtAuthOptions` (see Implementation steps — recommended approach A). Keep `forRoot` / `buildSyncDriverProviders` / `buildExports` behavior intact unless a tiny shared helper is extracted without behavior change. |
| `libs/infrastructure/src/auth/auth.module.spec.ts` | Add/extend coverage: `forRootAsync` + session options → `TOKENS.AuthTokenService` is `SessionAuthTokenService`; `JwtService` is **not** resolvable; string `'session-driver-jwt-placeholder'` must not appear in the returned dynamic module graph / Jwt registration. Keep JWT `forRootAsync` asserting `JwtAuthTokenService` and successful token-capable wiring. Preserve existing sync `forRoot` tests (AC-03). |
| `apps/api/src/composition/auth-application.module.spec.ts` | Today asserts `moduleRef.get(JwtService)` under default `AUTH_DRIVER=jwt` composition. Update assertion to match the chosen DI shape (e.g. `TOKENS.AuthTokenService` is JWT implementation, and/or `JwtService` only if approach still registers it for JWT). Do **not** expand into unrelated composition coverage. |
| `docs/infrastructure-modules/README.md` | AuthModule section: if it implies async always pulls Jwt, clarify that async registration instantiates only the selected driver branch and does not register Jwt wiring under session. Skip if docs already match after code change. |
| `docs/agent-plans/INDEX.md` | Register this plan row while `proposed` / in progress (planner hygiene; not production). |

## Files to delete

- None.

## Contract and DI changes

- **Public contracts** (`libs/contracts`): no changes.
- **`AuthModuleAsyncOptions` / `AUTH_MODULE_OPTIONS` / `isJwtAuthOptions`**: no required shape change for approach A.
- **DI behavior change (async only):**
  - Session: `JwtModule` not in `imports`; `JwtService` not a required inject dependency of `TOKENS.AuthTokenService`.
  - JWT: `JwtAuthTokenService` still constructed with a working `JwtService` configured from `authOptions.jwt.secret` (and existing per-call `secret` / `refreshSecret` overrides inside `JwtAuthTokenService` remain unchanged).
- **Composition root** `AuthApplicationCompositionModule`: no required registration API change if approach A is used (still `AuthModule.forRootAsync({...})`). Revisit only if human selects approach B (sync driver hint / split async APIs).

## Implementation steps

1. **Confirm Nest constraint in code comments (brief):** note that `imports` cannot be chosen from resolved async options; therefore async session isolation is achieved by not importing `JwtModule` and not injecting `JwtService` on the session path (approach A), unless human approves approach B.

2. **`AuthModule.forRootAsync`**
   - Remove `JwtModule.registerAsync` from the always-on `imports` array.
   - Keep `...(asyncOptions.imports ?? [])` and existing `assertAsyncRegistration`.
   - Delete the `'session-driver-jwt-placeholder'` branch entirely.

3. **`buildAsyncDriverProviders`**
   - Change `TOKENS.AuthTokenService` factory `inject` to `[AUTH_MODULE_OPTIONS, RedisService, TOKENS.SessionStore]` (no `JwtService`).
   - On JWT branch: `const jwtService = new JwtService({ secret: options.jwt.secret });` then `new JwtAuthTokenService(jwtService, options, new RedisJwtTokenStore(redis))` (same stores as today).
   - On session branch: unchanged `SessionAuthTokenService(sessionStore, options)` with existing null-guard.
   - Leave `TOKENS.SessionStore` async factory as-is (null for JWT).

4. **Do not alter** `forRoot` / `buildSyncDriverProviders` JWT `JwtModule.register` path (AC-03).

5. **Tests**
   - Async session: no `JwtService` in container; no placeholder secret string in module definition; `SessionAuthTokenService` selected.
   - Async JWT: `JwtAuthTokenService` selected; smoke that `JwtService` constructed for signing still works via `AuthTokenService` (existing unit tests on `JwtAuthTokenService` remain the deep behavior coverage).
   - Update `auth-application.module.spec.ts` JwtService assertion as needed.

6. **Docs** — only if README AuthModule claim would otherwise be false.

7. **Stop** if implementation would require env-schema changes (P2-21) or public `forRootAsync` signature changes without human approval of open question B.

### Recommended approach (A) — default for this plan

Construct `JwtService` inside the async JWT factory; never import `JwtModule` from `forRootAsync`. Semantically satisfies AC-01/AC-02 without a sync driver hint. Sync `forRoot` continues to use `JwtModule.register`.

### Alternate approach (B) — only if human requires literal `JwtModule` in async `imports`

Add a sync discriminator to async registration (e.g. required `driver: 'jwt' | 'session'` on `AuthModuleAsyncOptions`, or `forRootAsyncJwt` / `forRootAsyncSession`), then conditionally `imports.push(JwtModule.registerAsync(...))` only for JWT, and update `AuthApplicationCompositionModule` to pass the discriminator from config available at register time. Larger API surface; choose only if integrators must resolve Nest `JwtService` from `JwtModule` under async JWT.

## Migration and rollout concerns

- No database migrations.
- No env var changes.
- Behavioral change for session deployments: Nest container will no longer expose `JwtService` / JwtModule from Auth async registration (desirable). Integrators who incorrectly injected `JwtService` under session would start failing at DI resolve — treat as fixing a footgun.
- JWT async: if any external code relied on `moduleRef.get(JwtService)` after `forRootAsync`, approach A may break that (composition spec today). Document in risks; prefer asserting `TOKENS.AuthTokenService` instead.
- Backward compatible for the public auth token port (`TOKENS.AuthTokenService`) used by use cases.

## Targeted verification

```bash
npm run test:unit -- --testPathPatterns=auth.module.spec
npm run test:module -- --testPathPatterns=auth.module.spec
npm run test:module -- --testPathPatterns=auth-application.module.spec
npm run build:api
```

Optional focused grep after change:

```bash
rg "session-driver-jwt-placeholder" libs/infrastructure/src/auth
```

Expect zero matches.

## Full verification

```bash
npm run build
npm run lint
npm run test:unit
npm run test:module
```

Bootstrap API only if local PostgreSQL/Redis are available; missing infra is not a defect. No Postman/OpenAPI verification required.

## Acceptance criteria

- **AC-01:** With session options via `AuthModule.forRootAsync`, `JwtModule` is not imported and `'session-driver-jwt-placeholder'` is not registered; `JwtService` is not injected/required for the session `AuthTokenService` path.
- **AC-02:** JWT options via `forRootAsync` still produce `JwtAuthTokenService` that can issue/verify tokens with the configured secrets (no placeholder).
- **AC-03:** Sync `AuthModule.forRoot` JWT-only `JwtModule` behavior and existing sync tests remain intact.
- **AC-04:** Unit/module coverage asserts async driver isolation (session: no Jwt wiring; JWT: JWT token service selected).

## Risks

- Nest DI consumers expecting container-level `JwtService` after `forRootAsync` (JWT) break under approach A.
- Manually constructing `JwtService` must pass the same default secret JwtModule would have registered; `JwtAuthTokenService` already passes explicit secrets on `signAsync`/`verifyAsync`, so risk is low but should be smoke-tested.
- Over-scoping into P2-21 env validation must be avoided.
- Approach B changes the public AuthModule async API and composition root — higher churn.

## Rollback strategy

Revert the single commit touching `auth.module.ts` and the adjusted specs/docs. No data migration rollback. Session deployments return to placeholder JwtModule wiring (previous behavior).

## Open questions requiring human decision

1. **Approach A vs B:** Approve recommended approach A (no `JwtModule` in `forRootAsync` imports; construct `JwtService` only inside the JWT async factory), or require approach B (sync driver discriminator / split async APIs so `JwtModule.registerAsync` appears literally in `imports` for JWT only)?
2. **Container `JwtService` under async JWT:** Is it acceptable that `moduleRef.get(JwtService)` may fail after `forRootAsync` even for JWT (approach A), with integrators using only `TOKENS.AuthTokenService`? Or must async JWT still register a Nest-resolvable `JwtService` provider (without using `JwtModule` / without placeholder on session)?
