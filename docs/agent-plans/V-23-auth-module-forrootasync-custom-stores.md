---
issue_id: V-23
status: approved
owner: human-approval-required
---

# V-23 — `AuthModule.forRootAsync` supports custom auth stores without RedisModule

## Source issue

`docs/agent-backlog/NESTJS_STARTER_KIT_REQUIRED_FIXES.md` — verification backlog row **V-23**:

> AuthModule.forRootAsync supports custom auth stores without RedisModule

**Linked implementation defect:** **P2-17** (`docs/agent-backlog/NESTJS_STARTER_KIT_REQUIRED_FIXES.md` — section P2-17, lines ~1431–1496).

**INDEX note:** `docs/agent-backlog/INDEX.md` is deleted on branch `main` (staged); V-23 remains listed in the verification table and P2-17 in the implementation table within `NESTJS_STARTER_KIT_REQUIRED_FIXES.md`.

**Investigation (2026-06-24, branch `main`):** verification scenario is **not stale**. P1-07 delivered sync `forRoot` custom-store support via `AuthModuleRegistrationOptions.providers`, but async registration — the primary production path — still lacks an equivalent extension point. V-23 cannot return `approved` until **P2-17** is implemented and independently verified.

**Prerequisite plan:** No `docs/agent-plans/P2-17-*.md` exists yet; P2-17 must be planned, human-approved, and implemented before V-23 verification proceeds.

## Current behavior

1. **`AuthModule.forRoot(options, registration?)`** (`libs/infrastructure/src/auth/auth.module.ts`, symbols `AuthModule.forRoot`, `AuthModuleRegistrationOptions`) accepts optional `registration.providers` and `registration.imports`. Custom `TOKENS.JwtTokenStore` / `TOKENS.SessionStore` providers skip default Redis store registration (P1-07 / V-17 complete).

2. **`AuthModule.forRootAsync(asyncOptions)`** accepts only:

   ```ts
   type AuthModuleAsyncOptions = Pick<FactoryProvider<AuthModuleOptions>, 'useFactory' | 'inject'> & {
     imports?: ModuleMetadata['imports'];
   };
   ```

   There is **no** `providers` field on async options.

3. **`assertAsyncRegistration(asyncOptions)`** (lines 172–180) throws when `imports` is empty **unconditionally**. Unlike sync `assertSyncRegistration`, it does **not** inspect custom store providers — the custom-store-without-Redis path is blocked at registration time.

4. **`buildAsyncDriverProviders()`** (lines 241–257) always registers a single factory provider for `TOKENS.AuthTokenService` with:

   ```ts
   inject: [AUTH_MODULE_OPTIONS, JwtService, RedisService],
   useFactory: (options, jwtService, redis) => {
     // always new RedisJwtTokenStore(redis) or new RedisSessionStore(redis)
   },
   ```

   Custom stores cannot be supplied; `RedisService` is always required at DI resolution time.

5. **`auth.module.spec.ts`** includes:
   - positive `forRoot` custom `TOKENS.JwtTokenStore` without Redis imports (lines 86–107);
   - positive `forRootAsync` with `MockRedisModule` (lines 109–124);
   - negative `forRootAsync` without imports (lines 126–132);
   - **no** `forRootAsync` custom-store-without-Redis test.

6. **Production composition** (`apps/api/src/composition/auth-application.module.ts`) uses `forRootAsync` with explicit `redisModule` in `imports` — unaffected by default; the defect is on the **public async registration surface** for consumers who want non-Redis stores.

7. **Documentation gap:**
   - `docs/infrastructure-modules/README.md` (line 113) documents custom store override **only for `forRoot`** via `registration.providers`; no `forRootAsync` example.
   - `EXAMPLES.md` §13 shows `forRootAsync` with `redisModule` only; no custom async store example.

## Confirmed root cause

