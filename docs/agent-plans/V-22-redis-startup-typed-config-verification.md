---
issue_id: V-22
status: approved
owner: human-approval-required
---

# V-22 — Redis startup check uses the same typed config as RedisModule in API/Worker/Cron

## Source issue

`docs/agent-backlog/NESTJS_STARTER_KIT_REQUIRED_FIXES.md` — verification backlog row **V-22**:

> Redis startup check uses the same typed config as RedisModule in API/Worker/Cron

**Linked defect:** **P2-16** (`docs/agent-backlog/NESTJS_STARTER_KIT_REQUIRED_FIXES.md` — section P2-16).

**Investigation (2026-06-24, current branch):** verification scenario is **not stale**. The underlying configuration defect from P2-16 is still present in production code. V-22 cannot return `approved` until P2-16 is implemented and independently verified.

**Note on backlog index:** `docs/agent-backlog/INDEX.md` is deleted in the current working tree; V-22 remains listed in `NESTJS_STARTER_KIT_REQUIRED_FIXES.md` (summary table line ~1747 and full P2-16 section ~1364–1427). No separate `docs/agent-plans/P2-16-*.md` implementation plan exists yet — implementation must follow a human-approved P2-16 plan before V-22 verification can pass.

## Current behavior

1. **All three Redis-dependent entrypoints** run a pre-Nest Redis probe before `NestFactory.create` / `createApplicationContext`:

   | Entrypoint | File                     | Call site                                                                 |
   | ---------- | ------------------------ | ------------------------------------------------------------------------- |
   | API        | `apps/api/src/main.ts`   | `await assertRedisAvailable(getRedisStartupConfig())` (line 18)           |
   | Worker     | `apps/worker/src/main.ts`| `await assertRedisAvailable(getRedisStartupConfig())` (line 29)           |
   | Cron       | `apps/cron/src/main.ts`  | `await assertRedisAvailable(getRedisStartupConfig())` (line 15)           |

2. **`getRedisStartupConfig()`** (`libs/infrastructure/src/redis/redis-startup-config.ts`) parses `process.env` through a **local** Zod schema `redisStartupEnvSchema` — not `envSchema` from `libs/infrastructure/src/config/env.schema.ts`.

3. **`InfrastructureConfigModule`** (`libs/infrastructure/src/config/infrastructure-config.module.ts`) loads typed config later via `ConfigModule.forRoot({ validate: … envSchema.safeParse … })` and maps Redis connection fields into `AppConfigService.redis()`.

4. **`RedisModule.forRootAsync`** at composition roots uses `mapAppConfigToRedisOptions(config)` → `config.redis()` (`libs/infrastructure/src/config/create-starter-kit-module-options.ts`).

5. **Duplicate schema divergence (confirmed today):**

   | Field / behavior | `redisStartupEnvSchema` (`redis-startup-config.ts`) | `envSchema` (`env.schema.ts`) |
   | ---------------- | --------------------------------------------------- | ----------------------------- |
   | `REDIS_HOST`     | `z.string().min(1).default('localhost')`            | `z.string().default('localhost')` (no `min(1)`) |
   | `REDIS_PORT`     | `z.coerce.number().int().positive().default(6379)`  | `z.coerce.number().default(6379)` |
   | `REDIS_DB`       | `z.coerce.number().int().nonnegative().default(0)`  | `z.coerce.number().default(0)` |
   | `REDIS_PASSWORD` | optional string; mapped to `undefined` when empty   | optional string; passed through to `config.redis()`; `RedisModule` uses `password \|\| undefined` |
   | Startup-only     | `REDIS_STARTUP_MAX_ATTEMPTS`, `REDIS_STARTUP_RETRY_DELAY_MS` | Same keys present in `envSchema` |
   | Runtime-only     | not read by startup helper                        | `REDIS_KEY_PREFIX` (P2-14; not required for TCP probe) |

6. **Risk scenario (backlog P2-16 / P3-05):** With Docker-style `.env.example` (`REDIS_HOST=redis`), both paths currently agree when env is valid. The defect is **maintainability and validation drift**: a future change to `envSchema` defaults or coercion would not automatically apply to the pre-Nest probe; conversely, stricter `redisStartupEnvSchema` rules (e.g. `min(1)` on host) can fail startup before Nest would accept the same env.

