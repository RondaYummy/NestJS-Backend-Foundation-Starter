---
task_id: TASK-008
specification: docs/agent-tasks/TASK-008-rate-limiter-typed-defaults.md
status: approved
owner: human-approval-required
---

# TASK-008 — Implementation plan

## Approved specification

- Specification: `docs/agent-tasks/TASK-008-rate-limiter-typed-defaults.md` (`status: approved`).
- Intent: make `RateLimiterModule` accept typed default limits via `register` /
  `registerAsync`, and make `RateLimiterGuard` resolve defaults from an injected
  options token instead of `AppConfigService`. Preserve `@RateLimit(...)` decorator
  override precedence and the `auth:` keyPrefix branch. Map
  `AppConfigService.rateLimit()` → module options only at the composition roots.
  No HTTP/OpenAPI contract change (behavior-preserving refactor).
- Source of truth for behavior: FR-01..FR-08, NFR-01..NFR-03, AC-01..AC-08.

## Current implementation

Revalidated against the current branch (`git status`: only the untracked
TASK-008/009/010 specs + staged TASK-008 spec; `git diff`: empty — no production
changes in flight).

- `libs/infrastructure/src/rate-limiter/rate-limiter.guard.ts`
  - Injects `AppConfigService` and `TOKENS.RateLimiter` + `Reflector`.
  - Reads decorator options via `reflector.getAllAndOverride(RATE_LIMIT_KEY, ...)`.
  - Default fallback:

```42:48:libs/infrastructure/src/rate-limiter/rate-limiter.guard.ts
    const limit =
      options?.limit ??
      (isAuthEndpoint ? this.config.rateLimit().authMax : this.config.rateLimit().max);

    const ttlSeconds =
      options?.ttlSeconds ??
      (isAuthEndpoint ? this.config.rateLimit().authTtl : this.config.rateLimit().ttl);
```

  - `isAuthEndpoint = keyPrefix.startsWith('auth:')`; sets `RateLimit-*` headers and
    throws `HttpException` 429 with `retryAfterSeconds` when not allowed.

- `libs/infrastructure/src/rate-limiter/rate-limiter.module.ts`
  - Only `register({ imports? })`; provides `RedisRateLimiter`, `RateLimiterGuard`,
    `{ provide: TOKENS.RateLimiter, useExisting: RedisRateLimiter }`; exports
    `TOKENS.RateLimiter`, `RateLimiterGuard`.

- `libs/infrastructure/src/rate-limiter/rate-limit.decorator.ts`
  - `RATE_LIMIT_KEY = 'rateLimit'`; `RateLimitOptions = { keyPrefix: string; limit?: number; ttlSeconds?: number }`;
    `RateLimit(options)` = `SetMetadata`.

- `libs/contracts/src/rate-limiter/rate-limiter.ts`
  - `IRateLimiter.check({ key, limit, ttlSeconds }) => { allowed, remaining, resetAt }`.
  - Token: `libs/contracts/src/tokens.ts` line 17 → `RateLimiter: Symbol('IRateLimiter')`.

- `apps/api/src/api.module.ts`
  - Registers `RateLimiterModule.register({ imports: [redisModule, InfrastructureConfigModule] })`
    (line 86) and lists `RateLimiterGuard` in `providers` (line 90). Controllers apply
    it by class reference via `@UseGuards(RateLimiterGuard)`, so ApiModule instantiates
    its own guard copy in ApiModule's injector scope.

- `libs/infrastructure/src/infrastructure.module.ts` (deprecated `InfrastructureModule` facade)
  - Registers `RateLimiterModule.register({ imports: [redisModule, InfrastructureConfigModule] })`
    (line 100) and exports `RateLimiterModule` (line 128).

- `AppConfigService.rateLimit()` → `{ ttl, max, authTtl, authMax }`
  (`libs/infrastructure/src/config/app-config.service.ts` line 55 / 93-95).
  Env source (`libs/infrastructure/src/config/env.schema.ts` lines 67-70):
  `RATE_LIMIT_TTL=60`, `RATE_LIMIT_MAX=100`, `RATE_LIMIT_AUTH_TTL=60`,
  `RATE_LIMIT_AUTH_MAX=5`, assembled at
  `libs/infrastructure/src/config/infrastructure-config.module.ts` lines 89-93.

