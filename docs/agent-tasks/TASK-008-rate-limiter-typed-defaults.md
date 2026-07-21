---
task_id: TASK-008
task_type: refactor
status: approved
owner: human-approval-required
---

# TASK-008 — RateLimiterModule typed defaults (decouple guard from AppConfigService)

## Original request

Створити завдання на всі High-проблеми з рев'ю переносимості
(`docs/agent-reports/full-review-2026-07-20.md`). Ця задача покриває High-проблему:
`RateLimiterGuard` бере дефолтні ліміти напряму з `AppConfigService`, а
`RateLimiterModule.register` не приймає typed options — тому модуль непереносний.

## Problem or opportunity

`RateLimiterGuard` injects `AppConfigService` and reads
`config.rateLimit().max/ttl/authMax/authTtl` for its default limits, while
`RateLimiterModule.register` only accepts `{ imports }`. Reusing the rate limiter in
another project forces importing `InfrastructureConfigModule` and adopting this
starter's env schema, violating `.cursor/rules/20-module-portability.mdc`
("retry policies, TTLs ... must be configurable where they affect portability" and
"must not require `AppConfigService` as its only configuration API").

Technical/portability refactor, not a backlog defect.

## Goal

`RateLimiterModule` accepts typed default limits via
`register` / `registerAsync`, and `RateLimiterGuard` resolves those defaults from an
injected options token instead of `AppConfigService`. Per-endpoint
`@RateLimit(...)` decorator overrides and the `auth:` prefix behavior are preserved.
The starter maps `AppConfigService` -> rate-limit defaults only at the composition
root.

## Users and actors

- Integrators reusing `RateLimiterModule` without this starter's `AppConfigService`.
- API consumers subject to rate limits (behavior must not regress).
- Maintainers of API composition roots.

## Current system context

Inspected on the current branch:

- `libs/infrastructure/src/rate-limiter/rate-limiter.guard.ts` — injects
  `AppConfigService`; computes `limit`/`ttlSeconds` from decorator options or, when
  absent, from `config.rateLimit()` with an `auth:` keyPrefix branch selecting
  `authMax`/`authTtl` vs `max`/`ttl`.
- `libs/infrastructure/src/rate-limiter/rate-limiter.module.ts` —
  `register({ imports? })` only; provides `RedisRateLimiter`, `RateLimiterGuard`,
  `TOKENS.RateLimiter`; exports `TOKENS.RateLimiter`, `RateLimiterGuard`.
- `libs/infrastructure/src/rate-limiter/rate-limit.decorator.ts` — `RATE_LIMIT_KEY`,
  `RateLimitOptions` (`limit`, `ttlSeconds`, `keyPrefix`).
- `apps/api/src/api.module.ts` — registers
  `RateLimiterModule.register({ imports: [redisModule, InfrastructureConfigModule] })`
  and provides `RateLimiterGuard`.
- `libs/contracts/src/rate-limiter/rate-limiter.ts` — `IRateLimiter` port.
- Defaults source: `AppConfigService.rateLimit()` -> `{ max, ttl, authMax, authTtl }`
  (from env schema).

## Functional requirements

- **FR-01:** `RateLimiterModule` must accept typed default limits, at minimum
  `{ max: number; ttl: number; authMax: number; authTtl: number }`, via
  `register(options)` and an async `registerAsync(asyncOptions)` variant.
- **FR-02:** `RateLimiterGuard` must resolve default limits from an injected
  rate-limiter-options token, not from `AppConfigService`.
- **FR-03:** Per-endpoint `@RateLimit(...)` decorator overrides
  (`limit`, `ttlSeconds`, `keyPrefix`) must take precedence over module defaults,
  exactly as today.
- **FR-04:** The `auth:`-prefixed keyPrefix branch (selecting `authMax`/`authTtl`)
  must be preserved.
- **FR-05:** `RateLimiterModule` must not require importing
  `InfrastructureConfigModule` in its portable registration path.
- **FR-06:** The API composition root must map `AppConfigService.rateLimit()` ->
  module default options and pass them via `registerAsync` (or `register` with
  resolved values).
- **FR-07:** Redis backing (`RedisRateLimiter` via `TOKENS.RateLimiter`) and the
  `IRateLimiter` port remain replaceable; exported tokens unchanged.
- **FR-08:** OpenAPI/HTTP contracts unaffected (429 behavior and headers unchanged).

## Non-functional requirements

