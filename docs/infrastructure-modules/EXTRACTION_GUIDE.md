# Infrastructure module extraction guide (copy-kit)

**Reuse model:** documented copy-kit — **not** publishable npm packages.  
Decision record: [ADR-001](../architecture/ADR-001-module-reuse-model.md).  
Registration matrix: [README.md](./README.md).

Libs in this repository are **path-alias source modules** (`@infrastructure/*`, `@contracts/*`, …). Official distribution is a source archive (`npm run release:archive` / `scripts/release/*`). To reuse a module in another Nest project, **copy the listed source folders**, wire peers, and register via the documented API — without editing that module’s internal source.

## Security

- Do **not** copy `.env`, real credentials, or production secrets.
- Copy option types, env **schema patterns**, and composition-root mappers only.
- Treat `keyPrefix`, JWT secrets, SMTP, and S3 credentials as deployment-specific.

## Neutral layers (always consider)

| Layer     | Path                                                                            | When to copy                                                                   |
| --------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Contracts | `libs/contracts/src/` (especially `tokens.ts` + the port folder for the module) | Whenever an infra module provides a `TOKENS.*` port or imports a contract type |
| Domain    | `libs/domain/src/` (entities, events, errors the module imports)                | Auth/repos/outbox/events/exceptions paths that import domain types             |
| Shared    | `libs/shared/src/`                                                              | Only utilities the module imports (e.g. Idempotency → `hash-object`)           |

Preserve dependency direction: `domain` ← `application` ← … ; `infrastructure` → `contracts`.

## Foundation order

Suggested composition order when extracting several modules:

1. Contracts / domain / shared slices needed by the target module
2. `LoggerModule`
3. `RedisModule` and/or `DrizzleModule` and/or `InfrastructureBullMqModule`
4. Redis-backed or Drizzle-backed feature adapters
5. Auth / Mail / Storage / Outbox / Events / Audit
6. `HealthModule` last (depends on DB + Redis + OUTBOX queue)

## Module families

| Family                  | Modules                                                                            | Shared peer                                                                 |
| ----------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Redis-backed adapters   | Cache, Locks, Idempotency, RateLimiter, Auth (default stores), GoogleSso (enabled) | `RedisModule`                                                               |
| Drizzle-backed adapters | Transactions, Repositories, OutboxWriter, Audit, OutboxProcessor                   | `DrizzleModule` (+ relevant schema files)                                   |
| Outbox stack            | OutboxWriter, OutboxProcessorOptions, OutboxProcessor, Events, Audit               | Drizzle + Logger; Worker also needs queue imports for handlers that enqueue |

## Registration styles (summary)

| Style                        | Modules                                                                                                 |
| ---------------------------- | ------------------------------------------------------------------------------------------------------- |
| `forRoot` / `forRootAsync`   | Logger, Redis, Drizzle, BullMQ, Auth, GoogleSso, Mail, Storage, OutboxProcessorOptions, OutboxProcessor |
| `register` / `registerAsync` | Health, RateLimiter, Exceptions (`register` only — required `imports` peer)                             |
| `register` only              | Cache, Locks, Idempotency, Events, Audit, Transactions, Repositories, OutboxWriter                      |
| Static `@Module`             | InfrastructureConfig                                                                                    |

Map starter-kit env via typed options or `*Async` + `mapAppConfigTo*` at the composition root. Deprecated `forRootFromAppConfig` and `InfrastructureModule.forRoot` were removed.

---

## Per-module notes

### LoggerModule

| Field                           | Detail                                                                                    |
| ------------------------------- | ----------------------------------------------------------------------------------------- |
| **API**                         | `forRoot(options)` / `forRootAsync(asyncOptions)` — global                                |
| **Peers**                       | None                                                                                      |
| **Tokens / exports**            | `LOGGER_MODULE_OPTIONS`; `AppLogger`, `RequestContextService`, `RequestContextMiddleware` |
| **Config**                      | `LoggerModuleOptions` (`level`, `pretty`); optional `mapAppConfigToLoggerOptions`         |
| **Copy**                        | `libs/infrastructure/src/logger/`                                                         |
| **Contracts / domain / shared** | None required for the module itself                                                       |
| **Do not**                      | Rely on `AppConfigService` inside the module — map at composition root                    |

```typescript
LoggerModule.forRoot({ level: 'info', pretty: false });
```

### RedisModule