- Consumers of `@RateLimit`/`RateLimiterGuard`: `apps/api/src/controllers/auth.controller.ts`,
  `sessions.controller.ts`, `google-auth.controller.ts` — all use `auth:*` prefixes with
  per-endpoint `keyPrefix`/`limit`/`ttlSeconds` overrides.

Reference pattern to mirror (A-02): `libs/infrastructure/src/health/health.module.ts` +
`libs/infrastructure/src/health/health.module-options.ts` implement exactly the
`register` / `registerAsync` + `HEALTH_MODULE_OPTIONS` token + private
`buildDynamicModule(...)` shape this plan reuses. Mail/Storage/Logger/Redis/Drizzle use
the `forRoot`/`forRootAsync` + `<NAME>_MODULE_OPTIONS` naming convention; since FR-01 and
A-02 explicitly reference `register`/`registerAsync` and Health, this plan uses the
Health `register`/`registerAsync` naming (not `forRoot`) for consistency with the spec.

There is no barrel/index in `libs/infrastructure/src/rate-limiter/`, so no re-export file
needs updating.

## Architecture decision

Introduce a dedicated typed options token for the rate limiter and inject it into the
guard, mirroring the Health module precisely:

1. New options contract file `rate-limiter.module-options.ts` exporting a
   `RateLimiterModuleOptions` type and a `RATE_LIMITER_MODULE_OPTIONS` DI token.
2. `RateLimiterModule.register(options)` requires typed `defaults`; a new
   `registerAsync(asyncOptions)` provides the same options via a factory. Both use a
   shared private `buildDynamicModule(imports, optionsProvider)` helper. The module
   additionally **exports** `RATE_LIMITER_MODULE_OPTIONS` so the guard can be resolved
   both inside `RateLimiterModule` and inside `ApiModule` (which instantiates its own
   guard copy for `@UseGuards(RateLimiterGuard)`).
3. `RateLimiterGuard` injects `RATE_LIMITER_MODULE_OPTIONS` instead of
   `AppConfigService`; the required constructor dependency makes a missing options
   factory fail fast at DI resolution (no silent disable — satisfies the security note).
4. A new mapper `mapAppConfigToRateLimiterOptions(config)` lives beside the other
   `mapAppConfigTo*` functions and is used by both composition roots (`ApiModule` and
   the deprecated `InfrastructureModule` facade) via `registerAsync`. The rate-limiter
   module itself never imports `AppConfigService`/`InfrastructureConfigModule`
   (satisfies FR-05, NFR-02).

Resolution of the spec's open questions (recommendations; final call is human):

- **Open question #1 — breaking `register` vs backward-compatible overload:**
  Recommend making `register` require typed `defaults` (a signature change of the
  registration API, explicitly permitted by the spec's "Public API and interface
  impact"). Both current call sites (`ApiModule`, `InfrastructureModule` facade) are
  migrated to `registerAsync` in the same task, so no external breakage in-repo.
  Exported tokens/providers stay backward compatible (NFR-03/FR-07): `TOKENS.RateLimiter`
  and `RateLimiterGuard` exports are unchanged; only a new token export is added. This
  matches Health, whose `register` already requires a typed field (`checkTimeoutMs`).
- **Open question #2 — deprecated AppConfig-backed helper:**
  Recommend **not** adding an AppConfig-backed helper (e.g. no
  `registerFromAppConfig`). Both composition roots use `registerAsync` +
  `mapAppConfigToRateLimiterOptions`, keeping the module free of `AppConfigService`
  coupling. (Mail's deprecated `forRootFromAppConfig` is an anti-pattern we deliberately
  do not replicate here.)
- **Open question #3 — single flat object vs `default`/`auth` sub-objects:**
  Recommend a **single flat object** `{ max; ttl; authMax; authTtl }` that mirrors
  `AppConfigService.rateLimit()` 1:1, giving a trivial mapper and minimal churn while
  satisfying FR-01's minimum shape. (Left as an open question for the human; a nested
  `{ default: {max,ttl}, auth: {max,ttl} }` shape is possible but adds mapping churn
  with no behavioral benefit.)

## Scope

- Add typed options token + type for the rate limiter.
- Refactor `RateLimiterModule` to `register`/`registerAsync` with typed defaults and
  export the options token.
- Refactor `RateLimiterGuard` to inject the options token instead of `AppConfigService`.
- Add `mapAppConfigToRateLimiterOptions` mapper.
- Update `apps/api/src/api.module.ts` and the deprecated `InfrastructureModule` facade
  to register via `registerAsync`.
