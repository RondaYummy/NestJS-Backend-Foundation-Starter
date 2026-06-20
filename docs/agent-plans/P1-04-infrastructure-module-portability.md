---
issue_id: P1-04
status: approved
owner: human-approval-required
---

# P1-04 — Make infrastructure modules independently configurable and explicitly composed

## Source issue

`docs/agent-backlog/NESTJS_STARTER_KIT_REQUIRED_FIXES.md` — section **P1-04. Зробити infrastructure modules незалежно конфігурованими й явно скомпонованими**.

Related review baseline: `docs/agent-workflow/NESTJS_STARTER_KIT_REVIEW_PROMPT.md` §1 (modularity and portability).

## Current behavior

1. **`InfrastructureConfigModule`** (`libs/infrastructure/src/config/infrastructure-config.module.ts`) registers one global `ConfigModule.forRoot({ isGlobal: true, validate: envSchema })` that maps the full starter-kit env surface into a monolithic `ConfigShape` consumed by `AppConfigService`.
2. **Six `@Global()` infrastructure modules** hide required dependencies from composition roots:
   - `libs/infrastructure/src/redis/redis.module.ts`
   - `libs/infrastructure/src/database/drizzle/drizzle.module.ts`
   - `libs/infrastructure/src/bullmq/bullmq.module.ts`
   - `libs/infrastructure/src/auth/auth.module.ts`
   - `libs/infrastructure/src/repositories/repositories.module.ts`
   - `libs/infrastructure/src/transactions/transactions.module.ts`
3. **Each global module hard-depends on `AppConfigService`** at registration time (factory `inject: [AppConfigService]`). Consumers cannot supply typed options without importing the full config stack.
4. **`InfrastructureBullMqModule`** registers all nine queues from `libs/contracts/src/queues/queue-names.ts` in every entrypoint that imports it, while runtime usage is limited to `OUTBOX` and `EMAIL`.
5. **`MailModule` and `StorageModule`** register both mutually exclusive adapters (`NullMailAdapter` + `SmtpMailAdapter`; `LocalStorageAdapter` + `S3StorageAdapter`) and select one via factory. Unused adapters are still constructed (`SmtpMailAdapter` creates nodemailer transport; `S3StorageAdapter` creates `S3Client`; `LocalStorageAdapter` resolves storage root in constructor).
6. **`AuthModule`** always registers JWT and Session stacks (`JwtAuthTokenService`, `SessionAuthTokenService`, `RedisJwtTokenStore`, `RedisSessionStore`) and selects `TOKENS.AuthTokenService` via factory.
7. **Only `OutboxProcessorModule`** (`libs/infrastructure/src/outbox/outbox-processor.module.ts`) exposes a typed `forRoot` / `forRootAsync` contract via `ConfigurableModuleBuilder`, with `global: false`.
8. **`InfrastructureModule`** (`libs/infrastructure/src/infrastructure.module.ts`) aggregates the full stack but is **not imported** by any entrypoint (dead facade).
9. **Entrypoint composition roots** import a subset of modules but rely on globals/transitive imports for Redis, Drizzle, BullMQ, Auth, Repositories, and Transactions:
   - `apps/api/src/api.module.ts`
   - `apps/api/src/composition/auth-application.module.ts`
   - `apps/worker/src/worker.module.ts`
   - `apps/cron/src/cron.module.ts`
   - `apps/migrations/src/main.ts` — standalone script, no Nest modules

**Investigation (2026-06-20, branch `main`):** defect confirmed. Issue is **not stale**.

## Confirmed root cause

Reusable infrastructure modules lack typed public configuration contracts and are registered as global singletons wired exclusively through `AppConfigService`. Composition roots therefore inherit hidden providers, cannot minimize per-entrypoint infrastructure, and cannot be tested in isolation without reproducing the full global config schema. Mutually exclusive adapters are all instantiated at startup, causing unnecessary constructor side effects.

## Dependency/runtime flow

### Current (problematic)