7. **Logging (partially addressed):** `assertRedisAvailable()` already uses neutral prefix `[redis-startup]` (P3-03). P2-16 backlog also mentions component context; neutral shared prefix satisfies the documented P3-03 outcome — V-22 does not require per-entrypoint prefixes unless P2-16 implementation chooses that approach.

8. **No unit tests** reference `getRedisStartupConfig()` or assert parity with `envSchema` / `mapAppConfigToRedisOptions` (grep: zero `*.spec.ts` matches).

## Confirmed root cause

Redis startup preflight uses a **second, parallel configuration path** (`redis-startup-config.ts` + raw `process.env`) that duplicates Redis env parsing instead of reusing the canonical `envSchema` → `AppConfigService.redis()` → `mapAppConfigToRedisOptions` contract used by `RedisModule`, `HealthModule`, and BullMQ connection wiring.

This violates the starter-kit rule of one explicit typed configuration contract and allows validation/default drift between pre-Nest failure and post-Nest runtime.

## Dependency/runtime flow

### Current (broken — V-22 would fail today)

```text
apps/api|worker|cron main.ts
  -> assertRedisAvailable(getRedisStartupConfig())
       -> redis-startup-config.ts
            -> redisStartupEnvSchema.parse(process.env)   ❌ duplicate schema
       -> assert-redis-available.ts (ioredis probe)

Nest bootstrap
  -> InfrastructureConfigModule
       -> envSchema.safeParse(process.env)                 ✓ canonical schema
       -> AppConfigService.redis()
  -> RedisModule.forRootAsync({ useFactory: mapAppConfigToRedisOptions })
       -> config.redis()  (host, port, password, db, connectTimeoutMs, keyPrefix)
```

### Expected after P2-16 (V-22 pass condition)

One of these patterns (exact choice is P2-16 implementer scope; verifier confirms outcome, not mandating one approach):

**Option A — shared bootstrap loader (preferred in backlog):**

```text
shared redis env parser (single source: envSchema or extracted redis slice)
  -> used by InfrastructureConfigModule validate()
  -> used by getRedisStartupConfig() / assertRedisAvailable() before Nest

Connection fields used by probe === fields in mapAppConfigToRedisOptions(config)
Startup policy fields (maxAttempts, retryDelayMs) remain probe-only but parsed from same envSchema keys
```

**Option B — post-Nest preflight:**

```text
NestFactory.create*(module with InfrastructureConfigModule only or full module)
  -> AppConfigService.redis()
  -> assertRedisAvailable(mapRedisConfigToStartupOptions(config.redis(), startupPolicy))
  -> continue bootstrap / processors
```

**Symbols on the verification path:**

| Path                                                                 | Symbol / responsibility                                                              |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `apps/api/src/main.ts`                                               | `bootstrap()` — Redis preflight call site                                            |
| `apps/worker/src/main.ts`                                            | `bootstrap()` — Redis preflight call site                                            |
| `apps/cron/src/main.ts`                                              | `bootstrap()` — Redis preflight call site                                            |
| `libs/infrastructure/src/redis/redis-startup-config.ts`              | `getRedisStartupConfig()` — **must not** own duplicate Zod schema after fix          |
| `libs/infrastructure/src/config/env.schema.ts`                       | `envSchema` — canonical Redis env keys and defaults                                  |
| `libs/infrastructure/src/config/infrastructure-config.module.ts`     | `validate` — maps parsed env to `redis` config shape                                 |
| `libs/infrastructure/src/config/app-config.service.ts`               | `redis()` — typed Redis connection + `keyPrefix`                                     |
| `libs/infrastructure/src/config/create-starter-kit-module-options.ts`| `mapAppConfigToRedisOptions()` — composition-root mapper to `RedisModuleOptions`     |
| `libs/infrastructure/src/redis/redis.module-options.ts`              | `RedisModuleOptions` — runtime module contract                                       |
| `libs/infrastructure/src/redis/redis.module.ts`                      | `forRootAsync` factory — creates runtime ioredis client                              |
| `libs/infrastructure/src/redis/assert-redis-available.ts`            | `assertRedisAvailable()` — TCP/PING probe (connection fields from shared config)     |
| `apps/api/src/api.module.ts`, `apps/worker/src/worker.module.ts`, `apps/cron/src/cron.module.ts` | `RedisModule.forRootAsync` registration |