Same as P2-17: `AuthModule.forRootAsync()` is the primary production registration API (used by `AuthApplicationCompositionModule`, deprecated `InfrastructureModule`, `forRootFromAppConfig`) but exposes no typed `providers` extension point. `buildAsyncDriverProviders()` hardcodes Redis-backed store construction and `RedisService` injection, while `assertAsyncRegistration` requires `imports` even when a consumer intends to supply custom `TOKENS.JwtTokenStore` / `TOKENS.SessionStore` without `RedisModule`. Sync and async registration contracts are asymmetric despite the starter kit claiming adapter replaceability without editing module internals.

## Dependency/runtime flow

### Current (broken — V-23 would fail today)

```text
Consumer composition root
  -> AuthModule.forRootAsync({
       // no imports — blocked by assertAsyncRegistration ❌
       useFactory: () => jwtOptions,
       providers: [{ provide: TOKENS.JwtTokenStore, useValue: customStore }],
       // providers field does not exist on AuthModuleAsyncOptions ❌
     })

Even if assertAsyncRegistration were bypassed:
  -> buildAsyncDriverProviders()
       inject: [AUTH_MODULE_OPTIONS, JwtService, RedisService]
       useFactory -> new RedisJwtTokenStore(redis)  // ignores custom store ❌
```

### Expected after P2-17 (V-23 pass condition)

```text
Consumer composition root
  -> AuthModule.forRootAsync({
       useFactory: () => jwtOptions,
       providers: [{ provide: TOKENS.JwtTokenStore, useValue: customStore }],
     })
       assertAsyncRegistration: imports not required when custom store present ✓
       providers: [..., customStore, JwtAuthTokenService, TOKENS.AuthTokenService] ✓
       buildAsyncDriverProviders: skips Redis factory when custom store supplied ✓
       compile() without RedisModule ✓
```

Default Redis path unchanged:

```text
  -> AuthModule.forRootAsync({
       imports: [redisModule],
       useFactory: () => jwtOptions,
     })
       -> RedisJwtTokenStore / RedisSessionStore via RedisService ✓
```

## Goal

Independently confirm — with runtime DI evidence, not static inspection alone — that `AuthModule.forRootAsync()` supports custom JWT/session store providers without requiring `RedisModule` in `imports`, mirroring the sync `forRoot` contract; default Redis-backed behavior remains when no custom store is supplied and `imports` includes `redisModule`; documentation and unit tests demonstrate the async override path.

## Scope

| Activity                              | Responsibility         | Notes                                                                                          |
| ------------------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------- |
| Extend async registration contract    | **P2-17 implementer**  | Add `providers` to `AuthModuleAsyncOptions`; update assert/build logic                         |
| Add async custom-store unit tests     | **P2-17 implementer**  | JWT and session drivers; negative fail-fast without imports when default stores used             |
| Update docs                           | **P2-17 implementer**  | `docs/infrastructure-modules/README.md`, `EXAMPLES.md`                                         |
| Create P2-17 implementation plan      | **Human / planner**    | `docs/agent-plans/P2-17-auth-module-forrootasync-store-overrides.md` — approve before coding   |
| Independent verification              | **V-23 verifier**      | Inspect diff, run commands, write `docs/agent-reports/V-23-verification.md`                      |

## Out of scope

- Implementing the P2-17 fix (separate plan; prerequisite for V-23).
- **P1-07 / V-17** sync `forRoot` Redis explicit imports — already implemented; do not re-verify unless regression found.
- **P1-06 / V-16** — `TOKENS.UserRepository` visibility inside nested `JwtModule.registerAsync` (separate issue).
- Changing `IJwtTokenStore` / `ISessionStore` contracts or `TOKENS` definitions in `libs/contracts/`.
- Replacing Redis stores in production API/Worker/Cron entrypoints (starter kit keeps Redis default).
- Extracting a separate `AuthRedisStoreModule`.
- Full HTTP auth flow testing (login/register/refresh) — covered by V-11, V-18.
- Marking P2-17 or V-23 resolved in backlog without implementation + verification evidence.