```text
Entrypoint (api | worker | cron)
  -> InfrastructureConfigModule (global ConfigModule + envSchema)
       -> AppConfigService
  -> subset of infrastructure modules (some @Global())
       -> hard inject AppConfigService in module factories
       -> hidden transitive providers (Redis, Drizzle, BullMQ, Auth, Repos, Tx)
       -> all Mail/Storage/Auth adapters constructed; factory selects export token
```

### Target

```text
Entrypoint composition root
  -> Feature/adapter Module.forRootAsync({ imports, inject, useFactory })
       -> typed MODULE_OPTIONS token (RedisModuleOptions, DrizzleModuleOptions, ...)
         -> exactly one selected adapter / connection / queue set
           -> exported provider token (REDIS_CLIENT, DRIZZLE_DB, TOKENS.*)
```

**Reference implementation:** `OutboxProcessorModule` + Worker/Cron mapping `config.outbox()` at the composition boundary.

## Goal

Make each reusable infrastructure module independently portable with typed sync/async configuration, explicit composition-root imports, single-adapter instantiation for Auth/Mail/Storage, and entrypoint-specific BullMQ queue registration — while preserving starter-kit convenience through optional env-to-options mapping at composition boundaries.

## Scope

Deliver in **ordered phases** (backlog requires separate implementation slices; do not ship one monolithic rewrite). Each phase must leave the repo buildable and verifiable.

| Phase | Focus                                                                   | Primary modules                                           |
| ----- | ----------------------------------------------------------------------- | --------------------------------------------------------- |
| **1** | Redis dynamic module + explicit imports                                 | `RedisModule`                                             |
| **2** | Drizzle dynamic module + explicit imports                               | `DrizzleModule`                                           |
| **3** | BullMQ `forRootAsync` + `registerQueues`                                | `InfrastructureBullMqModule`, `BullQueueGateway`          |
| **4** | Auth single-driver dynamic module                                       | `AuthModule`                                              |
| **5** | Mail/Storage single-adapter dynamic modules                             | `MailModule`, `StorageModule`                             |
| **6** | Remove `@Global()` from Repositories/Transactions and remaining globals | `RepositoriesModule`, `TransactionsModule`, prior modules |
| **7** | Evolve config composition (env → options mapping at roots)              | `InfrastructureConfigModule`, `env.schema.ts`             |
| **8** | Explicit entrypoint composition roots                                   | `apps/api`, `apps/worker`, `apps/cron` modules            |
| **9** | Compatibility facade + standalone integration docs                      | `InfrastructureModule`, `EXAMPLES.md` / docs              |

**Phase 1–3** are the foundation (connection modules). **Phase 4–5** address adapter side effects. **Phase 6–8** make dependencies visible. **Phase 9** closes acceptance criteria for docs and migration path.

## Out of scope

- **P1-05** — removing NestJS DI decorators from Application use cases.
- **P2-02** — full `QueueJobRegistry` / `QUEUES` parity redesign (coordinate API design only; do not block P1-04 on P2-02 unless human approves joint scope).
- Broad Application-layer refactors.
- Changing domain/contracts ports (tokens remain stable).
- Production migrations or database schema changes.
- Adding real secrets or credentials to the repository.
- Rewriting `apps/migrations` into a Nest bootstrap unless explicitly approved (see open questions).

## Files to create