## Goal

Independently confirm — with code inspection, unit-test evidence, and optional runtime bootstrap checks — that API, Worker, and Cron Redis startup preflight uses the **same parsed Redis connection configuration** as `RedisModule.forRootAsync(...)` / `mapAppConfigToRedisOptions`, with no duplicate env schemas or divergent defaults, and that invalid Redis env fails consistently across all three entrypoints.

## Scope

| Activity                              | Responsibility        | Notes                                                                 |
| ------------------------------------- | --------------------- | --------------------------------------------------------------------- |
| Unify Redis startup + Nest typed config | **P2-16 implementer** | Remove duplicate parsing; shared loader or post-Nest preflight        |
| Independent verification              | **V-22 verifier**     | Inspect diff, run commands, write `docs/agent-reports/V-22-verification.md` |

## Out of scope

- Implementing the P2-16 fix (separate implementation plan required).
- **P3-03** log-prefix / `.env.example` comment cleanup (already implemented; do not re-open unless regression found).
- **P2-14** `REDIS_KEY_PREFIX` / namespaced keys (startup probe does not need `keyPrefix` for TCP connect; verifier should not fail V-22 solely because probe ignores `keyPrefix`).
- **P3-05** README host-run vs Docker env examples (V-25 verification scope).
- BullMQ connection options beyond shared Redis host/port/password/db/timeout.
- Migrations entrypoint (does not use Redis startup check).
- Marking P2-16 or V-22 resolved in backlog without implementation + verification evidence.

## Files to create

| File                                      | Symbol / responsibility                                                        |
| ----------------------------------------- | ------------------------------------------------------------------------------ |
| `docs/agent-reports/V-22-verification.md` | Independent verification report (verifier output; not created during planning) |

**Prerequisite from P2-16 (implementer may create):**

| File                                                              | Symbol / responsibility                                                                 |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `libs/infrastructure/src/config/redis-env.schema.ts` (or similar) | Shared `parseRedisEnv` / `mapEnvToRedisConnectionOptions` — **if** implementer extracts slice |
| `libs/infrastructure/src/redis/redis-startup-config.spec.ts`    | Parity tests: startup connection options === `mapAppConfigToRedisOptions` inputs        |
| `libs/infrastructure/src/config/env.schema.spec.ts` (extend)      | Optional: Redis env edge cases shared with startup helper                               |

Exact new filenames depend on approved P2-16 plan; verifier validates **single source of truth**, not a mandated file name.

## Files to modify

None during verification planning. Verifier inspects changes from P2-16:

| File                                                                 | What to verify                                                                                                      |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `libs/infrastructure/src/redis/redis-startup-config.ts`              | No standalone `redisStartupEnvSchema`; delegates to `envSchema` or shared redis env parser                          |
| `libs/infrastructure/src/config/env.schema.ts`                       | Canonical Redis keys; startup policy keys; no conflicting defaults elsewhere                                        |
| `libs/infrastructure/src/config/infrastructure-config.module.ts`     | `redis` mapping uses same parser/helper as startup path                                                             |
| `apps/api/src/main.ts`                                               | Preflight still runs before full HTTP bootstrap; uses unified config API                                            |
| `apps/worker/src/main.ts`                                            | Same                                                                                                                |
| `apps/cron/src/main.ts`                                              | Same                                                                                                                |
| `libs/infrastructure/src/config/create-starter-kit-module-options.ts`| `mapAppConfigToRedisOptions` unchanged contract or explicitly shared mapper with startup                          |
| `.env.example` / `README.md`                                         | Updated only if P2-16 changes canonical Redis env keys (per P2-16 acceptance criteria)                              |

## Files to delete

None expected. Verifier should confirm `redis-startup-config.ts` is not removed if it becomes a thin wrapper over shared parsing (file may remain as export surface).

## Contract and DI changes

