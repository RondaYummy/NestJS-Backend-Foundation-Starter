# Infrastructure module integration

Reusable infrastructure modules are **source copy-kit modules** (path aliases), not publishable npm packages. See [ADR-001](../architecture/ADR-001-module-reuse-model.md) and the [EXTRACTION_GUIDE.md](./EXTRACTION_GUIDE.md) for peers, tokens, config touchpoints, and copy steps.

Map environment configuration at the **composition root** (API, Worker, or Cron module), not inside adapters. Shared starter-kit mappers live in `libs/infrastructure/src/config/create-starter-kit-module-options.ts`.

Modules do **not** all use the same registration API. Use the matrix below; do not assume every module has `forRoot` / `forRootAsync`.

## Registration matrix

| Module                         | Registration API                              | Notes                                                                |
| ------------------------------ | --------------------------------------------- | -------------------------------------------------------------------- |
| `LoggerModule`                 | `forRoot` / `forRootAsync`                    | Global; options `level`, `pretty`                                    |
| `RedisModule`                  | `forRoot` / `forRootAsync`                    | Needs `LoggerModule`                                                 |
| `DrizzleModule`                | `forRoot` / `forRootAsync`                    | Typed options or `forRootAsync` + mapper at composition root         |
| `InfrastructureBullMqModule`   | `forRoot` / `forRootAsync` + `registerQueues` | Separate connection module from `registerQueues`                     |
| `AuthModule`                   | `forRoot` / `forRootAsync`                    | Pass Redis (or custom stores) via `imports` / providers              |
| `GoogleSsoModule`              | `forRoot` / `forRootAsync`                    | Redis required when enabled                                          |
| `MailModule`                   | `forRoot` / `forRootAsync`                    | Typed options or `forRootAsync` + mapper at composition root         |
| `StorageModule`                | `forRoot` / `forRootAsync`                    | Typed options or `forRootAsync` + mapper at composition root         |
| `OutboxProcessorOptionsModule` | `forRoot` / `forRootAsync`                    | Cron schedule options                                                |
| `OutboxProcessorModule`        | `forRoot` / `forRootAsync`                    | Optional `{ eventHandlers }`; pulls Audit + Events                   |
| `OutboxWriterModule`           | `register` only                               | Needs `DrizzleModule`                                                |
| `HealthModule`                 | `register` / `registerAsync`                  | Needs Drizzle + Redis + OUTBOX queue                                 |
| `RateLimiterModule`            | `register` / `registerAsync`                  | Needs `RedisModule`; typed `defaults`                                |
| `CacheModule`                  | `register` only                               | Needs `RedisModule`                                                  |
| `LocksModule`                  | `register` only                               | Needs `RedisModule`                                                  |
| `IdempotencyModule`            | `register` only                               | Needs `RedisModule`                                                  |
| `EventsModule`                 | `register` only                               | `register({ imports?, handlers? })` — no baked-in handlers           |
| `AuditModule`                  | `register` only                               | Needs Drizzle + Logger                                               |
| `TransactionsModule`           | `register` only                               | Needs `DrizzleModule`                                                |
| `RepositoriesModule`           | `register` only                               | Needs `DrizzleModule`                                                |
| `ExceptionsModule`             | `register({ imports })`                       | Global exception filter; pass configured `LoggerModule` in `imports` |
| `InfrastructureConfigModule`   | Static `@Module`                              | Starter-kit env → `AppConfigService`                                 |

## LoggerModule

```typescript
import { LoggerModule } from '@infrastructure/logger/logger.module';

LoggerModule.forRoot({ level: 'info', pretty: false });
// or
LoggerModule.forRootAsync({
  useFactory: () => ({ level: 'info', pretty: false }),
});
```

## RedisModule

```typescript
import { RedisModule } from '@infrastructure/redis/redis.module';

RedisModule.forRootAsync({
  useFactory: () => ({
    host: '127.0.0.1',
    port: 6379,
    db: 0,
    connectTimeoutMs: 5000,
    keyPrefix: 'app',
  }),
});
```

Inject `REDIS_CLIENT`, `RedisService`, or `RedisKeyBuilder` after importing a configured module.

When multiple projects or environments share one Redis DB, set a distinct `keyPrefix` per deployment (for example `tenant-a`, `staging-api`). Feature adapters pass logical keys only; `RedisService` applies the namespace. Changing `keyPrefix` invalidates existing Redis keys — plan a flush or migration on rollout.

## DrizzleModule

```typescript
import { DrizzleModule } from '@infrastructure/database/drizzle/drizzle.module';

DrizzleModule.forRootAsync({
  useFactory: () => ({
    connectionString: process.env.DATABASE_URL!,
  }),
});
```

Inject `DRIZZLE_DB` or `PG_POOL` after import.

## InfrastructureBullMqModule

Split connection and queue registration:

```typescript
import { InfrastructureBullMqModule } from '@infrastructure/bullmq/bullmq.module';
import { QUEUES } from '@infrastructure/bullmq/queues';

InfrastructureBullMqModule.forRootAsync({
  useFactory: () => ({
    connection: { host: '127.0.0.1', port: 6379, db: 0, connectTimeoutMs: 5000 },
    defaultJobOptions: { attempts: 3, backoffDelay: 1000 },
  }),
}),
InfrastructureBullMqModule.registerQueues([QUEUES.OUTBOX]),
```

Every `QUEUES.*` constant must have a matching entry in `QueueJobRegistry` (`libs/contracts/src/queues/queue-gateway.ts`). Register a queue only in entrypoints that enqueue or consume it; do not register placeholder queues without typed job contracts.

Starter-kit queue sets:

| Entrypoint | Queues            |
| ---------- | ----------------- |
| API        | `OUTBOX`          |
| Worker     | `OUTBOX`, `EMAIL` |
| Cron       | `OUTBOX`          |

## AuthModule

```typescript
import { AuthModule } from '@infrastructure/auth/auth.module';
import { RedisModule } from '@infrastructure/redis/redis.module';

const redisModule = RedisModule.forRootAsync({
  useFactory: () => ({
    host: '127.0.0.1',
    port: 6379,
    db: 0,
    connectTimeoutMs: 5000,
    keyPrefix: 'app',
  }),
});

AuthModule.forRoot(
  {
    driver: 'jwt',
    passwordSaltRounds: 10,
    jwt: {
      secret: 'access-secret',
      expiresIn: '15m',
      refreshSecret: 'refresh-secret',
      refreshExpiresIn: '7d',
    },
  },
  { imports: [redisModule] },
);

AuthModule.forRootAsync({
  imports: [redisModule],
  useFactory: () => ({
    driver: 'jwt',
    passwordSaltRounds: 10,
    jwt: {
      secret: 'access-secret',
      expiresIn: '15m',
      refreshSecret: 'refresh-secret',
      refreshExpiresIn: '7d',
    },
  }),
});
```

Only the selected driver branch is instantiated. Pass `RedisModule` in `imports` for both `forRoot` and `forRootAsync` when using the default Redis-backed token stores. To override stores, supply `TOKENS.JwtTokenStore` or `TOKENS.SessionStore` via `registration.providers` on `forRoot`.

When `AuthModule.forRootAsync` `inject` includes `TOKENS.UserRepository` (for example, fresh-user resolution at the composition root), pass `RepositoriesModule.register(...)` in the `imports` array so the token is visible inside the nested Auth/JWT module graph.

## MailModule

```typescript
import { MailModule } from '@infrastructure/mail/mail.module';

MailModule.forRoot({ driver: 'null' });
// or
MailModule.forRootAsync({
  useFactory: () => ({
    driver: 'smtp',
    smtp: { host: 'localhost', port: 1025, user: 'u', password: 'p', from: 'noreply@example.com' },
  }),
});
```

Exactly one mail adapter is created per module registration.

## StorageModule

```typescript
import { StorageModule } from '@infrastructure/storage/storage.module';

StorageModule.forRoot({
  driver: 'local',
  localPath: './storage',
});
```

## RateLimiterModule / HealthModule / EventsModule (register APIs)

```typescript
RateLimiterModule.register({
  imports: [redisModule],
  defaults: { max: 100, ttl: 60, authMax: 10, authTtl: 60 },
});

HealthModule.register({
  imports: [drizzleModule, redisModule, outboxQueuesModule],
  checkTimeoutMs: 3000,
});

EventsModule.register({
  handlers: [/* Type<IDomainEventHandler> */],
  imports: [/* peers handlers need */],
});
```

Full peer lists and copy steps: [EXTRACTION_GUIDE.md](./EXTRACTION_GUIDE.md).

## Starter-kit convenience

```typescript
import { mapAppConfigToRedisOptions } from '@infrastructure/config/create-starter-kit-module-options';

RedisModule.forRootAsync({
  imports: [InfrastructureConfigModule],
  inject: [AppConfigService],
  useFactory: (config) => mapAppConfigToRedisOptions(config),
});
```

## Breaking removals

The following deprecated facades were **removed** (no stub):

- `*Module.forRootFromAppConfig` on Redis, Drizzle, BullMQ, Auth, Mail, and Storage
- `InfrastructureModule` / `InfrastructureModule.forRoot()`

Use explicit `forRoot` / `forRootAsync` / `register*` at the composition root with typed options or `mapAppConfigTo*` mappers. For HTTP exception handling:

```typescript
const loggerModule = LoggerModule.forRootAsync({/* ... */});

imports: [
  loggerModule,
  ExceptionsModule.register({ imports: [loggerModule] }),
  // ...
];
```

## Testing in isolation

Each connection/adapter module has a `*.module.spec.ts` that boots without `InfrastructureConfigModule`. Use the same pattern in feature tests:

```typescript
await Test.createTestingModule({
  imports: [
    RedisModule.forRoot({
      host: '127.0.0.1',
      port: 6379,
      db: 0,
      connectTimeoutMs: 1000,
      keyPrefix: 'app',
    }),
  ],
}).compile();
```