| Field                | Detail                                                            |
| -------------------- | ----------------------------------------------------------------- |
| **API**              | `forRoot` / `forRootAsync`                                        |
| **Peers**            | `LoggerModule` (`AppLogger`)                                      |
| **Tokens / exports** | `REDIS_CLIENT`, `RedisService`, `RedisKeyBuilder`, options tokens |
| **Config**           | `RedisModuleOptions`; `mapAppConfigToRedisOptions`                |
| **Copy**             | `libs/infrastructure/src/redis/`                                  |
| **Do not**           | Copy secrets; set `keyPrefix` per deployment                      |

### DrizzleModule

| Field                | Detail                                                                             |
| -------------------- | ---------------------------------------------------------------------------------- |
| **API**              | `forRoot` / `forRootAsync`                                                         |
| **Peers**            | None for the connection module; copy schema + migrations when shipping persistence |
| **Tokens / exports** | `DRIZZLE_DB`, `PG_POOL`                                                            |
| **Config**           | `DrizzleModuleOptions`; `mapAppConfigToDrizzleOptions`                             |
| **Copy**             | `libs/infrastructure/src/database/drizzle/` (include `schema/` as needed)          |

### InfrastructureBullMqModule

| Field                | Detail                                                                                                                    |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **API**              | `forRoot` / `forRootAsync` + `registerQueues(names, { imports? })`                                                        |
| **Peers**            | Own Redis connection options (does not require `RedisModule`); `registerQueues` must import the connection dynamic module |
| **Tokens / exports** | `TOKENS.QueueGateway`, `BullQueueGateway`, `BULLMQ_*`                                                                     |
| **Config**           | `BullMqModuleOptions`; `mapAppConfigToBullMqOptions`                                                                      |
| **Copy**             | `libs/infrastructure/src/bullmq/` + `libs/contracts/src/queues/` + `TOKENS.QueueGateway`                                  |
| **Note**             | Every queue name needs a matching `QueueJobRegistry` entry                                                                |

### AuthModule

| Field                  | Detail                                                                                                            |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------- |
| **API**                | `forRoot(options, registration?)` / `forRootAsync`                                                                |
| **Peers**              | Default Redis JWT/session stores need `RedisModule` in `imports` (or override store providers)                    |
| **Tokens / exports**   | `TOKENS.PasswordHasher`, `TOKENS.AuthTokenService`; JWT → `TOKENS.JwtTokenStore`; session → `TOKENS.SessionStore` |
| **Config**             | `AuthModuleOptions`; `mapAppConfigToAuthOptions`                                                                  |
| **Copy**               | `libs/infrastructure/src/auth/` (exclude Google SSO files if splitting)                                           |
| **Contracts / domain** | `@contracts/auth/*`, `@contracts/tokens`; domain errors used by token services                                    |

### GoogleSsoModule

| Field                | Detail                                                                                                                                             |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| **API**              | `forRoot(options, imports?)` / `forRootAsync`                                                                                                      |
| **Peers**            | Enabled mode needs `RedisModule` for state store                                                                                                   |
| **Tokens / exports** | `TOKENS.GoogleIdentityService`, `TOKENS.GoogleOAuthStateStore`                                                                                     |
| **Config**           | `GoogleSsoModuleOptions`; `mapAppConfigToGoogleSsoOptions`                                                                                         |
| **Copy**             | `google-sso.module.ts`, `google-sso.module-options.ts`, `google-oauth-identity.service.ts`, `redis-google-oauth-state.store.ts` + Google contracts |

### MailModule

| Field                | Detail                                                              |
| -------------------- | ------------------------------------------------------------------- |
| **API**              | `forRoot` / `forRootAsync`                                          |
| **Peers**            | `LoggerModule` for async/null adapter paths                         |
| **Tokens / exports** | `TOKENS.EmailGateway`, `MailTemplateService`                        |
| **Config**           | `MailModuleOptions` (`null` \| `smtp`); `mapAppConfigToMailOptions` |
| **Copy**             | `libs/infrastructure/src/mail/` (includes React Email templates)    |

### StorageModule

| Field                | Detail                                                                   |
| -------------------- | ------------------------------------------------------------------------ |
| **API**              | `forRoot` / `forRootAsync`                                               |
| **Peers**            | None                                                                     |
| **Tokens / exports** | `TOKENS.StorageGateway`                                                  |
| **Config**           | `StorageModuleOptions` (`local` \| `s3`); `mapAppConfigToStorageOptions` |
| **Copy**             | `libs/infrastructure/src/storage/`                                       |

### OutboxProcessorOptionsModule