| File                                                                             | Responsibility                                                    |
| -------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `libs/infrastructure/src/redis/redis.module-options.ts`                          | `RedisModuleOptions`, `REDIS_MODULE_OPTIONS` token                |
| `libs/infrastructure/src/redis/redis.module.spec.ts`                             | Isolated Nest testing module without `InfrastructureConfigModule` |
| `libs/infrastructure/src/database/drizzle/drizzle.module-options.ts`             | `DrizzleModuleOptions` (connection URL / pool settings)           |
| `libs/infrastructure/src/database/drizzle/drizzle.module.spec.ts`                | Isolated module test                                              |
| `libs/infrastructure/src/bullmq/bullmq.module-options.ts`                        | Connection + default job options                                  |
| `libs/infrastructure/src/bullmq/bullmq.module.spec.ts`                           | Queue registration isolation test                                 |
| `libs/infrastructure/src/auth/auth.module-options.ts`                            | Driver, JWT, session, password-hasher options                     |
| `libs/infrastructure/src/auth/auth.module.spec.ts`                               | Per-driver provider graph test                                    |
| `libs/infrastructure/src/mail/mail.module-options.ts`                            | Driver + SMTP/null options                                        |
| `libs/infrastructure/src/mail/mail.module.spec.ts`                               | Single-adapter instantiation test                                 |
| `libs/infrastructure/src/storage/storage.module-options.ts`                      | Driver + local/S3 options                                         |
| `libs/infrastructure/src/storage/storage.module.spec.ts`                         | Single-adapter instantiation test                                 |
| `libs/infrastructure/src/config/create-starter-kit-module-options.ts` (optional) | Shared `AppConfigService` → options mappers for composition roots |
| `docs/infrastructure-modules/README.md` (or `EXAMPLES.md` section)               | Standalone integration example per module                         |

## Files to modify

### Phase 1 — Redis

| File                                                          | Symbol / change                                                                                                                     |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `libs/infrastructure/src/redis/redis.module.ts`               | Add `forRoot`/`forRootAsync` via `ConfigurableModuleBuilder`; remove `@Global()`; factory uses `REDIS_MODULE_OPTIONS` + `AppLogger` |
| `libs/infrastructure/src/locks/locks.module.ts`               | Explicit `RedisModule` import via `forRootAsync` or accept options from parent                                                      |
| `libs/infrastructure/src/idempotency/idempotency.module.ts`   | Explicit `RedisModule` import                                                                                                       |
| `libs/infrastructure/src/cache/cache.module.ts`               | Explicit `RedisModule` import                                                                                                       |
| `libs/infrastructure/src/rate-limiter/rate-limiter.module.ts` | Explicit `RedisModule` import                                                                                                       |
| `libs/infrastructure/src/health/health.module.ts`             | Explicit `RedisModule` import                                                                                                       |
| `libs/infrastructure/src/auth/auth.module.ts`                 | Explicit `RedisModule` import (until Phase 4 refactor)                                                                              |

### Phase 2 — Drizzle

| File                                                          | Symbol / change                                                                 |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `libs/infrastructure/src/database/drizzle/drizzle.module.ts`  | Add `forRoot`/`forRootAsync`; remove `@Global()`                                |
| `libs/infrastructure/src/repositories/repositories.module.ts` | Explicit `DrizzleModule` import                                                 |
| `libs/infrastructure/src/transactions/transactions.module.ts` | Explicit `DrizzleModule` import                                                 |
| `libs/infrastructure/src/outbox/outbox-writer.module.ts`      | Explicit `DrizzleModule` import                                                 |
| `libs/infrastructure/src/audit/audit.module.ts`               | Explicit `DrizzleModule` import                                                 |
| `libs/infrastructure/src/events/events.module.ts`             | Explicit `DrizzleModule` import                                                 |
| `libs/infrastructure/src/outbox/outbox-processor.module.ts`   | Import `DrizzleModule.forRootAsync` or require parent to pass configured module |
| `libs/infrastructure/src/health/health.module.ts`             | Explicit `DrizzleModule` import                                                 |

### Phase 3 — BullMQ

| File                                              | Symbol / change                                                                                       |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `libs/infrastructure/src/bullmq/bullmq.module.ts` | `forRootAsync` for connection; `registerQueues(names)` for selective registration; remove `@Global()` |
| `libs/infrastructure/src/bullmq/queue.gateway.ts` | Inject only registered queues (dynamic registry or conditional `@InjectQueue`)                        |
| `apps/api/src/api.module.ts`                      | Register `OUTBOX` queue (health check)                                                                |
| `apps/worker/src/worker.module.ts`                | Register `OUTBOX`, `EMAIL`                                                                            |
| `apps/cron/src/cron.module.ts`                    | Register `OUTBOX`                                                                                     |
| `libs/infrastructure/src/events/events.module.ts` | Ensure `EMAIL` queue available when handler enqueues                                                  |
| `libs/infrastructure/src/health/health.module.ts` | Import configured BullMQ module                                                                       |