- Add a guard unit spec and a rate-limiter module DI spec.

## Out of scope

- Changing the limiting algorithm, Redis key strategy, or `IRateLimiter` port.
- New per-route rate-limit features beyond current decorator options.
- Removing the deprecated `InfrastructureModule` facade.
- Any HTTP/OpenAPI contract change.
- Any env-schema or `AppConfigService.rateLimit()` shape change.

## Files to create

- `libs/infrastructure/src/rate-limiter/rate-limiter.module-options.ts`
  - `export type RateLimiterModuleOptions = { max: number; ttl: number; authMax: number; authTtl: number };`
  - `export const RATE_LIMITER_MODULE_OPTIONS = Symbol('RATE_LIMITER_MODULE_OPTIONS');`
- `libs/infrastructure/src/rate-limiter/rate-limiter.guard.spec.ts` (unit spec).
- `libs/infrastructure/src/rate-limiter/rate-limiter.module.spec.ts` (DI/module spec).

## Files to modify

- `libs/infrastructure/src/rate-limiter/rate-limiter.module.ts`
  - Add `register(options: RateLimiterModuleRegisterOptions)` and
    `registerAsync(options: RateLimiterModuleRegisterAsyncOptions)`; add private
    `buildDynamicModule(imports, optionsProvider)`. Add
    `RATE_LIMITER_MODULE_OPTIONS` to `exports`.
- `libs/infrastructure/src/rate-limiter/rate-limiter.guard.ts`
  - Replace `AppConfigService` injection with
    `@Inject(RATE_LIMITER_MODULE_OPTIONS) private readonly options: RateLimiterModuleOptions`;
    read defaults from `this.options`; remove the `AppConfigService` import.
- `libs/infrastructure/src/config/create-starter-kit-module-options.ts`
  - Add `mapAppConfigToRateLimiterOptions(config: AppConfigService): RateLimiterModuleOptions`
    returning `config.rateLimit()` (shape already `{ ttl, max, authTtl, authMax }`).
- `apps/api/src/api.module.ts`
  - Replace the `RateLimiterModule.register({ imports: [...] })` call with a
    `RateLimiterModule.registerAsync({ imports: [redisModule, InfrastructureConfigModule], inject: [AppConfigService], useFactory: (config) => mapAppConfigToRateLimiterOptions(config) })`
    constant and add it to `imports`. Import `mapAppConfigToRateLimiterOptions`. Keep
    `RateLimiterGuard` in `providers` (its options token is now resolvable via the
    imported, options-token-exporting `RateLimiterModule`).
- `libs/infrastructure/src/infrastructure.module.ts`
  - Replace the facade's `RateLimiterModule.register({ imports: [...] })` (line 100)
    with the `registerAsync` variant using `mapAppConfigToRateLimiterOptions`; add the
    mapper to the existing `create-starter-kit-module-options` import group.

## Files to delete

- None.

## Domain changes

- None.

## Application changes

- None.

## Contract and DI changes

- No changes to `libs/contracts` (`TOKENS.RateLimiter`/`IRateLimiter` unchanged — FR-07).
- New infrastructure-local DI token `RATE_LIMITER_MODULE_OPTIONS` (a `Symbol`, not a
  cross-boundary contract), consistent with `HEALTH_MODULE_OPTIONS`/`MAIL_MODULE_OPTIONS`.

## Infrastructure changes

- `RateLimiterModule` gains typed `register`/`registerAsync` and options-token export.
- `RateLimiterGuard` no longer depends on `AppConfigService`/config module (portable).
- New `mapAppConfigToRateLimiterOptions` mapper.

Proposed module shape (mirrors Health):

```ts
type RateLimiterModuleRegisterOptions = {
  imports?: ModuleMetadata['imports'];
  defaults: RateLimiterModuleOptions;
};

type RateLimiterModuleRegisterAsyncOptions = Pick<
  FactoryProvider<RateLimiterModuleOptions>,
  'inject' | 'useFactory'
> & { imports?: ModuleMetadata['imports'] };
```

`register` provides `{ provide: RATE_LIMITER_MODULE_OPTIONS, useValue: options.defaults }`;
`registerAsync` provides `{ provide: RATE_LIMITER_MODULE_OPTIONS, inject, useFactory }`.
Both keep providers `RedisRateLimiter`, `RateLimiterGuard`,
`{ provide: TOKENS.RateLimiter, useExisting: RedisRateLimiter }`, and exports
`TOKENS.RateLimiter`, `RateLimiterGuard`, `RATE_LIMITER_MODULE_OPTIONS`.