## Files to create

| File                                      | Symbol / responsibility                                                        |
| ----------------------------------------- | ------------------------------------------------------------------------------ |
| `docs/agent-plans/P2-17-auth-module-forrootasync-store-overrides.md` | P2-17 implementation plan (prerequisite; not created by V-23 planner) |
| `docs/agent-reports/P2-17-implementation.md` | Implementer report (optional but recommended)                          |
| `docs/agent-reports/V-23-verification.md` | Independent verification report (verifier output)                              |

## Files to modify

None during V-23 verification planning. Verifier inspects changes from P2-17:

| File                                               | What to verify                                                                                                                                                                      |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `libs/infrastructure/src/auth/auth.module.ts`      | `AuthModuleAsyncOptions.providers`; `assertAsyncRegistration` custom-store bypass; `forRootAsync` merges `providers`; `buildAsyncDriverProviders` accepts options and skips Redis |
| `libs/infrastructure/src/auth/auth.module.spec.ts` | `forRootAsync` compiles with custom `TOKENS.JwtTokenStore` / `TOKENS.SessionStore` without `MockRedisModule`; existing Redis-path and fail-fast tests still pass                  |
| `docs/infrastructure-modules/README.md`            | Auth section documents async custom store via `providers` on `forRootAsync`                                                                                                       |
| `EXAMPLES.md`                                      | §13 or cross-link includes `forRootAsync` custom store example                                                                                                                      |

**Expected unchanged (unless P2-17 explicitly requires):**

| File                                               | Reason                                                                                          |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `apps/api/src/composition/auth-application.module.ts` | Production uses default Redis stores with explicit `redisModule` — no change expected      |
| `libs/infrastructure/src/infrastructure.module.ts`    | Deprecated facade; same default Redis pattern                                                 |
| `libs/contracts/src/tokens.ts`                        | No new tokens required if reusing `TOKENS.JwtTokenStore` / `TOKENS.SessionStore`              |

## Files to delete

None.

## Contract and DI changes

- **Verifier expectation after P2-17:** `AuthModuleAsyncOptions` gains `providers?: Provider[]` (or equivalent typed registration field aligned with `AuthModuleRegistrationOptions`).
- **`assertAsyncRegistration`:** when default Redis stores would be used, require non-empty `imports` (fail-fast); when custom `TOKENS.JwtTokenStore` or `TOKENS.SessionStore` provider is present in `providers`, allow empty `imports`.
- **`buildAsyncDriverProviders`:** must not inject `RedisService` or instantiate `RedisJwtTokenStore` / `RedisSessionStore` when corresponding custom store provider is supplied; prefer mirroring sync `buildSyncDriverProviders` branching (`JwtAuthTokenService` / `SessionAuthTokenService` class providers with Nest DI).
- **Default behavior:** unchanged — `forRootAsync({ imports: [redisModule], useFactory })` continues to produce Redis-backed stores.
- **Breaking change:** none for existing production callers that already pass `redisModule` in `imports`.
- **`forRootAsync` exports:** currently `[TOKENS.PasswordHasher, TOKENS.AuthTokenService]` only (line 95). If custom store consumers need exported store tokens, P2-17 may align with sync `buildExports` — verify against P2-17 plan; not a V-23 blocker if documented.

## Implementation steps

V-23 is a **verification issue**. Steps below split **P2-17 implementer** work (prerequisite) and **V-23 verifier** work.

### Prerequisite — P2-17 implementer steps

**Gate:** P2-17 plan frontmatter must be `status: approved` before coding.

1. **Extend async options type** (`libs/infrastructure/src/auth/auth.module.ts`, symbol `AuthModuleAsyncOptions`):
   - Add `providers?: Provider[]` mirroring `AuthModuleRegistrationOptions`.
   - Optionally export `AuthModuleAsyncOptions` from module public surface if other modules need the type.