- **NFR-01:** No behavior change to actual limiting under default configuration.
- **NFR-02:** No `process.env` reads inside the guard or limiter.
- **NFR-03:** Backward-compatible exported tokens/providers.

## Public API and interface impact

Module registration API changes (`registerAsync` added; `register` gains typed
options). Runtime HTTP behavior unchanged.

### HTTP API contract (if applicable)

No new/changed endpoints. Existing rate-limited endpoints keep returning 429 with
the current envelope when limits are exceeded.

- Methods and paths: unchanged
- Request/response/validation: unchanged
- Status codes and error envelope: 429 behavior unchanged
- Auth: unchanged (`auth:` prefix branch preserved)
- Headers/cookies: unchanged
- OpenAPI schemas/decorators to add or update: **none — behavior-preserving refactor**
- Acceptance criterion verifying generated OpenAPI: run existing OpenAPI drift test
  to confirm no drift (AC-08).

## Data model and migration impact

None.

## Events, queues and background processing

None.

## Security and authorization

- Rate-limit thresholds must remain enforced; a missing options factory must fail
  fast rather than silently disabling limits.
- `auth:` endpoints must keep their stricter defaults.

## Entrypoints and deployment impact

| Entrypoint | Impact |
| ---------- | ------ |
| API | Update `RateLimiterModule` registration with typed defaults from config |
| Worker/Cron | No rate limiter usage; unaffected |
| `InfrastructureModule` facade (deprecated) | Update registration to keep compiling |

## Observability and operations

- No new metrics; existing rate-limit logging (if any) unchanged.

## Compatibility requirements

- Preserve decorator override precedence and `auth:` branch.
- Keep `TOKENS.RateLimiter` and `RateLimiterGuard` exports.
- Default numeric values must equal current env-driven defaults when mapped from
  `AppConfigService`.

## Dependencies

- None new. Depends conceptually on the same portability direction as TASK-007 but
  is independently implementable.

## Assumptions

- **A-01:** Portability/refactor task, not a backlog defect.
- **A-02:** Options token pattern mirrors other typed modules (e.g. Health
  `HEALTH_MODULE_OPTIONS`).
- **A-03:** Parent agent updates `docs/agent-tasks/INDEX.md`.

## Out of scope

- Changing the limiting algorithm or Redis key strategy.
- Adding new per-route rate-limit features beyond current decorator options.
- Removing the deprecated `InfrastructureModule` facade.
- Any HTTP/OpenAPI contract change.

## Acceptance criteria

- **AC-01:** `RateLimiterModule.register(...)` accepts typed default limits and
  `registerAsync(...)` exists; both compile and provide a working guard.
- **AC-02:** `RateLimiterGuard` no longer injects `AppConfigService` (verified in
  the diff).
- **AC-03:** A module/unit spec constructs the guard with explicit default options
  (no `AppConfigService`, no `InfrastructureConfigModule`) and enforces limits.
- **AC-04:** Decorator overrides still take precedence over module defaults.
- **AC-05:** `auth:`-prefixed endpoints still use the auth defaults.
- **AC-06:** API bootstraps and rate limiting works end to end with mapped config
  defaults (limit exceeded -> 429).
- **AC-07:** `npm run build`, `npm run lint`, `npm run test:unit`,
  `npm run test:module` succeed.
- **AC-08:** OpenAPI drift test passes; no OpenAPI document changes in the diff.

## Verification strategy

- Static: inspect guard and module for removed AppConfig coupling and correct
  options wiring; inspect API composition root mapping.
- Unit/DI: guard spec with explicit options; `npm run test:module`.
- Runtime: exceed a rate-limited endpoint and confirm 429; confirm auth endpoint
  stricter defaults.
- Commands: `npm run build`, `npm run lint`, `npm run test:unit`,
  `npm run test:module`, plus the OpenAPI drift test.

## Rollout and rollback

- **Rollout:** Backward-compatible; API composition updated same task.
- **Rollback:** Revert commit; no data impact.
- **Risk:** Wrong default mapping could loosen/tighten limits; mitigate with spec
  asserting mapped values equal current env defaults.

## Open questions requiring human decision

1. Should `register` require explicit defaults (breaking the current
   `register({ imports })` call site) or keep a backward-compatible overload?
2. Keep a deprecated AppConfig-backed registration helper for one migration window?
3. Should default limits be a single object or split into `default` vs `auth`
   sub-objects for clarity?
