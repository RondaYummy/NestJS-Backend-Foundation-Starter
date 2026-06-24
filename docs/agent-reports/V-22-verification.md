# V-22 — Independent verification

## Verdict

**not-confirmed** — prerequisite **P2-16** is not implemented; underlying configuration defect remains open.

## Scope checked

**Plan status:** `docs/agent-plans/V-22-redis-startup-typed-config-verification.md` — `status: approved` ✓

**Linked defect:** **P2-16** (`docs/agent-backlog/NESTJS_STARTER_KIT_REQUIRED_FIXES.md` — section P2-16, lines ~1364–1427).

**P2-16 plan:** No `docs/agent-plans/P2-16-*.md` found. **Prerequisite gate failed** — verification stopped per V-22 plan Step 1.

**Git state (2026-06-24):** No production code changes related to Redis startup config unification. Unrelated local doc changes only (`docs/agent-backlog/INDEX.md` staged deletion, `NESTJS_STARTER_KIT_REQUIRED_FIXES.md` edits).

## Root-cause assessment

**Original defect (still present):** Redis startup preflight uses a **second, parallel configuration path** in `libs/infrastructure/src/redis/redis-startup-config.ts`:

```4:20:libs/infrastructure/src/redis/redis-startup-config.ts
const redisStartupEnvSchema = z.object({
  REDIS_HOST: z.string().min(1).default('localhost'),
  REDIS_PORT: z.coerce.number().int().positive().default(6379),
  // ...
});

export function getRedisStartupConfig(
  environment: NodeJS.ProcessEnv = process.env,
): RedisStartupCheckOptions {
  const env = redisStartupEnvSchema.parse(environment);
```

Nest runtime uses canonical `envSchema` via `InfrastructureConfigModule` → `AppConfigService.redis()` → `mapAppConfigToRedisOptions()`.

**Fix status:** Not implemented. Duplicate `redisStartupEnvSchema` remains; no shared parser; no parity unit tests.

### Current (broken) flow

```text
apps/api|worker|cron main.ts
  -> assertRedisAvailable(getRedisStartupConfig())
       -> redisStartupEnvSchema.parse(process.env)   ❌ duplicate schema

Nest bootstrap
  -> InfrastructureConfigModule
       -> envSchema.safeParse(process.env)             ✓ canonical schema
       -> AppConfigService.redis()
  -> RedisModule.forRootAsync({ useFactory: mapAppConfigToRedisOptions })
```

### Schema divergence (confirmed)

| Field / behavior | `redisStartupEnvSchema` | `envSchema` |
| ---------------- | ----------------------- | ----------- |
| `REDIS_HOST` | `z.string().min(1).default('localhost')` | `z.string().default('localhost')` |
| `REDIS_PORT` | `z.coerce.number().int().positive().default(6379)` | `z.coerce.number().default(6379)` |
| `REDIS_DB` | `z.coerce.number().int().nonnegative().default(0)` | `z.coerce.number().default(0)` |
| `REDIS_PASSWORD` | optional; `\|\| undefined` at mapper | optional; passed through; module uses `\|\| undefined` |

## Acceptance criteria matrix

| ID | Criterion | Status | Evidence |
| -- | --------- | ------ | -------- |
| AC-1 | P2-16 fix implemented and scoped correctly | **failed** | No P2-16 diff; no implementation report |
| AC-2 | Single typed Redis config source | **failed** | `rg "redisStartupEnvSchema"` — 2 matches in `redis-startup-config.ts` |
| AC-3 | Startup check and `RedisModule` use same connection options | **failed** | Separate parsers; no `redis-startup-config.spec.ts` |
| AC-4 | Invalid Redis env fails consistently | **failed** | Divergent validation rules (e.g. `min(1)` on host in startup only) |
| AC-5 | No hidden `localhost` fallback when `REDIS_HOST=redis` | **not confirmed** | No parity tests; both schemas default to `localhost` when unset |
| AC-6 | All three entrypoints use unified startup API | **passed** (wiring only) | Identical `assertRedisAvailable(getRedisStartupConfig())` in API/Worker/Cron `main.ts` |
| AC-7 | Worker pre-Nest probe ordering preserved | **passed** (static) | `apps/worker/src/main.ts` — probe before `NestFactory.createApplicationContext` |
| AC-8 | `npm run build` passes | **not confirmed** | Not executed — prerequisite gate stop |
| AC-9 | `npm run lint` passes | **not confirmed** | Not executed — prerequisite gate stop |
| AC-10 | Module bootstrap tests pass | **not confirmed** | Not executed — prerequisite gate stop |

