# P1-04 — Implementation report

## Verdict

implemented (verification follow-up complete)

## Verification follow-up (2026-06-20)

Independent verification (`docs/agent-reports/P1-04-verification.md`) returned **changes-required** because removing `@Global()` left consumer modules without explicit connection-module imports. This follow-up addresses the blocking DI defect.

### Root cause of verification failure

NestJS module encapsulation: registering `RedisModule.forRootAsync` / `DrizzleModule.forRootAsync` at the entrypoint root does not expose `RedisService`, `REDIS_CLIENT`, or `DRIZZLE_DB` to sibling imported feature modules (`IdempotencyModule`, `RepositoriesModule`, etc.).

### Fix applied

1. **Feature modules expose `register({ imports })`** — `IdempotencyModule`, `RateLimiterModule`, `LocksModule`, `CacheModule`, `HealthModule`, `RepositoriesModule`, `TransactionsModule`, `OutboxWriterModule`, `AuditModule`, `EventsModule` accept configured connection dynamic modules via `imports`.
2. **Composition roots pass shared module references** — `api.module.ts`, `auth-application.module.ts`, `worker.module.ts`, `cron.module.ts`, and deprecated `InfrastructureModule.forRoot()` create `const redisModule = RedisModule.forRootAsync(...)` (and Drizzle/BullMQ equivalents) once, then pass the same reference into each consumer `register()` call (Nest deduplicates by reference).
3. **`OutboxProcessorModule`** — builds nested `AuditModule.register` / `EventsModule.register` imports from `forRootAsync` connection imports.
4. **`AuthModule`** — `auth-application.module.ts` passes `redisModule` into `AuthModule.forRootAsync({ imports: [..., redisModule] })` and re-exports `authModule` so `AuthGuard` in `ApiModule` resolves `TOKENS.AuthTokenService`.
5. **BullMQ queue registration** — `registerQueues(names, { imports: [connectionModule] })` uses a separate `InfrastructureBullMqQueuesModule` class to avoid same-module dynamic registration conflicts; connection module explicitly exports `BULLMQ_MODULE_OPTIONS`; `BullQueueGateway` resolves queues with `moduleRef.get(..., { strict: false })`.
6. **`RateLimiterModule.register`** — includes `InfrastructureConfigModule` because `RateLimiterGuard` still reads rate-limit defaults from `AppConfigService` at the composition boundary.

### Verification follow-up commands

| Command                                                                               | Result                                   | Conclusion                          |
| ------------------------------------------------------------------------------------- | ---------------------------------------- | ----------------------------------- |
| `npm run build`                                                                       | Exit 0                                   | Full monorepo compile success       |
| `Test.createTestingModule({ imports: [ApiModule] }).compile()`                        | OK                                       | Entrypoint DI graph resolves        |
| `Test.createTestingModule({ imports: [AuthApplicationCompositionModule] }).compile()` | OK                                       | Auth + Drizzle consumers resolve    |
| `Test.createTestingModule({ imports: [WorkerModule] }).compile()`                     | OK                                       | Worker DI graph resolves            |
| `Test.createTestingModule({ imports: [CronModule] }).compile()`                       | OK                                       | Cron DI graph resolves              |
| P1-04 module specs (6 files)                                                          | Exit 0 — 10 tests passed                 | Isolated module contracts unchanged |
| Targeted ESLint (changed paths)                                                       | Exit 1 in pre-existing outbox files only | No new lint in P1-04 fix scope      |

## Approved plan

`docs/agent-plans/P1-04-infrastructure-module-portability.md` (`status: approved`)

## Changed files

### Created

| Path                                                                  | Responsibility                              |
| --------------------------------------------------------------------- | ------------------------------------------- |
| `libs/infrastructure/src/redis/redis.module-options.ts`               | `RedisModuleOptions` type                   |
| `libs/infrastructure/src/redis/redis.module.spec.ts`                  | Isolated Redis module bootstrap test        |
| `libs/infrastructure/src/database/drizzle/drizzle.module-options.ts`  | `DrizzleModuleOptions` type                 |
| `libs/infrastructure/src/database/drizzle/drizzle.module.spec.ts`     | Isolated Drizzle module bootstrap test      |
| `libs/infrastructure/src/bullmq/bullmq.module-options.ts`             | BullMQ connection + registered queue tokens |
| `libs/infrastructure/src/bullmq/bullmq.module.spec.ts`                | Selective queue registration test           |
| `libs/infrastructure/src/auth/auth.module-options.ts`                 | Auth driver + branch options                |
| `libs/infrastructure/src/auth/auth.module.spec.ts`                    | Per-driver provider graph tests             |
| `libs/infrastructure/src/mail/mail.module-options.ts`                 | Mail driver options                         |
| `libs/infrastructure/src/mail/mail.module.spec.ts`                    | Single-adapter instantiation test           |
| `libs/infrastructure/src/storage/storage.module-options.ts`           | Storage driver options                      |
| `libs/infrastructure/src/storage/storage.module.spec.ts`              | Single-adapter instantiation test           |
| `libs/infrastructure/src/config/create-starter-kit-module-options.ts` | `AppConfigService` → module options mappers |
| `docs/infrastructure-modules/README.md`                               | Standalone integration examples per module  |

