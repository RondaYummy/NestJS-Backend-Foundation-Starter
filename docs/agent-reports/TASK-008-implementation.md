# TASK-008 — Implementation report

## Verdict

implemented

## Approved specification

- `docs/agent-tasks/TASK-008-rate-limiter-typed-defaults.md` (`status: approved`).
- Intent: make `RateLimiterModule` accept typed default limits via
  `register` / `registerAsync`, resolve guard defaults from an injected options token
  instead of `AppConfigService`, preserve `@RateLimit(...)` override precedence and the
  `auth:` keyPrefix branch, and map `AppConfigService.rateLimit()` → module options only
  at the composition roots. Behavior-preserving refactor; no HTTP/OpenAPI change.

## Approved plan

- `docs/agent-plans/TASK-008-rate-limiter-typed-defaults.md` (`status: approved`).
- Mirrors the Health module `register`/`registerAsync` + `<NAME>_MODULE_OPTIONS` token
  shape. Recommendations adopted: breaking typed `register` (both in-repo call sites
  migrated to `registerAsync`), no AppConfig-backed helper, single flat options object.

## Changed files

Modified (production):

- `apps/api/src/api.module.ts`
- `libs/infrastructure/src/config/create-starter-kit-module-options.ts`
- `libs/infrastructure/src/infrastructure.module.ts`
- `libs/infrastructure/src/rate-limiter/rate-limiter.guard.ts`
- `libs/infrastructure/src/rate-limiter/rate-limiter.module.ts`

Created:

- `libs/infrastructure/src/rate-limiter/rate-limiter.module-options.ts`
- `libs/infrastructure/src/rate-limiter/rate-limiter.guard.spec.ts`
- `libs/infrastructure/src/rate-limiter/rate-limiter.module.spec.ts`

Deleted: none.

## Completed phases

- **Phase 1 — Options contract + mapper.** Added `RateLimiterModuleOptions` type and
  `RATE_LIMITER_MODULE_OPTIONS` token; added `mapAppConfigToRateLimiterOptions`.
- **Phase 2 — Module refactor.** `RateLimiterModule.register(options)` now requires typed
  `defaults`; added `registerAsync(asyncOptions)`; shared private `buildDynamicModule`;
  exports `RATE_LIMITER_MODULE_OPTIONS` alongside `TOKENS.RateLimiter` and
  `RateLimiterGuard`.
- **Phase 3 — Guard refactor.** `RateLimiterGuard` injects `RATE_LIMITER_MODULE_OPTIONS`
  (required dependency → fail-fast) instead of `AppConfigService`; decorator precedence
  and `auth:` branch preserved; `AppConfigService` import removed.
- **Phase 4 — Composition roots.** `ApiModule` and the deprecated `InfrastructureModule`
  facade now register via `registerAsync` + `mapAppConfigToRateLimiterOptions`. The
  rate-limiter module itself no longer requires `InfrastructureConfigModule` in its
  portable path.
- **Phase 5 — Tests.** Added guard unit spec (default fallback, `auth:` branch, decorator
  override precedence, 429 with `Retry-After`, constructed with explicit options and no
  `AppConfigService`) and module DI spec (`register`/`registerAsync` provide guard +
  limiter + options token without `InfrastructureConfigModule`/`AppConfigService`).
- **Phase 6 — Full verification.** Ran build, lint, unit, module and OpenAPI drift checks.

## Acceptance criteria self-check

- **AC-01 — met.** `register(...)` accepts typed `defaults`; `registerAsync(...)` exists;
  both compile and provide a working guard (module DI spec).
- **AC-02 — met.** Guard no longer injects `AppConfigService` (import and field removed;
  confirmed in diff / grep).
- **AC-03 — met.** Guard unit spec constructs the guard with explicit options (no
  `AppConfigService`, no `InfrastructureConfigModule`) and enforces limits; module spec
  boots without config module.
- **AC-04 — met.** Guard unit spec asserts decorator `limit`/`ttlSeconds` override module
  defaults.
- **AC-05 — met.** Guard unit spec asserts `auth:`-prefixed keyPrefix selects
  `authMax`/`authTtl`.
- **AC-06 — not runtime-verified (infrastructure).** API composition wiring is in place
  and `npm run build` succeeds; a live 429 check requires a running Redis instance, which
  was not available/started in this environment. No code defect identified; see
  Unverified areas.