### Phase 4 — Auth

| File                                                             | Symbol / change                                                            |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `libs/infrastructure/src/auth/auth.module.ts`                    | `forRootAsync`; register only selected driver branch                       |
| `libs/infrastructure/src/auth/jwt-auth-token.service.ts`         | Accept options token instead of `AppConfigService` where feasible          |
| `libs/infrastructure/src/auth/session-auth-token.service.ts`     | Same                                                                       |
| `libs/infrastructure/src/auth/bcrypt-password-hasher.service.ts` | Same                                                                       |
| `libs/infrastructure/src/auth/redis-jwt-token-store.service.ts`  | Keep Redis dependency explicit                                             |
| `libs/infrastructure/src/auth/redis-session-store.service.ts`    | Keep Redis dependency explicit                                             |
| `apps/api/src/composition/auth-application.module.ts`            | `AuthModule.forRootAsync({ inject: [AppConfigService], useFactory: ... })` |

### Phase 5 — Mail / Storage

| File                                                       | Symbol / change                                            |
| ---------------------------------------------------------- | ---------------------------------------------------------- |
| `libs/infrastructure/src/mail/mail.module.ts`              | `forRootAsync`; register exactly one adapter provider      |
| `libs/infrastructure/src/mail/smtp-mail.adapter.ts`        | Constructor accepts `MailModuleOptions` / SMTP sub-options |
| `libs/infrastructure/src/mail/null-mail.adapter.ts`        | No `AppConfigService` dependency                           |
| `libs/infrastructure/src/storage/storage.module.ts`        | `forRootAsync`; register exactly one adapter               |
| `libs/infrastructure/src/storage/local-storage.adapter.ts` | Constructor accepts storage options                        |
| `libs/infrastructure/src/storage/s3-storage.adapter.ts`    | Constructor accepts S3 options                             |
| `apps/worker/src/worker.module.ts`                         | `MailModule.forRootAsync(...)`                             |

### Phase 6–8 — Globals, config, composition roots

| File                                                             | Symbol / change                                                    |
| ---------------------------------------------------------------- | ------------------------------------------------------------------ |
| `libs/infrastructure/src/repositories/repositories.module.ts`    | Remove `@Global()`                                                 |
| `libs/infrastructure/src/transactions/transactions.module.ts`    | Remove `@Global()`                                                 |
| `libs/infrastructure/src/config/infrastructure-config.module.ts` | Remain starter-kit convenience; optional composed schemas          |
| `libs/infrastructure/src/config/env.schema.ts`                   | Optional per-slice schemas or entrypoint subsets (human decision)  |
| `apps/api/src/api.module.ts`                                     | Explicit visible imports for Redis, Drizzle, BullMQ as needed      |
| `apps/api/src/composition/auth-application.module.ts`            | Explicit `DrizzleModule`, `RedisModule`, `AuthModule.forRootAsync` |
| `apps/worker/src/worker.module.ts`                               | Explicit connection module imports                                 |
| `apps/cron/src/cron.module.ts`                                   | Explicit connection module imports                                 |

### Phase 9 — Facade and docs

| File                                               | Symbol / change                                                                         |
| -------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `libs/infrastructure/src/infrastructure.module.ts` | Deprecated `forRoot()` facade mapping env → all modules, or removal with migration note |
| `EXAMPLES.md`                                      | Standalone integration snippets per module                                              |
| `MODULES_OVERVIEW_NON_TECH.md`                     | Portability / composition guidance                                                      |
| `README.md`                                        | Brief pointer to module integration examples                                            |

## Files to delete

None in initial phases. `InfrastructureModule` deletion deferred to Phase 9 pending human decision on compatibility facade.