- **Verifier expectation after P2-16:** Redis **connection** fields (`host`, `port`, `password`, `db`, `connectTimeoutMs`) consumed by `assertRedisAvailable()` match those passed to `RedisModule.forRootAsync` via `mapAppConfigToRedisOptions`.
- **Startup policy fields** (`maxAttempts`, `retryDelayMs`) remain probe-specific but must be parsed from the same `envSchema` keys — not a second schema.
- **No new Nest DI tokens** required for Option A; Option B may reorder bootstrap but must preserve Worker/Cron “no BullMQ reconnect storm before probe” invariant documented in `apps/worker/src/main.ts`.
- **`RedisModuleOptions` / `@contracts/*`:** no breaking port changes expected; additive shared parsers in infrastructure config layer only.

## Implementation steps

V-22 is a verification issue. Steps below are for the **independent verifier** after P2-16 implementation is complete.

### Prerequisite gate

1. Confirm **P2-16 plan** exists under `docs/agent-plans/` with `status: approved`.
2. Confirm P2-16 implementation exists (inspect `git diff`; read `docs/agent-reports/P2-16-implementation.md` if present, but do not trust it without code inspection).
3. If P2-16 is not implemented, stop and return verdict **`changes-required`** with note: underlying defect still open.

### Step 1 — Scope and diff review

1. Run `git status` and `git diff`.
2. Confirm changes are P2-16-scoped (config + redis startup + three `main.ts` if needed; tests/docs).
3. Confirm no unrelated refactors (P2-14 key prefix, P2-17 auth overrides, P2-18 Jest config).

### Step 2 — Single-source config trace (mandatory)

1. **Grep for duplicate schema:**

   ```bash
   rg "redisStartupEnvSchema" libs/infrastructure/src
   rg "REDIS_HOST.*default\('localhost'\)" libs/infrastructure/src
   ```

   **Expected after fix:** at most one Zod definition for Redis connection env keys (in `env.schema.ts` or a single imported `redis-env.schema.ts`). `redis-startup-config.ts` must not define a parallel `z.object({ REDIS_HOST: … })`.

2. **Trace connection field mapping:**

   ```text
   process.env
     -> [single parse]
     -> connection: { host, port, password, db, connectTimeoutMs }
          -> getRedisStartupConfig() / assertRedisAvailable()
          -> InfrastructureConfigModule validate → AppConfigService.redis()
          -> mapAppConfigToRedisOptions() → RedisModule
   ```

3. **Password normalization:** confirm empty `REDIS_PASSWORD` behaves identically (both `undefined` at ioredis layer).

### Step 3 — Parity unit verification (mandatory)

Run P2-16-added tests (adjust paths to match implementation):

```bash
npm ci
npx jest libs/infrastructure/src/redis/redis-startup-config.spec.ts --runInBand
```

**Expected:** tests assert that for representative env fixtures (Docker `REDIS_HOST=redis`, host-run `localhost`, empty password, custom port/db/timeout):

- `getRedisStartupConfig(env).{host,port,password,db,connectTimeoutMs}` equals connection subset of `mapAppConfigToRedisOptions` after parsing same env through `envSchema`.

If implementer places parity tests in `env.schema.spec.ts`, run that file instead and document path in verification report.

**Minimum table-driven cases:**

| Case                    | Env fixture                         | Pass condition                                      |
| ----------------------- | ----------------------------------- | --------------------------------------------------- |
| Docker service name     | `REDIS_HOST=redis`                  | Probe targets `redis`, not `localhost` fallback     |
| Host-run                | `REDIS_HOST=localhost`              | Same host in startup and `config.redis()`           |
| Empty password          | `REDIS_PASSWORD=`                   | Both paths → `undefined` password at ioredis        |
| Invalid port            | `REDIS_PORT=0` or non-numeric       | Startup and Nest config fail consistently (or both accept per single schema) |
| Invalid host (if schema)| `REDIS_HOST=` empty string          | Same fail-fast behavior in both paths               |

### Step 4 — Static entrypoint consistency (mandatory)

Confirm all three entrypoints use the same helper signature:

```bash
rg "assertRedisAvailable" apps/api/src/main.ts apps/worker/src/main.ts apps/cron/src/main.ts
rg "getRedisStartupConfig" apps/api/src/main.ts apps/worker/src/main.ts apps/cron/src/main.ts
```