2. **Update `assertAsyncRegistration(asyncOptions)`**:
   - Reuse or share `hasCustomStoreProvider(providers, TOKENS.JwtTokenStore | TOKENS.SessionStore)` logic.
   - Allow empty `imports` when a custom store provider is present (same semantics as sync `assertSyncRegistration`).
   - Keep fail-fast when `imports` empty and default Redis stores would be used.
   - Error message should mention both `imports: [redisModule]` and custom store `providers` as alternatives (parallel sync messages).

3. **Refactor `buildAsyncDriverProviders`**:
   - Accept `asyncOptions: AuthModuleAsyncOptions` (or `providers` array).
   - When custom `TOKENS.JwtTokenStore` in `providers`: register `JwtAuthTokenService` + `{ provide: TOKENS.AuthTokenService, useExisting: JwtAuthTokenService }` — **do not** use factory that `new RedisJwtTokenStore(redis)`.
   - When custom `TOKENS.SessionStore` in `providers`: register `SessionAuthTokenService` + `TOKENS.AuthTokenService` alias — **do not** use `RedisSessionStore`.
   - When no custom store: retain current Redis factory path with `inject: [AUTH_MODULE_OPTIONS, JwtService, RedisService]`.
   - **Note:** async options are resolved at runtime via `useFactory`; custom-store branch cannot inspect driver at assert time for session vs JWT — use presence of specific store token in `providers` (same as sync).

4. **Wire `forRootAsync`**:
   - Spread `...(asyncOptions.providers ?? [])` into `providers` array before or after driver providers (order must not shadow custom store token).
   - Pass `asyncOptions` into `buildAsyncDriverProviders`.

5. **Unit tests** (`libs/infrastructure/src/auth/auth.module.spec.ts`):
   - Add `forRootAsync compiles without Redis imports when a custom JwtTokenStore is provided` — mirror sync test at lines 86–107.
   - Add session-driver equivalent with custom `TOKENS.SessionStore`.
   - Confirm existing `forRootAsync` Redis-path test (lines 109–124) and fail-fast test (lines 126–132) still pass.
   - Ensure no post-registration `dynamicModule.imports` / `providers` mutation workarounds.

6. **Documentation**:
   - `docs/infrastructure-modules/README.md` — add `forRootAsync` example with `providers: [{ provide: TOKENS.JwtTokenStore, useValue: ... }]` and no `redisModule`.
   - `EXAMPLES.md` §13 — add or cross-link async custom store snippet per P2-17 acceptance criteria.

7. **Implementer verification** (before handoff to V-23):
   - `npx jest --config jest.unit.config.ts --testPathPattern=auth.module.spec`
   - `npm run build`
   - `npm run lint`

### V-23 verifier steps

**Prerequisite gate:**

1. Confirm **P2-17 plan** is `status: approved` and implementation merged/available.
2. Confirm P2-17 implementation exists (inspect `git diff`; read `docs/agent-reports/P2-17-implementation.md` if present — do not trust without code inspection).
3. If P2-17 is not implemented, stop and return verdict **`changes-required`**: underlying defect still open.

**Step 1 — Scope and diff review**

1. Run `git status` and `git diff`.
2. Confirm only P2-17-scoped files changed (primarily `auth.module.ts`, `auth.module.spec.ts`, docs).
3. Confirm no unrelated changes to `AuthApplicationCompositionModule` repository wiring (P1-06 scope).
4. In `auth.module.ts`, confirm:
   - `AuthModuleAsyncOptions` includes `providers`;
   - `assertAsyncRegistration` allows custom store without `imports`;
   - `forRootAsync` merges `asyncOptions.providers`;
   - `buildAsyncDriverProviders` skips Redis when custom store supplied.

**Step 2 — Static DI trace**

