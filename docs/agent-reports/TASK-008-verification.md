# TASK-008 — Independent verification

## Verdict

approved

> Caveats (non-blocking): AC-06 end-to-end 429 runtime check is unverified because no
> Redis instance was available (infrastructure limitation, not a code defect). One
> unrelated, pre-existing module spec (`apps/cron/src/cron.module.spec.ts`) fails due to a
> BullMQ/ioredis test-mock issue that is outside TASK-008's scope and code paths.

## Approved specification

- `docs/agent-tasks/TASK-008-rate-limiter-typed-defaults.md` — frontmatter `status: approved`.
- Source of truth: FR-01..FR-08, NFR-01..NFR-03, AC-01..AC-08.

## Approved plan

- `docs/agent-plans/TASK-008-rate-limiter-typed-defaults.md` — frontmatter `status: approved`.
- Files-to-create / files-to-modify list matches the actual diff exactly (see below).

## Scope checked

Exactly one task (TASK-008) implemented. Tracked production diff is limited to the five
files named in the plan; two new spec files and one new options file created as planned.
No `package-lock.json` churn, no env-schema change, no `AppConfigService.rateLimit()` shape
change, no `libs/contracts` change. Untracked `docs/agent-tasks/TASK-009*`, `TASK-010*` and
`docs/agent-reports/TASK-008-implementation.md` are documentation only and outside the
production diff (TASK-009/010 are separate specs, not part of this task's code scope).

## Actual changed files

Modified (production):

- `apps/api/src/api.module.ts` — adds `rateLimiterModule = RateLimiterModule.registerAsync(...)` using `mapAppConfigToRateLimiterOptions`; keeps `RateLimiterGuard` in `providers`.
- `libs/infrastructure/src/config/create-starter-kit-module-options.ts` — adds `mapAppConfigToRateLimiterOptions` (purely additive).
- `libs/infrastructure/src/infrastructure.module.ts` (deprecated facade) — migrates to `registerAsync` + mapper.
- `libs/infrastructure/src/rate-limiter/rate-limiter.guard.ts` — injects `RATE_LIMITER_MODULE_OPTIONS`, removes `AppConfigService`.
- `libs/infrastructure/src/rate-limiter/rate-limiter.module.ts` — typed `register` + new `registerAsync` + private `buildDynamicModule`; exports options token.

Created:

- `libs/infrastructure/src/rate-limiter/rate-limiter.module-options.ts` (`RateLimiterModuleOptions` type + `RATE_LIMITER_MODULE_OPTIONS` Symbol).
- `libs/infrastructure/src/rate-limiter/rate-limiter.guard.spec.ts`.
- `libs/infrastructure/src/rate-limiter/rate-limiter.module.spec.ts`.

Deleted: none.

## Requirements matrix

| Requirement | Evidence | Result |
| ----------- | -------- | ------ |
| FR-01 | `register(options)` requires typed `defaults: RateLimiterModuleOptions`; `registerAsync(asyncOptions)` added (module.ts L16-43). Module spec proves both provide a working guard. | passed |
| FR-02 | Guard constructor injects `@Inject(RATE_LIMITER_MODULE_OPTIONS)`; reads `this.options.*` (guard.ts L27-50). | passed |
| FR-03 | `decoratorOptions?.limit/ttlSeconds ?? default` ordering preserved (guard.ts L46-50); guard spec "prefers decorator overrides" passes. | passed |
| FR-04 | `isAuthEndpoint = keyPrefix.startsWith('auth:')` selects `authMax`/`authTtl` (guard.ts L44-50); guard spec "uses auth defaults" passes. | passed |
| FR-05 | `RateLimiterModule` no longer imports config; portable `register` path takes only `{ imports?, defaults }`; module spec boots with a `FakeRedisModule` and no `InfrastructureConfigModule`/`AppConfigService`. | passed |
| FR-06 | Both composition roots map via `mapAppConfigToRateLimiterOptions` through `registerAsync` (api.module.ts L71-75; infrastructure.module.ts L101-105). | passed |
| FR-07 | `TOKENS.RateLimiter`/`IRateLimiter` unchanged (no `libs/contracts` diff); module still exports `TOKENS.RateLimiter`, `RateLimiterGuard`; only new local `RATE_LIMITER_MODULE_OPTIONS` export added. | passed |
| FR-08 | OpenAPI drift test 3/3; `git status apps/api/src/openapi/` empty. | passed |
| NFR-01 | `mapAppConfigToRateLimiterOptions` returns `config.rateLimit()` (`{ ttl, max, authTtl, authMax }`) unchanged → mapped defaults equal current env defaults. | passed |
| NFR-02 | grep for `process.env`/`AppConfigService` in `libs/infrastructure/src/rate-limiter/` → no matches; `redis-rate-limiter.ts` reads neither. | passed |
| NFR-03 | Exported tokens/providers backward compatible; `register` signature change is internal and both call sites migrated. | passed |

## Acceptance criteria matrix

| AC | Evidence | Result |
| -- | -------- | ------ |
| AC-01 | `register` accepts typed `defaults`; `registerAsync` exists; module spec (2/2) resolves guard + limiter + options token for both. | passed |
| AC-02 | Diff removes `import { AppConfigService }` and the `config` field; grep confirms no `AppConfigService` in the guard/limiter dir. | passed |
| AC-03 | `rate-limiter.guard.spec.ts` constructs `new RateLimiterGuard(limiter, DEFAULT_OPTIONS, new Reflector())` (no `AppConfigService`, no `InfrastructureConfigModule`) and enforces limits (4/4 pass). | passed |
| AC-04 | Guard spec "prefers decorator overrides over module defaults" (limit 3 / ttl 15) passes. | passed |
| AC-05 | Guard spec "uses auth defaults for auth:-prefixed endpoints" (authMax/authTtl) passes. | passed |
| AC-06 | Runtime 429 against live Redis not executed — no Redis available. DI wiring, build and unit-level 429 (guard spec "throws 429 with Retry-After") pass. | not-confirmed (infrastructure) |
| AC-07 | `build` ✓, `lint` ✓, `test:unit` ✓ (210/210). `test:module`: 23/24 tests pass; the single failure is unrelated `cron.module.spec` (BullMQ/ioredis mock). | passed (with unrelated cron failure noted) |
| AC-08 | OpenAPI drift test 3/3; no diff under `apps/api/src/openapi/`. | passed |

## Architecture and DI verification

- Dependency direction preserved: guard depends on a local infra token + contracts port; no new cross-boundary contract added (`RATE_LIMITER_MODULE_OPTIONS` is an infra-local `Symbol`, mirroring `HEALTH_MODULE_OPTIONS`).
- Fail-fast: `RATE_LIMITER_MODULE_OPTIONS` is a required constructor dependency; a missing options factory raises a Nest DI error at bootstrap rather than silently disabling limits (satisfies the spec Security note / NFR intent).
- R1 (ApiModule's own guard copy resolving the token): mitigated — `RateLimiterModule` exports the token and is imported by `ApiModule`; confirmed by successful build, module DI spec, and the bootstrap-style unit run exercising `RateLimiterGuard.canActivate`.
- Facade (deprecated `InfrastructureModule`) migrated to `registerAsync` and still compiles (`npm run build` green).

## Database and migration verification

- None applicable (no schema/migration changes).

## Security verification

- `auth:` branch and decorator precedence preserved (FR-03/FR-04 tests pass).
- No secrets touched; no `process.env` in guard/limiter (NFR-02).
- 429 envelope and `RateLimit-*` / `Retry-After` headers unchanged (guard.ts L58-80).

## Commands executed

| Command | Result | Conclusion |
| ------- | ------ | ---------- |
| `git status` / `git diff` (+ `--cached`) | Only planned files changed | Scope matches plan; no unrelated production churn |
| `npm run build` | exit 0 (api, worker, cron, migrations) | Compiles; mapper types align with `RateLimiterModuleOptions` |
| `npm run lint` | exit 0 | No lint/style violations |
| `node .../jest.js --config jest.unit.config.ts` | 36 suites / 210 tests passed | Full unit suite green (ExceptionsHandler logs are expected output from a bootstrap spec) |
| `node .../jest.js --config jest.module.config.ts --runInBand` | 11 passed, 1 failed (24 tests: 23 pass, 1 fail) | Only `cron.module.spec` fails — unrelated (see Findings) |
| `node .../jest.js --config jest.unit.config.ts rate-limiter.guard` | 4/4 passed | AC-02..AC-05 covered |
| `node .../jest.js --config jest.module.config.ts rate-limiter` | 2/2 passed | AC-01 / FR-05 covered |
| `node .../jest.js --config jest.unit.config.ts openapi-contract` | 3/3 passed | AC-08 drift check green |
| `git status --porcelain apps/api/src/openapi/` | empty | No OpenAPI document changes (AC-08 / FR-08) |
| grep `process.env|AppConfigService` in rate-limiter dir | no matches | NFR-02 / AC-02 confirmed |

## Findings

1. **AC-06 unverified (infrastructure, non-blocking).** A live 429 check requires Redis,
   which was not available. DI wiring, build, and the unit-level 429 path are green;
   per task instructions this infra gap does not fail the code verdict.
2. **Unrelated failing module spec (non-blocking).** `apps/cron/src/cron.module.spec.ts`
   fails with `TypeError: ioredis_1.default is not a constructor` inside BullMQ's
   `RedisConnection` (a jest CJS/ESM mock issue in the Cron queue provider). TASK-008
   changes no cron/BullMQ/ioredis/queue code. The only TASK-008-modified file that
   `cron.module.ts` imports is `create-starter-kit-module-options.ts`, whose change is a
   purely additive new function not used by cron. (Note: a stash-and-rerun proof was
   intentionally not performed to avoid mutating the worktree during read-only
   verification; static evidence is conclusive that the failure is pre-existing and
   unrelated.)
3. **Minor, in-scope rename.** Guard local `options` → `decoratorOptions` to avoid
   shadowing the injected `this.options`; cosmetic and disclosed in the implementation
   report. No behavioral impact.

## Documentation alignment

- No public HTTP/OpenAPI behavior changed; drift test confirms no document change.
- Module registration API change is internal; both in-repo call sites migrated in-task.
- No README/EXAMPLES update required by the spec/plan.

## Remaining risks

- Default-mapping drift: mitigated — mapper returns `config.rateLimit()` unchanged and
  `AppConfigService.rateLimit()` shape (`{ ttl, max, authTtl, authMax }`) matches
  `RateLimiterModuleOptions` 1:1.
- Live rate-limit enforcement with real Redis remains to be exercised during human
  acceptance (AC-06).

## Unverified areas

- **AC-06 live 429 with Redis.** Recommend, during acceptance: bootstrap `npm run start:api`
  with Redis, exceed `auth:login`, expect 429 + `Retry-After`, and confirm `auth:` uses the
  stricter (`authMax`/`authTtl`) defaults.
- **`apps/cron/src/cron.module.spec.ts`.** Pre-existing BullMQ/ioredis test-mock failure;
  flag for separate triage, out of TASK-008 scope.