## Contract and DI changes

| Area                                    | Change                                                                                                       | Breaking?                                                      |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| Module registration                     | Static `@Module({})` classes become dynamic `forRoot`/`forRootAsync`                                         | Yes for direct importers — migration via temporary static shim |
| Options tokens                          | New `*_MODULE_OPTIONS` tokens per module (internal to infrastructure)                                        | No public contract change                                      |
| `TOKENS.*` exports                      | Unchanged — consumers still inject `TOKENS.EmailGateway`, `TOKENS.AuthTokenService`, etc.                    | No                                                             |
| `REDIS_CLIENT`, `DRIZZLE_DB`, `PG_POOL` | Still exported; require explicit module import after `@Global()` removal                                     | Behavioral for tests / downstream                              |
| BullMQ                                  | `registerQueues([...])` replaces implicit all-queue registration                                             | Yes for custom queue sets                                      |
| `AppConfigService`                      | Remains at composition boundary as env→options mapper; modules must not require it internally after refactor | Soft deprecation of internal usage                             |

**Temporary compatibility shim (per module, one release cycle):**

```ts
// Example: static import delegates to forRootAsync with AppConfigService
static forRootFromAppConfig(): DynamicModule {
  return RedisModule.forRootAsync({
    imports: [InfrastructureConfigModule],
    inject: [AppConfigService],
    useFactory: (config: AppConfigService) => config.redis(),
  });
}
```

Mark shims `@deprecated` in JSDoc; remove after entrypoints migrate.

## Implementation steps

### Phase 1 — RedisModule

1. Add `RedisModuleOptions` and `ConfigurableModuleBuilder` setup mirroring `OutboxProcessorModule`.
2. Move client factory from static providers to options-driven factory (`REDIS_MODULE_OPTIONS` + `AppLogger`).
3. Add `forRoot` / `forRootAsync` with `global: false`.
4. Update all Redis consumers to import configured `RedisModule` explicitly.
5. Add `redis.module.spec.ts` proving bootstrap without `InfrastructureConfigModule`.
6. Keep deprecated static shim delegating to `forRootAsync` until Phase 8 completes.

### Phase 2 — DrizzleModule

1. Add `DrizzleModuleOptions` (at minimum `connectionString`; optional pool tuning).
2. Convert `DrizzleModule` to dynamic module; remove `@Global()`.
3. Update Drizzle consumers (repositories, transactions, outbox, audit, events, health).
4. Add isolated module spec.

### Phase 3 — BullMQ

1. Add `BullMqModuleOptions` for Redis connection + default job options.
2. Split `InfrastructureBullMqModule` into `forRootAsync` (connection) + `registerQueues(queueNames)`.
3. Refactor `BullQueueGateway` to support only registered queues.
4. Per entrypoint queue sets:
   - API: `[QUEUES.OUTBOX]`
   - Worker: `[QUEUES.OUTBOX, QUEUES.EMAIL]`
   - Cron: `[QUEUES.OUTBOX]`
5. Ensure `EventsModule` / `UserRegisteredEventHandler` path has `EMAIL` registered (Worker outbox chain).
6. Add module spec for selective queue registration.

### Phase 4 — AuthModule

1. Add `AuthModuleOptions` with `driver: 'jwt' | 'session'` and branch-specific sub-options.
2. Register only the selected branch:
   - `jwt` → `JwtModule.registerAsync`, `JwtAuthTokenService`, `RedisJwtTokenStore`
   - `session` → `SessionAuthTokenService`, `RedisSessionStore`
   - Always: `BcryptPasswordHasher` (or fold into options)
3. Export stable `TOKENS.*` regardless of driver.
4. Map options at `AuthApplicationCompositionModule` boundary.
5. Add specs: JWT driver module graph excludes `SessionAuthTokenService` provider and vice versa.

### Phase 5 — MailModule / StorageModule