### Modified (high level)

| Area                                 | Files                                                                                                                        |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| Connection modules                   | `redis.module.ts`, `drizzle.module.ts`, `bullmq.module.ts`, `queue.gateway.ts`                                               |
| Adapter modules                      | `auth.module.ts`, auth services, `mail.module.ts`, mail/storage adapters, `storage.module.ts`                                |
| Removed `@Global()` / hidden imports | `repositories`, `transactions`, `locks`, `idempotency`, `cache`, `rate-limiter`, `health`, `audit`, `events`, outbox modules |
| Entrypoints                          | `apps/api/src/api.module.ts`, `auth-application.module.ts`, `worker.module.ts`, `cron.module.ts`                             |
| Facade + docs                        | `infrastructure.module.ts` (deprecated `forRoot()`), `EXAMPLES.md`, `README.md`, `MODULES_OVERVIEW_NON_TECH.md`              |

## Completed steps

### Phase 1 — RedisModule

1. Added `RedisModuleOptions` + `ConfigurableModuleBuilder` (`forRoot` / `forRootAsync`, `global: false`).
2. Factory uses `REDIS_MODULE_OPTIONS` + `AppLogger` (no `AppConfigService` inside module).
3. Removed `@Global()`; consumer modules no longer import static `RedisModule`.
4. Added `forRootFromAppConfig()` deprecated shim.
5. Added `redis.module.spec.ts`.

### Phase 2 — DrizzleModule

1. Added `DrizzleModuleOptions` + dynamic registration.
2. Removed `@Global()`; Drizzle consumers rely on composition-root imports.
3. Added `drizzle.module.spec.ts` + deprecated shim.

### Phase 3 — BullMQ

1. Split into `forRootAsync` (connection + default job options) and `registerQueues(names)`.
2. Refactored `BullQueueGateway` to resolve only registered queues via `ModuleRef` + `BULLMQ_REGISTERED_QUEUES`.
3. Entrypoint queue sets: API `[OUTBOX]`, Worker `[OUTBOX, EMAIL]`, Cron `[OUTBOX]`.
4. Worker/Cron pass Drizzle + BullMQ into `OutboxProcessorModule.forRootAsync` imports for nested `EventsModule` / audit path.
5. Added `bullmq.module.spec.ts` + deprecated `forRootFromAppConfig(queueNames)` shim.

### Phase 4 — AuthModule

1. Added `AuthModuleOptions` with `jwt` / `session` driver branches.
2. Sync `forRoot` registers only the selected branch; `forRootAsync` uses factory construction for a single `TOKENS.AuthTokenService`.
3. Auth services consume `AUTH_MODULE_OPTIONS` instead of `AppConfigService`.
4. Wired `AuthModule.forRootAsync` in `auth-application.module.ts`.
5. Added `auth.module.spec.ts`.

### Phase 5 — Mail / Storage

1. Single-adapter registration via `useExisting` (sync) or factory (async).
2. Adapters accept typed module options.
3. `MailModule.forRootAsync` wired in `WorkerModule`.
4. Added mail/storage module specs.

### Phase 6 — Remove remaining globals

1. Removed `@Global()` from `RepositoriesModule`, `TransactionsModule`, and all connection modules.
2. Removed hidden connection imports from feature modules.

### Phase 7 — Config composition

1. Added `create-starter-kit-module-options.ts` mappers.
2. Kept `InfrastructureConfigModule` unchanged as full-kit convenience.

### Phase 8 — Entrypoint explicit composition

1. `api.module.ts` explicitly imports Redis, Drizzle, BullMQ (OUTBOX).
2. `auth-application.module.ts` explicitly imports Redis, Drizzle, Auth.
3. Worker/Cron modules import connection modules and queue sets explicitly.

### Phase 9 — Facade + docs

1. `InfrastructureModule.forRoot()` deprecated facade mapping env → all modules.
2. Added `docs/infrastructure-modules/README.md` + EXAMPLES §13 + README/MODULES pointers.
3. Deprecated shims retained (`forRootFromAppConfig` per module).

## Deviations