Positive path (JWT, primary V-23 scenario):

```text
Test.createTestingModule({
  imports: [
    AuthModule.forRootAsync({
      useFactory: () => jwtOptions,
      providers: [{ provide: TOKENS.JwtTokenStore, useValue: customStore }],
    }),
  ],
})
  -> assertAsyncRegistration: custom store present, no imports required ✓
  -> providers include customStore, JwtAuthTokenService ✓
  -> no RedisService inject in driver branch ✓
  -> compile() succeeds ✓
```

Negative path (default Redis, no imports):

```text
AuthModule.forRootAsync({ useFactory: () => jwtOptions })
  -> assertAsyncRegistration throws Error naming RedisModule/imports ✓
```

Repeat trace for session driver with custom `TOKENS.SessionStore`.

**Step 3 — Targeted unit verification (mandatory)**

```bash
npm ci
npx jest --config jest.unit.config.ts --testPathPattern=auth.module.spec
```

**Expected:** all AuthModule tests pass; new `forRootAsync` custom-store tests present; no module mutation workarounds.

**Step 4 — Build and lint**

```bash
npm run build
npm run lint
```

Record exit codes. Build-only pass is **insufficient** (defect is runtime DI/portability).

Optional:

```bash
npm run build:api
```

Confirms production composition still compiles (should be unchanged).

**Step 5 — Documentation alignment**

1. `docs/infrastructure-modules/README.md` — custom store documented for **both** `forRoot` and `forRootAsync`.
2. `EXAMPLES.md` §13 — async custom store example or explicit cross-link.
3. Prose does not imply `forRootAsync` always requires `RedisModule` when custom stores are used.

**Step 6 — Write verification report**

Create `docs/agent-reports/V-23-verification.md` using structure from `.cursor/skills/change-verification/SKILL.md`:

```markdown
# V-23 — Independent verification

## Verdict
approved | changes-required | not-confirmed

## Scope checked
## Root-cause assessment
## Acceptance criteria matrix
## Dependency and DI verification
## Commands executed
## Findings
## Documentation alignment
## Remaining risks
## Unverified areas
```

Include per-command records: Command / Result / Conclusion.

## Migration and rollout concerns

None for verification. P2-17 requires no database migration or env changes. Existing production callers passing `redisModule` in `forRootAsync` imports remain compatible. New capability is opt-in via `providers`.

## Targeted verification

| Command                                                                    | Expected result                                              |
| -------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `npm ci`                                                                   | Clean install succeeds                                       |
| `npx jest --config jest.unit.config.ts --testPathPattern=auth.module.spec` | Passes; primary V-23 evidence                                |
| Code review of `auth.module.ts`                                            | Async `providers`, assert bypass, non-Redis driver branch    |
| Code review of `auth.module.spec.ts`                                       | `forRootAsync` custom store without `MockRedisModule`        |

## Full verification

| Command             | Expected result                                                       |
| ------------------- | --------------------------------------------------------------------- |
| `npm run build`     | Full monorepo compiles                                                |
| `npm run lint`      | No new lint errors from P2-17 changes                                 |
| `npm run test:unit` | Full unit suite passes (document pre-existing unrelated failures)     |
| `npm run build:api` | API compiles — composition root unchanged                             |

## Acceptance criteria

Mapped to backlog P2-17 / V-23:

| ID   | Criterion                                                                                                                              | Verification method                          | Pass condition                                                                                    |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| AC-1 | P2-17 fix implemented and scoped correctly                                                                                             | Diff + scope review                          | Only planned files/symbols changed; no P1-06 bleed                                                |
| AC-2 | `AuthModule.forRootAsync({ useFactory, providers: [custom JwtTokenStore] })` compiles without `RedisModule`                            | Targeted spec `compile()`                    | Exit 0; `TOKENS.AuthTokenService` is `JwtAuthTokenService`; store resolves to custom instance     |
| AC-3 | Session driver: custom `TOKENS.SessionStore` without Redis imports                                                                     | Targeted spec                                | `SessionAuthTokenService` resolves; custom store injected                                         |
| AC-4 | Default Redis path unchanged                                                                                                           | Existing spec lines 109–124                    | `forRootAsync({ imports: [MockRedisModule], useFactory })` still passes                           |
| AC-5 | Fail-fast when default stores used without imports                                                                                     | Spec lines 126–132 (updated message if needed) | Registration-time error naming `imports` / `RedisModule`                                          |
| AC-6 | Consumer can override stores without editing `auth.module.ts` internals                                                                | Code review                                  | Public `providers` on async options; no fork of infrastructure module required                    |
| AC-7 | Docs show async custom store pattern                                                                                                   | Review README + EXAMPLES                     | `forRootAsync` + `providers` example present                                                      |
| AC-8 | `npm run build` passes                                                                                                                 | Execute and record                           | Exit 0                                                                                            |
| AC-9 | `npm run lint` passes                                                                                                                  | Execute and record                           | Exit 0 or only pre-existing unrelated failures documented                                         |
| AC-10| Production entrypoint unchanged unless explicitly required                                                                             | Diff review of `auth-application.module.ts`  | Still passes `redisModule` for default Redis stores                                               |

**Verdict rules:**

- **`approved`** — AC-1 through AC-9 pass; AC-10 confirmed or N/A.
- **`changes-required`** — any of AC-1–AC-7 fail, or async registration still requires `RedisModule` when custom store is supplied, or `buildAsyncDriverProviders` still hardcodes Redis.
- **`not-confirmed`** — targeted spec or build could not run (environment failure unrelated to code).

## Risks

1. **False approval from build-only checks** — `npm run build` passes on unfixed `main`; targeted `auth.module.spec.ts` is mandatory.
2. **Async/sync asymmetry persists** — approving V-17 custom-store sync tests while async path remains broken; V-23 must explicitly test `forRootAsync`.
3. **Factory vs class provider divergence** — async Redis path uses factory; custom path may use class providers; verifier must confirm both compile and behave consistently.
4. **Custom store detection gaps** — `hasCustomStoreProvider` only checks `provide === token`; verify `useValue`, `useClass`, `useExisting`, `useFactory` forms if documented.
5. **Driver unknown at registration time** — assert logic cannot require JWT store when session driver selected via async factory; store-token presence in `providers` is the correct gate (same as sync).
6. **P2-17 plan not approved** — implementation must not begin until human approves P2-17 plan.
7. **Exports mismatch** — if custom store consumers expect `TOKENS.JwtTokenStore` exported from async module, current static exports may be insufficient; document under unverified if not addressed by P2-17.

## Rollback strategy

Verification is read-only. If verdict is `changes-required`, revert to P2-17 implementer — no verifier code changes.

P2-17 rollback: revert `auth.module.ts` / spec / doc changes; production entrypoints unaffected.

## Open questions requiring human decision

1. **P2-17 plan creation** — should a dedicated `docs/agent-plans/P2-17-auth-module-forrootasync-store-overrides.md` be created and approved before implementation, or may implementer proceed from backlog section alone?
2. **Verification ordering** — must V-23 wait for a separate P2-17 verification report, or is V-23 the canonical verification for this defect?
3. **Async options shape** — reuse `AuthModuleRegistrationOptions.providers` via shared type / intersection, or duplicate `providers` on `AuthModuleAsyncOptions` only?
4. **Session driver coverage** — is JWT custom-store spec sufficient for V-23 approval, or must session driver custom-store case be mandatory?
5. **`forRootAsync` exports** — should P2-17 align async `exports` with sync `buildExports` (include store token when applicable)?
6. **Runtime bootstrap** — is targeted DI spec sufficient for `approved`, or is manual isolated Nest bootstrap with real custom store implementation mandatory?