1. Add options types with `driver` discriminator.
2. Register exactly one adapter via `useClass` / conditional dynamic provider — not two adapters + factory.
3. Refactor adapters to accept typed options instead of `AppConfigService`.
4. Wire `MailModule.forRootAsync` in `WorkerModule`.
5. Implement `StorageModule.forRootAsync` for portability (no current app consumer).
6. Add specs asserting module graph contains only selected adapter class.

### Phase 6 — Remove remaining `@Global()`

1. Remove `@Global()` from `RepositoriesModule`, `TransactionsModule`, and any surviving globals.
2. Add explicit imports to `AuthApplicationCompositionModule` and other roots.
3. Verify no provider resolution relies on global re-export.

### Phase 7 — Config composition evolution

1. Introduce optional per-module env slice schemas or mapper helpers.
2. Keep `InfrastructureConfigModule` as full-kit convenience for local dev.
3. Document pattern: composition root maps `AppConfigService` → `Module.forRootAsync` (same as Outbox today).

### Phase 8 — Entrypoint explicit composition

1. Refactor `api.module.ts` so infrastructure dependencies are visible in `imports`, not only via `HealthModule` hub.
2. Align Worker/Cron modules with explicit connection + queue imports.
3. Confirm entrypoint boundaries unchanged: API no `@Processor`; Worker no HTTP; Cron no `@Processor`.

### Phase 9 — Facade, docs, cleanup

1. Deprecate or remove `InfrastructureModule`.
2. Add standalone integration example per module to docs.
3. Remove deprecated static shims after all entrypoints migrate.

## Migration and rollout concerns

- **Incremental merge:** Each phase should pass `npm run build`, `npm run lint`, and targeted tests before the next phase.
- **Downstream starter-kit consumers:** Projects importing individual `@infrastructure/*` modules directly will need to switch from static imports to `forRootAsync`. Temporary shims reduce breakage.
- **Test suites:** Any test module that relied on `@Global()` must add explicit imports.
- **BullMQ gateway:** Restricting registered queues may surface latent assumptions in `BullQueueGateway.add` for unused queue names — acceptable; unused queues were never enqueued.
- **Coordination with P2-02:** If `registerQueues` API changes queue registration semantics, document overlap and avoid duplicating P2-02 registry work.

## Targeted verification

| Phase   | Command / check                                                                       | Conclusion criterion                             |
| ------- | ------------------------------------------------------------------------------------- | ------------------------------------------------ |
| 1       | `npm run build` after Redis changes                                                   | Compiles; no missing `REDIS_CLIENT`              |
| 1       | `npx jest libs/infrastructure/src/redis/redis.module.spec.ts`                         | Boots without `InfrastructureConfigModule`       |
| 2       | `npx jest libs/infrastructure/src/database/drizzle/drizzle.module.spec.ts`            | Isolated Drizzle module                          |
| 3       | `npm run build:api`, `build:worker`, `build:cron`                                     | Per-entrypoint queue sets compile                |
| 3       | `npx jest libs/infrastructure/src/bullmq/bullmq.module.spec.ts`                       | Only declared queues registered                  |
| 4       | `npx jest libs/infrastructure/src/auth/auth.module.spec.ts`                           | Single driver providers                          |
| 5       | `npx jest libs/infrastructure/src/mail/mail.module.spec.ts`, `storage.module.spec.ts` | Single adapter providers                         |
| 6–8     | `npm run build:api`, `build:worker`, `build:cron`                                     | Explicit imports resolve                         |
| Runtime | `npm run start:api`, `start:worker`, `start:cron` (if PostgreSQL + Redis available)   | Bootstrap without `UnknownDependenciesException` |

## Full verification

After all phases (or human-approved subset declared complete):