- `OutboxProcessorModule.forRootAsync` in Worker/Cron repeats Drizzle/BullMQ imports so nested `EventsModule` / audit providers resolve queue and DB tokens (Nest module visibility, not duplicate connections when deduped by Nest).
- `npm run build` (chained) intermittently exited `-1073741819` on Windows; per-entrypoint builds (`build:api`, `build:worker`, `build:cron`, `build:migrations`) all succeeded.
- Full `npm run lint` reports pre-existing unused symbols in outbox files unrelated to P1-04.

## Commands executed

```bash
npm run build:api
npm run build:worker
npm run build:cron
npm run build:migrations
npx jest libs/infrastructure/src/redis/redis.module.spec.ts \
  libs/infrastructure/src/database/drizzle/drizzle.module.spec.ts \
  libs/infrastructure/src/bullmq/bullmq.module.spec.ts \
  libs/infrastructure/src/auth/auth.module.spec.ts \
  libs/infrastructure/src/mail/mail.module.spec.ts \
  libs/infrastructure/src/storage/storage.module.spec.ts \
  --config jest.unit.config.ts --runInBand
npx eslint libs/infrastructure/src/redis libs/infrastructure/src/database/drizzle \
  libs/infrastructure/src/bullmq libs/infrastructure/src/auth libs/infrastructure/src/mail \
  libs/infrastructure/src/storage libs/infrastructure/src/config/create-starter-kit-module-options.ts \
  libs/infrastructure/src/infrastructure.module.ts apps/api/src apps/worker/src apps/cron/src \
  --max-warnings=0
npm run test:unit -- --runInBand
npm run lint
```

## Command results

| Command                            | Result                       | Conclusion                                                          |
| ---------------------------------- | ---------------------------- | ------------------------------------------------------------------- |
| `npm run build:api`                | Exit 0                       | API compiles with explicit infrastructure imports                   |
| `npm run build:worker`             | Exit 0                       | Worker compiles; OUTBOX + EMAIL queues                              |
| `npm run build:cron`               | Exit 0                       | Cron compiles; OUTBOX queue                                         |
| `npm run build:migrations`         | Exit 0                       | Migrations entrypoint unaffected                                    |
| Targeted module specs (6 files)    | Exit 0 — 10 tests passed     | Isolated bootstrap / single adapter / driver branch verified        |
| Targeted ESLint (P1-04 paths)      | Exit 0                       | No lint issues in changed scope                                     |
| `npm run test:unit -- --runInBand` | Exit 1 — 63 passed, 1 failed | Failure in `outbox-processor.options.schema.spec.ts` (pre-existing) |
| `npm run lint` (full)              | Exit 1                       | Pre-existing unused vars in outbox files; not introduced by P1-04   |

## Acceptance criteria self-check

| Criterion                                                        | Status                                                                                                                                     |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Each reusable module has typed sync/async configuration          | Pass — Redis, Drizzle, BullMQ, Auth, Mail, Storage                                                                                         |
| Module connectable without `InfrastructureConfigModule` in tests | Pass — 6 new `*.module.spec.ts` files                                                                                                      |
| Only selected Auth/Mail/Storage adapter created                  | Pass — module specs + factory/useExisting registration                                                                                     |
| Composition roots explicitly import dependencies                 | Pass — roots configure connection modules once; consumers use `register({ imports: [sharedModuleRef] })`; entrypoint DI compile tests pass |
| Entrypoint boundaries unchanged (no Worker in API/Cron)          | Pass — static review; processors unchanged                                                                                                 |
| Docs contain standalone integration example per module           | Pass — `docs/infrastructure-modules/README.md` + EXAMPLES §13                                                                              |

## Remaining risks

- Custom downstream entrypoints must pass configured connection module references into each feature `register()` call; importing only `IdempotencyModule` without `register()` will fail DI.
- Consumers importing deprecated shims may keep duplicate module registrations until migrated to explicit composition.
- `AuthModule` requires a configured `RedisModule` in `forRootAsync({ imports: [...] })` — documented but easy to miss in custom entrypoints.
- `InfrastructureModule.forRoot()` still registers all BullMQ queue names for backward compatibility (differs from trimmed entrypoint sets).
- Deprecated shims not yet removed (planned after all entrypoints migrate).

## Unverified areas

- Runtime bootstrap (`npm run start:api`, `start:worker`, `start:cron`) — PostgreSQL/Redis not confirmed available in implementer environment; DI compile tests now pass without live infra.
- `npm run test:int` — not run (no infra guarantee).
- Full `npm run lint` — pre-existing unused vars in `outbox-processor.defaults.ts` / `outbox-processor.options.schema.ts`.
- Full `npm run test:unit` — not re-run in follow-up; one pre-existing failure reported in `outbox-processor.options.schema.spec.ts`.