## Interface and entrypoint changes

| Entrypoint | Change |
| ---------- | ------ |
| API (`apps/api/src/api.module.ts`) | `RateLimiterModule.registerAsync(...)` with mapped defaults; guard provider retained |
| Worker / Cron | None (no rate limiter usage) |
| Migrations | None |
| `InfrastructureModule` facade (deprecated) | `RateLimiterModule.registerAsync(...)` with mapped defaults; must keep compiling and exporting `RateLimiterModule` |

No HTTP route, DTO, response, header, or OpenAPI changes.

## Database and migration changes

- None.

## Security and authorization changes

- Behavior preserved: `auth:` prefix still selects `authMax`/`authTtl`; other routes use
  `max`/`ttl`; decorator overrides still win.
- Fail-fast: `RATE_LIMITER_MODULE_OPTIONS` is a required constructor dependency, so a
  missing/absent options factory raises a Nest DI resolution error at bootstrap rather
  than silently disabling limits (spec Security requirement + AC intent).
- No `process.env` reads in guard or limiter (NFR-02).

## Observability changes

- None. `RateLimit-Limit`/`RateLimit-Remaining`/`RateLimit-Reset`/`Retry-After` headers
  and the 429 envelope are unchanged (FR-08, NFR-01).

## Implementation phases

- **Phase 1 — Options contract + mapper.**
  Create `rate-limiter.module-options.ts` (`RateLimiterModuleOptions`,
  `RATE_LIMITER_MODULE_OPTIONS`). Add `mapAppConfigToRateLimiterOptions` in
  `create-starter-kit-module-options.ts`. (FR-01, FR-06) — verify: `npm run build:api`.
- **Phase 2 — Module refactor.**
  Rewrite `rate-limiter.module.ts` with `register`/`registerAsync` + private
  `buildDynamicModule`; export `RATE_LIMITER_MODULE_OPTIONS`. (FR-01, FR-05, FR-07) —
  verify: `npm run build:api` + module spec (Phase 5).
- **Phase 3 — Guard refactor.**
  Inject `RATE_LIMITER_MODULE_OPTIONS` in `rate-limiter.guard.ts`; remove
  `AppConfigService`; keep decorator precedence and `auth:` branch. (FR-02, FR-03,
  FR-04, NFR-02) — verify: guard unit spec + `git diff` shows no `AppConfigService`.
- **Phase 4 — Composition roots.**
  Update `apps/api/src/api.module.ts` and `libs/infrastructure/src/infrastructure.module.ts`
  to `registerAsync` with `mapAppConfigToRateLimiterOptions`. (FR-06, facade compile) —
  verify: `npm run build`.
- **Phase 5 — Tests.**
  Add `rate-limiter.guard.spec.ts` (default fallback, decorator override precedence,
  `auth:` branch, fail-fast/no `AppConfigService`) and `rate-limiter.module.spec.ts`
  (`register` provides guard + limiter + options token with no
  `InfrastructureConfigModule`/`AppConfigService`; `registerAsync` provides options via
  factory). (AC-03, AC-04, AC-05) — verify: `test:unit` + `test:module`.
- **Phase 6 — Full verification.**
  Run full command set incl. OpenAPI drift; confirm empty OpenAPI diff. (AC-07, AC-08).

## Dependency and compatibility impact

- No new npm dependencies; `package.json`/`package-lock.json` unchanged.
- Registration API change is internal-only; both in-repo call sites are updated in this
  task. Exported tokens/providers backward compatible (NFR-03/FR-07).
- `AppConfigService.rateLimit()` and env schema untouched, so mapped defaults equal
  current env-driven defaults (NFR-01, compatibility requirement).

## Targeted verification

Record each as command → result → conclusion during implementation:

- `npm run build:api` — after each phase touching API/infra compilation.
- Guard unit spec: `node node_modules/jest/bin/jest.js --config jest.unit.config.ts rate-limiter.guard`
- Module DI spec: `node node_modules/jest/bin/jest.js --config jest.module.config.ts rate-limiter`
- `git diff -- libs/infrastructure/src/rate-limiter/rate-limiter.guard.ts` — confirm
  `AppConfigService` import/usage removed (AC-02).