- **AC-07 — met with one pre-existing unrelated failure.** `npm run build` ✓,
  `npm run lint` ✓, `test:unit` ✓ (210/210). `test:module`: all rate-limiter and other
  module specs pass; the only failure is `apps/cron/src/cron.module.spec.ts`, a
  pre-existing BullMQ/ioredis mock issue (`ioredis_1.default is not a constructor`) that
  reproduces with my changes stashed and does not involve the rate limiter.
- **AC-08 — met.** OpenAPI drift test passes (3/3); `git diff` shows no changes under
  `apps/api/src/openapi/` and no OpenAPI document change.

## Contract and DI changes

- No changes to `libs/contracts` (`TOKENS.RateLimiter` / `IRateLimiter` unchanged — FR-07).
- New infrastructure-local DI token `RATE_LIMITER_MODULE_OPTIONS` (`Symbol`), exported by
  `RateLimiterModule` so `ApiModule`'s own `RateLimiterGuard` provider resolves it.
- `RateLimiterGuard` constructor signature changed: `AppConfigService` → injected
  `RATE_LIMITER_MODULE_OPTIONS`.

## Database and migration changes

- None.

## Commands executed

1. `node node_modules/@nestjs/cli/bin/nest.js build api`
2. `node node_modules/jest/bin/jest.js --config jest.unit.config.ts rate-limiter.guard`
3. `node node_modules/jest/bin/jest.js --config jest.module.config.ts rate-limiter`
4. `npm run build`
5. `npm run lint`
6. `node node_modules/jest/bin/jest.js --config jest.unit.config.ts` (full unit — `npm run test:unit` wrapper crashed on Windows; ran underlying command)
7. `node node_modules/jest/bin/jest.js --config jest.module.config.ts --runInBand` (full module)
8. `node node_modules/jest/bin/jest.js --config jest.unit.config.ts openapi-contract`
9. `git stash push -- .../create-starter-kit-module-options.ts` + cron spec rerun + `git stash pop` (to confirm the cron failure is pre-existing)
10. `git diff --stat` / `git diff --name-only` / `git status --porcelain`

## Command results

- **(1) build api** → exit 0.
- **(2) guard unit spec** → 4 passed.
- **(3) rate-limiter module spec** → 2 passed.
- **(4) `npm run build`** → exit 0 (api, worker, cron, migrations).
- **(5) `npm run lint`** → exit 0 (after fixing one `require-await` lint in the new guard
  spec; a transient Windows "Access is denied." retry then passed).
- **(6) full unit** → 36 suites / 210 tests passed. (Logged `ExceptionsHandler` errors are
  expected output from an existing bootstrap spec that stubs providers; suite is green.)
- **(7) full module** → 11 passed, 1 failed. The single failure is
  `apps/cron/src/cron.module.spec.ts` (pre-existing BullMQ/ioredis mock error), confirmed
  independent of this task via step (9). All rate-limiter/API-relevant module specs pass.
- **(8) OpenAPI drift** → 3 passed; no OpenAPI diff.
- **(9)** cron spec still fails with the config change stashed → confirms pre-existing,
  unrelated to TASK-008.

Note: `npm run build:api` and `npm run test:unit` wrappers each crashed once with known
Windows npm-wrapper faults (access violation / binary reparse); the underlying commands
were run directly per AGENTS.md guidance and succeeded.

## Deviations

- None from the approved plan. All planned files created/modified as specified; no scope
  expansion. Local variable in the guard renamed `options` → `decoratorOptions` to avoid
  shadowing the injected `this.options` (cosmetic, within the same edit).

## Documentation changes

- None required: no public HTTP/OpenAPI behavior changed; module registration API change
  is internal and both in-repo call sites were migrated in this task.

## Remaining risks

- **R1 (ApiModule guard resolution):** Mitigated — `RateLimiterModule` exports the options
  token and is imported by `ApiModule`; covered by the module DI spec and successful build.
- **R2 (default mapping drift):** Mitigated — `mapAppConfigToRateLimiterOptions` returns
  `config.rateLimit()` unchanged (`{ ttl, max, authTtl, authMax }`), preserving env
  defaults.
- **R3 (facade uncompiled):** Mitigated — facade migrated and `npm run build` compiles all
  entrypoints.

## Unverified areas

- **AC-06 live 429 runtime check:** Not executed because a running Redis instance was not
  available in this environment. Static wiring, build, and DI specs pass; recommend a
  runtime check against Redis (exceed `auth:login` → expect 429 with `Retry-After`, and
  confirm `auth:` uses stricter defaults) during acceptance.
- **`apps/cron/src/cron.module.spec.ts`:** Pre-existing failing module spec unrelated to
  this task (BullMQ/ioredis mock). Out of scope; flagged for separate triage.