| Field                | Detail                                                                                   |
| -------------------- | ---------------------------------------------------------------------------------------- |
| **API**              | `forRoot` / `forRootAsync`                                                               |
| **Peers**            | None alone (Cron uses this for schedule options)                                         |
| **Tokens / exports** | `TOKENS.OutboxProcessorOptions`                                                          |
| **Config**           | `OutboxProcessorOptions` from `@contracts`; Cron/API map via `AppConfigService.outbox()` |
| **Copy**             | `outbox-processor-options.module.ts`, defaults, related options schema as needed         |

### OutboxProcessorModule

| Field                | Detail                                                                                                                                                                                     |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **API**              | `forRoot(options?, features?)` / `forRootAsync(options, features?)` with optional `{ eventHandlers?: Type<IDomainEventHandler>[] }`                                                        |
| **Peers**            | `LoggerModule`, `DrizzleModule`; auto-imports Audit + Events. Prefer `forRootAsync` with drizzle/queue imports (Worker pattern). Handlers that enqueue need BullMQ queues in those imports |
| **Tokens / exports** | `TOKENS.OutboxProcessor`                                                                                                                                                                   |
| **Copy**             | `libs/infrastructure/src/outbox/` + outbox schema + Audit/Events peers                                                                                                                     |

### OutboxWriterModule

| Field                  | Detail                                                        |
| ---------------------- | ------------------------------------------------------------- |
| **API**                | `register({ imports? })` only                                 |
| **Peers**              | `DrizzleModule` (`DRIZZLE_DB`)                                |
| **Tokens / exports**   | `TOKENS.OutboxWriter`                                         |
| **Copy**               | writer + `outbox-events` schema + transaction executor helper |
| **Contracts / domain** | outbox writer port, domain events, tokens                     |

### HealthModule

| Field                | Detail                                                                            |
| -------------------- | --------------------------------------------------------------------------------- |
| **API**              | `register` / `registerAsync` (not `forRoot`)                                      |
| **Peers**            | `DrizzleModule`, `RedisModule`, BullMQ `registerQueues` including `QUEUES.OUTBOX` |
| **Tokens / exports** | `HealthService`, `HealthController`, `HEALTH_MODULE_OPTIONS`                      |
| **Config**           | `HealthModuleOptions` (`checkTimeoutMs`); `mapAppConfigToHealthOptions`           |
| **Copy**             | `libs/infrastructure/src/health/`                                                 |

### RateLimiterModule

| Field                | Detail                                                                                                                                   |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **API**              | `register` / `registerAsync`                                                                                                             |
| **Peers**            | `RedisModule`                                                                                                                            |
| **Tokens / exports** | `TOKENS.RateLimiter`, `RateLimiterGuard`, `RATE_LIMITER_MODULE_OPTIONS`                                                                  |
| **Config**           | `RateLimiterModuleOptions` (`max`, `ttl`, `authMax`, `authTtl`); sync takes `{ imports?, defaults }`; `mapAppConfigToRateLimiterOptions` |
| **Copy**             | `libs/infrastructure/src/rate-limiter/`                                                                                                  |

### CacheModule

| Field                | Detail                                            |
| -------------------- | ------------------------------------------------- |
| **API**              | `register({ imports? })` only                     |
| **Peers**            | `RedisModule`                                     |
| **Tokens / exports** | `TOKENS.CacheGateway`                             |
| **Copy**             | `libs/infrastructure/src/cache/` + cache contract |

### LocksModule

| Field                | Detail                                            |
| -------------------- | ------------------------------------------------- |
| **API**              | `register({ imports? })` only                     |
| **Peers**            | `RedisModule`                                     |
| **Tokens / exports** | `TOKENS.DistributedLock`                          |
| **Copy**             | `libs/infrastructure/src/locks/` + locks contract |

### IdempotencyModule

| Field                | Detail                                                                                       |
| -------------------- | -------------------------------------------------------------------------------------------- |
| **API**              | `register({ imports? })` only                                                                |
| **Peers**            | `RedisModule`                                                                                |
| **Tokens / exports** | `TOKENS.IdempotencyService`, `TOKENS.JobExecutionStore`, `IdempotencyInterceptor`            |
| **Copy**             | `libs/infrastructure/src/idempotency/` + idempotency contracts + `@shared/utils/hash-object` |

### EventsModule