## Full verification

Run before completion (from `package.json`):

- `npm run build`
- `npm run lint`
- `npm run test:unit`
- `npm run test:module`
- OpenAPI drift test (spec `apps/api/src/openapi/openapi-contract.spec.ts`, describe
  `"OpenAPI contract"`, runs under the unit config since it is not a `*.module.spec.ts`):
  `node node_modules/jest/bin/jest.js --config jest.unit.config.ts openapi-contract`
- `git diff` — confirm no changes under `apps/api/src/openapi/` and no OpenAPI document
  change (AC-08).
- Runtime (AC-06, requires Redis): bootstrap `npm run start:api`, exceed a rate-limited
  endpoint (e.g. `auth:login`) and confirm 429 with `Retry-After`; confirm `auth:`
  endpoint uses stricter defaults. Report Redis availability separately from code result.

## Acceptance criteria mapping

| AC | Requirement | Phase | Verification |
| -- | ----------- | ----- | ------------ |
| AC-01 | `register(...)` accepts typed defaults and `registerAsync(...)` exists; both provide a working guard | Phase 2 | `npm run build`; `rate-limiter.module.spec.ts` (`test:module`) |
| AC-02 | Guard no longer injects `AppConfigService` (verified in diff) | Phase 3 | `git diff` on `rate-limiter.guard.ts`; grep no `AppConfigService` |
| AC-03 | Module/unit spec constructs guard with explicit options (no `AppConfigService`, no `InfrastructureConfigModule`) and enforces limits | Phase 5 | `rate-limiter.guard.spec.ts` (`test:unit`) + `rate-limiter.module.spec.ts` (`test:module`) |
| AC-04 | Decorator overrides take precedence over module defaults | Phase 3 + 5 | Guard unit spec asserts `options.limit/ttlSeconds` used over defaults |
| AC-05 | `auth:`-prefixed endpoints use auth defaults | Phase 3 + 5 | Guard unit spec asserts `authMax`/`authTtl` chosen for `auth:` prefix |
| AC-06 | API bootstraps; limit exceeded → 429 with mapped config defaults | Phase 4 | `npm run start:api` + runtime 429 check (needs Redis) |
| AC-07 | `build`, `lint`, `test:unit`, `test:module` succeed | Phase 6 | The four `npm run` commands |
| AC-08 | OpenAPI drift test passes; no OpenAPI doc changes in diff | Phase 6 | `node node_modules/jest/bin/jest.js --config jest.unit.config.ts openapi-contract` + `git diff apps/api/src/openapi/` empty |

No acceptance criterion is omitted.

## Rollout strategy

- Backward-compatible in-repo; API composition and facade updated in the same task.
- No migrations, feature flags, or data changes; single-commit deploy.

## Rollback strategy

- Revert the task commit. No data or schema impact; `AppConfigService.rateLimit()` and
  env schema were never modified, so no runtime state to reconcile.

## Risks

- **R1:** ApiModule's own `RateLimiterGuard` provider fails to resolve the new options
  token. Mitigation: `RateLimiterModule` exports `RATE_LIMITER_MODULE_OPTIONS` and is
  imported by ApiModule; covered by the module DI spec and API bootstrap.
- **R2:** Wrong default mapping loosens/tightens limits. Mitigation:
  `mapAppConfigToRateLimiterOptions` returns `config.rateLimit()` unchanged
  (`{ ttl, max, authTtl, authMax }`), preserving env defaults (NFR-01).
- **R3:** Facade left uncompiled. Mitigation: Phase 4 updates it and `npm run build`
  compiles all entrypoints.
- **R4:** AC-06 runtime check blocked if Redis is unavailable — infrastructure
  limitation, not a code defect; report separately.

## Open questions requiring human decision

1. **`register` signature (spec Q1):** Recommend a breaking `register({ defaults, imports? })`
   (both in-repo call sites migrate to `registerAsync`). Approve, or require a
   backward-compatible overload keeping `register({ imports })`?
2. **Deprecated AppConfig-backed helper (spec Q2):** Recommend **not** adding one
   (composition roots use `registerAsync` + mapper). Approve, or require a temporary
   `registerFromAppConfig` migration helper?
3. **Options shape (spec Q3):** Recommend a single flat object
   `{ max; ttl; authMax; authTtl }` (1:1 with `AppConfigService.rateLimit()`). Approve,
   or require nested `default`/`auth` sub-objects?
