# Infrastructure module integration

Each reusable infrastructure module exposes typed `forRoot` / `forRootAsync` registration. Map environment configuration at the **composition root** (API, Worker, or Cron module), not inside adapters.

Shared mappers for the starter kit live in `libs/infrastructure/src/config/create-starter-kit-module-options.ts`.

## RedisModule

```typescript
import { RedisModule } from '@infrastructure/redis/redis.module';

RedisModule.forRootAsync({
  useFactory: () => ({
    host: '127.0.0.1',
    port: 6379,
    db: 0,
    connectTimeoutMs: 5000,
  }),
});
```

Inject `REDIS_CLIENT` or `RedisService` after importing a configured module.

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

## Starter-kit convenience

```typescript
import { mapAppConfigToRedisOptions } from '@infrastructure/config/create-starter-kit-module-options';

RedisModule.forRootAsync({
  imports: [InfrastructureConfigModule],
  inject: [AppConfigService],
  useFactory: (config) => mapAppConfigToRedisOptions(config),
});
```

## Deprecated facade

`InfrastructureModule.forRoot()` aggregates the full stack for backward compatibility. Prefer explicit per-module imports in new projects.

## Testing in isolation

Each connection/adapter module has a `*.module.spec.ts` that boots without `InfrastructureConfigModule`. Use the same pattern in feature tests:

```typescript
await Test.createTestingModule({
  imports: [RedisModule.forRoot({ host: '127.0.0.1', port: 6379, db: 0, connectTimeoutMs: 1000 })],
}).compile();
```