| Field                | Detail                                                                                          |
| -------------------- | ----------------------------------------------------------------------------------------------- |
| **API**              | `register({ imports?, handlers? })` only — no baked-in handlers                                 |
| **Peers**            | Whatever handlers inject (e.g. sample needs `TOKENS.QueueGateway` → BullMQ queues in `imports`) |
| **Tokens / exports** | `TOKENS.DomainEventRouter`; provides `TOKENS.DomainEventHandlers`                               |
| **Config**           | `handlers?: Type<IDomainEventHandler>[]` (default `[]`); `imports?`                             |
| **Copy**             | `libs/infrastructure/src/events/` core; `events/examples/*` is **sample only**                  |
| **Do not**           | Assume `UserRegisteredEventHandler` is registered unless you pass it in `handlers`              |

```typescript
EventsModule.register({
  handlers: [MyHandler],
  imports: [queuesModule],
});
```

### AuditModule

| Field                | Detail                                                                            |
| -------------------- | --------------------------------------------------------------------------------- |
| **API**              | `register({ imports? })` only                                                     |
| **Peers**            | `DrizzleModule`, `LoggerModule`                                                   |
| **Tokens / exports** | `TOKENS.AuditLogger`                                                              |
| **Copy**             | `libs/infrastructure/src/audit/` + `database/drizzle/schema/audit-logs.schema.ts` |

### TransactionsModule

| Field                | Detail                                  |
| -------------------- | --------------------------------------- |
| **API**              | `register({ imports? })` only           |
| **Peers**            | `DrizzleModule`                         |
| **Tokens / exports** | `TOKENS.TransactionManager`             |
| **Copy**             | `libs/infrastructure/src/transactions/` |

### RepositoriesModule

| Field                | Detail                                                                                                         |
| -------------------- | -------------------------------------------------------------------------------------------------------------- |
| **API**              | `register({ imports? })` only                                                                                  |
| **Peers**            | `DrizzleModule`                                                                                                |
| **Tokens / exports** | `TOKENS.UserRepository`                                                                                        |
| **Copy**             | `libs/infrastructure/src/repositories/` + `mappers/` + users schema + user domain entity / repository contract |

### ExceptionsModule

| Field     | Detail                                                                                                                                |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| **API**   | `register({ imports })` — required `imports` must include configured `LoggerModule.forRoot` / `forRootAsync` (registers `APP_FILTER`) |
| **Peers** | Configured `LoggerModule` (exports `AppLogger`) — do not rely on ambient global registration alone                                    |
| **Copy**  | `libs/infrastructure/src/exceptions/` + `@domain/errors/domain-errors`                                                                |

```typescript
const loggerModule = LoggerModule.forRoot({ level: 'error', pretty: false });

imports: [loggerModule, ExceptionsModule.register({ imports: [loggerModule] })];
```

### InfrastructureConfigModule

| Field     | Detail                                                                                                                                                                        |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **API**   | Static `@Module` (`ConfigModule.forRoot` + env validation → `AppConfigService`)                                                                                               |
| **Peers** | None                                                                                                                                                                          |
| **Copy**  | `libs/infrastructure/src/config/` when keeping starter-kit env mapping                                                                                                        |
| **Note**  | Optional for portable modules — prefer typed `forRoot` / `register` options; use `create-starter-kit-module-options.ts` only at composition roots that keep this config style |

### Removed facades (do not copy)

`InfrastructureModule` and `*Module.forRootFromAppConfig` were deleted. Extract individual modules with explicit composition-root registration instead.

---

## Scratch-project dry-run checklist (LoggerModule)

Use this to verify AC-07 without editing module internals.

1. Create a scratch Nest (or empty TS) project **outside** this repo (do not commit it here).
2. Copy:
   - `libs/infrastructure/src/logger/` → e.g. `src/infrastructure/logger/`
3. Ensure Nest common/core and the logger’s runtime deps (e.g. pino stack used by `AppLogger`) resolve the same way as in this repo’s `package.json` — or keep compiling against this repo’s `node_modules` via path aliases for a dry-run.
4. Register without changing files under the copied `logger/` folder:

```typescript
imports: [LoggerModule.forRoot({ level: 'info', pretty: true })],
```

5. Inject `AppLogger` in a tiny provider or controller and compile.
6. **Pass criteria:** module registers via documented API; no edits inside the copied logger sources.

Optional Redis dry-run: copy `logger/` + `redis/`, register `LoggerModule.forRoot(...)` then `RedisModule.forRoot({ host, port, db, connectTimeoutMs, keyPrefix })`, inject `RedisService`.

## Archive distribution

To reuse the whole kit:

```bash
npm run release:archive
npm run release:verify   # when validating an archive
```

See `scripts/release/build-archive.ts`. Archive release remains the official ship mechanism under ADR-001.