| Command                | Expected                                                                       |
| ---------------------- | ------------------------------------------------------------------------------ |
| `npm run build`        | Full monorepo compile success                                                  |
| `npm run lint`         | No new lint failures                                                           |
| `npm run test:unit`    | All unit tests pass, including new module specs                                |
| `npm run test:int`     | Integration tests pass (if infra available)                                    |
| `npm run start:api`    | API boots; no Worker consumers                                                 |
| `npm run start:worker` | Worker boots; `EmailProcessor` + `OutboxProcessor` registered; no HTTP         |
| `npm run start:cron`   | Cron boots; `OutboxSchedule` only; no `@Processor`                             |
| Manual / spec review   | Composition roots show explicit infrastructure imports in `apps/*/*.module.ts` |
| Docs review            | Standalone integration example exists per refactored module                    |

## Acceptance criteria

Mapped to backlog P1-04:

| Criterion                                                                                                      | Verification                                                                                             |
| -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Each reusable module has typed sync/async configuration                                                        | `forRoot`/`forRootAsync` on Redis, Drizzle, BullMQ, Auth, Mail, Storage; module specs                    |
| Module connectable in isolated Nest testing module without `InfrastructureConfigModule`                        | `*.module.spec.ts` files per connection/adapter module                                                   |
| Only selected Auth/Mail/Storage adapter is created                                                             | Auth/Mail/Storage module specs inspect provider metadata / driver branches                               |
| Composition roots explicitly import needed dependencies                                                        | Inspect `apps/api/src/api.module.ts`, `auth-application.module.ts`, `worker.module.ts`, `cron.module.ts` |
| API does not register Worker consumers; Cron does not run Worker consumers; Worker does not create HTTP server | Unchanged processors/guards; `npm run start:*` smoke or static review                                    |
| Docs contain standalone integration example per module                                                         | `docs/infrastructure-modules/` or `EXAMPLES.md` sections                                                 |

## Risks

| Risk                                       | Mitigation                                                                         |
| ------------------------------------------ | ---------------------------------------------------------------------------------- |
| Large cross-cutting diff                   | Enforce phased delivery; one phase per implementation PR                           |
| Missed consumer after `@Global()` removal  | Grep `REDIS_CLIENT`, `DRIZZLE_DB`, `TOKENS.*`; run all entrypoint builds           |
| `BullQueueGateway` refactor breaks enqueue | Keep gateway API stable; unit test registered queues                               |
| Adapter refactor breaks Worker email flow  | Targeted `email.processor` integration path; `MAIL_DRIVER=null` and `smtp` configs |
| Scope creep into P1-05 / P2-02             | Limit Auth changes to infrastructure module; defer registry redesign               |
| `HealthModule` as hidden composition hub   | Phase 8 makes API root explicit                                                    |

## Rollback strategy

- Each phase is independently revertible via git revert of that phase’s commit(s).
- Keep deprecated static shims until all entrypoints migrate so rollback can restore `@Global()` behavior temporarily.
- No database migrations or irreversible config changes.

## Open questions requiring human decision

1. **Phase approval granularity:** Approve this full roadmap, or approve and implement one phase at a time (recommended: Phase 1–3 first)?
2. **`InfrastructureModule`:** Delete outright, or keep deprecated `forRoot()` facade for one release?
3. **`StorageModule`:** Implement in Phase 5 despite no current app consumer, or defer until a feature needs it?
4. **Env schema split:** Keep full `envSchema` for the kit and map at composition roots only, or introduce per-entrypoint partial validation (e.g. Worker without JWT vars)?
5. **`@Global()` removal timing:** Remove in the same phase as `forRootAsync`, or ship dynamic modules first with `@Global()` briefly retained?
6. **P2-02 coordination:** Design `registerQueues` jointly with P2-02, or minimal selective registration now?
7. **`HealthModule` hub:** Should API `api.module.ts` own explicit Redis/Drizzle/BullMQ imports instead of relying on `HealthModule` transitive imports?
8. **Migrations entrypoint:** Keep standalone `process.env` script, or add optional `DrizzleModule.forRoot` Nest bootstrap?
9. **Docs location:** New `docs/infrastructure-modules/` tree vs extended `EXAMPLES.md`?
10. **Implementation stop line:** Does human acceptance require all nine phases, or a defined subset (e.g. Phases 1–6) before marking P1-04 resolved?