**Expected:** identical import and call pattern (or shared `runRedisStartupCheck()` wrapper introduced by P2-16).

### Step 5 — Module bootstrap verification (mandatory)

```bash
npm run build:api
npm run build:worker
npm run build:cron
npx jest apps/cron/src/cron.module.spec.ts --runInBand
npx jest libs/infrastructure/src/redis/redis.module.spec.ts --runInBand
```

**Expected:** exit 0; `RedisModule.forRootAsync` still resolves with typed options from `AppConfigService`.

**Note:** `apps/api/src/api.module.spec.ts` and `apps/worker/src/worker.module.spec.ts` do not exist today. Cron module spec (`apps/cron/src/cron.module.spec.ts`) plus `redis.module.spec.ts` are the available module-bootstrap evidence unless P2-16 adds API/Worker module specs.

### Step 6 — Optional runtime bootstrap (when Redis available)

With Redis reachable and env matching `.env.example` Docker layout (`REDIS_HOST=redis` or local `localhost`):

```bash
npm run start:api
# spot-check worker/cron logs if feasible
```

**Expected:**

- `[redis-startup] Redis is available at <host>:<port>` uses same host/port as configured in env (not silent `localhost` when `REDIS_HOST=redis`).
- Nest bootstrap completes after probe.

If Redis unavailable, record under **Unverified areas** — not a project defect.

### Step 7 — Lint and full build

```bash
npm run lint
npm run build
```

Record exit codes. Infrastructure config changes require full build per `AGENTS.md`.

### Step 8 — Documentation alignment

If P2-16 touches operator docs:

1. `.env.example` — Redis keys remain canonical; no duplicate aliases.
2. `README.md` — Redis connection docs consistent with single config path (cross-check P3-05 / V-25 if README updated).

### Step 9 — Write verification report

Create `docs/agent-reports/V-22-verification.md` using structure from `.cursor/skills/change-verification/SKILL.md`:

```markdown
# V-22 — Independent verification

## Verdict

approved | changes-required | not-confirmed

## Scope checked

## Root-cause assessment

## Acceptance criteria matrix

## Config parity verification

## Commands executed

## Findings

## Documentation alignment

## Remaining risks

## Unverified areas
```

Include per-command records:

```text
Command:
Result:
Conclusion:
```

## Migration and rollout concerns

Verification is read-only. P2-16 should not require Redis data migration. If P2-16 changes env key names (unlikely), document operator migration in P2-16 plan; V-22 confirms `.env.example` alignment.

**Ordering with P3-05 / V-25:** Docker vs host-run `REDIS_HOST` examples are related but verified separately under V-25; V-22 focuses on **same parser** for whichever host is configured.

## Targeted verification

| Command / check                                                                      | Expected result                                           |
| ------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| `rg "redisStartupEnvSchema" libs/infrastructure/src`                                 | No match after P2-16                                      |
| `npx jest libs/infrastructure/src/redis/redis-startup-config.spec.ts --runInBand`    | Passes; connection parity with `mapAppConfigToRedisOptions` |
| `rg "assertRedisAvailable\(getRedisStartupConfig" apps/**/main.ts`                   | Three entrypoints, same pattern                           |
| `npm run build:api && npm run build:worker && npm run build:cron`                    | Exit 0                                                    |
| `npx jest apps/cron/src/cron.module.spec.ts libs/infrastructure/src/redis/redis.module.spec.ts --runInBand` | Exit 0                                        |

## Full verification

| Command                    | Expected result                                                            |
| -------------------------- | -------------------------------------------------------------------------- |
| `npm run build`            | Full monorepo compiles                                                     |
| `npm run lint`             | No new lint errors from P2-16 changes                                      |
| `npm run test:unit`        | Passes (including new redis startup parity specs)                          |
| `npm run test:module`      | Passes; at minimum `cron.module.spec.ts` and `redis.module.spec.ts`        |
| Optional runtime bootstrap | `[redis-startup]` host matches env; Nest starts when Redis up              |

## Acceptance criteria

Mapped to backlog P2-16 / V-22:

| ID   | Criterion                                                                 | Verification method                              | Pass condition                                                                 |
| ---- | ------------------------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------ |
| AC-1 | P2-16 fix implemented and scoped correctly                                | Diff + scope review                              | Only planned config/startup files changed                                      |
| AC-2 | Single typed Redis config source                                          | Grep + code trace                                | No duplicate `redisStartupEnvSchema`; one parser for connection fields       |
| AC-3 | Startup check and `RedisModule` use same connection options               | Parity unit tests + static trace                 | `host`/`port`/`password`/`db`/`connectTimeoutMs` match                         |
| AC-4 | Invalid Redis env fails consistently in API, Worker, Cron                 | Table-driven unit tests or documented env matrix | Same validation errors from shared schema                                      |
| AC-5 | No hidden `localhost` fallback when `REDIS_HOST=redis`                    | Unit test + optional runtime log                 | Probe logs `redis:6379` (or configured host), not `localhost`                  |
| AC-6 | All three entrypoints use unified startup API                             | `rg` on `main.ts` files                          | Identical preflight wiring                                                     |
| AC-7 | Worker pre-Nest probe ordering preserved (no BullMQ reconnect storm)      | Code review of `apps/worker/src/main.ts`         | `assertRedisAvailable` still before `NestFactory.createApplicationContext` unless P2-16 documents safe alternative |
| AC-8 | `npm run build` passes                                                    | Execute and record                               | Exit 0                                                                         |
| AC-9 | `npm run lint` passes                                                     | Execute and record                               | Exit 0 or only pre-existing unrelated failures documented                      |
| AC-10| Module bootstrap tests pass                                               | `cron.module.spec.ts` + `redis.module.spec.ts` (or P2-16-added API/Worker specs) | Exit 0                                                                         |

**Verdict rules:**

- **`approved`** — AC-1 through AC-10 pass; parity unit tests (AC-3) executed with evidence.
- **`changes-required`** — duplicate schema remains, connection fields diverge, or any entrypoint uses a different config path.
- **`not-confirmed`** — P2-16 not implemented, or required tests/build could not run without unrelated infra failure.

## Risks

1. **False approval from build-only checks** — `npm run build` passes on unfixed `main` with duplicate schemas; parity unit tests and `redisStartupEnvSchema` grep are mandatory.
2. **Partial unification** — connection fields shared but startup policy keys still parsed separately; AC-2 fails if any Redis env key is parsed in two places.
3. **Post-Nest preflight regression (Option B)** — BullMQ/ioredis clients may start reconnecting before probe; Worker comment in `main.ts` must be honored; AC-7 guards this.
4. **Password empty-string vs undefined** — subtle ioredis auth difference if one path normalizes and the other does not; parity tests must cover `REDIS_PASSWORD=`.
5. **P2-16 plan missing** — V-22 verification blocked until human-approved P2-16 implementation plan and implementation exist.
6. **Conflation with P3-03** — log prefix already fixed; do not reject P2-16 fix for lacking `[api-startup]` on Redis probe lines if neutral `[redis-startup]` remains.

## Rollback strategy

Verification is read-only. If verdict is `changes-required`, revert to P2-16 implementer — no verifier code changes.

## Open questions requiring human decision

1. **P2-16 implementation plan** — should a separate `docs/agent-plans/P2-16-*.md` be created and approved before implementation (recommended), with V-22 as verification-only follow-up?
2. **Preferred fix strategy** — Option A (shared bootstrap loader from `envSchema`) vs Option B (post-Nest `AppConfigService` probe)? V-22 accepts either if AC-2–AC-7 pass.
3. **Full `envSchema` parse before Nest** — startup helper currently avoids requiring `DATABASE_URL` / JWT secrets for Redis-only probe. If P2-16 uses full `envSchema.parse`, invalid non-Redis env could fail Redis preflight earlier. Is that acceptable fail-fast behavior?
4. **Verification ordering** — must V-22 wait for a separate P2-16 verification report, or is V-22 the canonical Redis startup config verification?
5. **Runtime bootstrap evidence** — is parity unit-test coverage sufficient for `approved`, or is manual `npm run start:api` with `REDIS_HOST=redis` mandatory when Redis is available?