## Config parity verification

**Duplicate schema grep:**

```text
Command: rg "redisStartupEnvSchema" libs/infrastructure/src
Result: 2 matches — libs/infrastructure/src/redis/redis-startup-config.ts:4, :20
Conclusion: AC-2 fails — parallel Zod object still owns Redis env keys
```

**Entrypoint consistency:**

```text
Command: rg "assertRedisAvailable|getRedisStartupConfig" apps/*/src/main.ts
Result: API line 18, Worker line 29, Cron line 15 — identical import/call pattern
Conclusion: AC-6 wiring consistent, but all three call unfixed duplicate-schema helper
```

**Parity unit tests:**

```text
Command: (file check) libs/infrastructure/src/redis/redis-startup-config.spec.ts
Result: File does not exist
Conclusion: AC-3 mandatory evidence missing
```

## Commands executed

| Command | Result | Conclusion |
| ------- | ------ | ---------- |
| `git status` | On `main`; no P2-16 production changes | Underlying fix absent |
| `git diff --stat` | Doc-only local changes | No verification target diff |
| `rg "redisStartupEnvSchema" libs/infrastructure/src` | 2 matches in `redis-startup-config.ts` | Duplicate schema confirmed |
| `rg "assertRedisAvailable\|getRedisStartupConfig" apps/api/src/main.ts apps/worker/src/main.ts apps/cron/src/main.ts` | 3 entrypoints, same pattern | AC-6 wiring only |
| Glob `docs/agent-plans/P2-16-*.md` | 0 files | Prerequisite gate failed |
| Glob `docs/agent-reports/P2-16-*.md` | 0 files | No prior implementation |

## Findings

### Confirmed defect (unchanged since investigation)

1. `getRedisStartupConfig()` parses raw `process.env` through local `redisStartupEnvSchema`, not `envSchema`.
2. `InfrastructureConfigModule` validates via `envSchema.safeParse` and maps Redis fields separately.
3. No unit tests assert parity between startup connection options and `mapAppConfigToRedisOptions`.
4. Risk scenario from backlog remains: future `envSchema` changes will not propagate to pre-Nest probe automatically.

### What would satisfy V-22 (post P2-16)

Per approved V-22 plan — either Option A (shared bootstrap loader from `envSchema` / extracted redis slice) or Option B (post-Nest preflight from `AppConfigService`), provided:

- No `redisStartupEnvSchema` in codebase;
- Parity unit tests pass for Docker `REDIS_HOST=redis`, host-run `localhost`, empty password, invalid port/host;
- `npm run build`, `npm run lint`, module specs pass.

## Documentation alignment

Not assessed — P2-16 not implemented; `.env.example` / README updates deferred to P2-16 implementer per backlog.

## Remaining risks

1. Silent validation drift between pre-Nest and post-Nest paths until P2-16 lands.
2. Stricter startup schema (`min(1)` on `REDIS_HOST`) can fail API/Worker/Cron before Nest would accept the same env.
3. Build/lint may pass on unfixed branch — must not be used as sole verification signal.

## Unverified areas

- `npm run build` / `npm run build:api|worker|cron`
- `npm run lint`
- `npm run test:unit` / parity spec execution
- `npx jest apps/cron/src/cron.module.spec.ts libs/infrastructure/src/redis/redis.module.spec.ts`
- Runtime bootstrap with Redis available (`[redis-startup]` host/port log check)

All deferred until P2-16 is implemented and a follow-up V-22 verification run is requested.
