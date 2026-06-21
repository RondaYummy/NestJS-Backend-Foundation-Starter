import { DynamicModule, Module } from '@nestjs/common';

import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { InfrastructureBullMqModule } from './bullmq/bullmq.module';
import { CacheModule } from './cache/cache.module';
import { InfrastructureConfigModule } from './config/infrastructure-config.module';
import { AppConfigService } from './config/app-config.service';
import {
  mapAppConfigToAuthOptions,
  mapAppConfigToBullMqOptions,
  mapAppConfigToDrizzleOptions,
  mapAppConfigToHealthOptions,
  mapAppConfigToMailOptions,
  mapAppConfigToRedisOptions,
  mapAppConfigToStorageOptions,
} from './config/create-starter-kit-module-options';
import { DrizzleModule } from './database/drizzle/drizzle.module';
import { ExceptionsModule } from './exceptions/exceptions.module';
import { HealthModule } from './health/health.module';
import { IdempotencyModule } from './idempotency/idempotency.module';
import { LocksModule } from './locks/locks.module';
import { LoggerModule } from './logger/logger.module';
import { MailModule } from './mail/mail.module';
import { OutboxProcessorModule } from './outbox/outbox-processor.module';
import { QUEUES } from './bullmq/queues';
import { RateLimiterModule } from './rate-limiter/rate-limiter.module';
import { RedisModule } from './redis/redis.module';
import { RepositoriesModule } from './repositories/repositories.module';
import { StorageModule } from './storage/storage.module';
import { TransactionsModule } from './transactions/transactions.module';

/**
 * @deprecated Import individual infrastructure modules with `forRoot` / `forRootAsync`
 * at your composition root instead. This facade remains for backward compatibility.
 */
@Module({})
export class InfrastructureModule {
  static forRoot(): DynamicModule {
    const redisModule = RedisModule.forRootAsync({
      imports: [InfrastructureConfigModule],
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => mapAppConfigToRedisOptions(config),
    });

    const drizzleModule = DrizzleModule.forRootAsync({
      imports: [InfrastructureConfigModule],
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => mapAppConfigToDrizzleOptions(config),
    });

    const bullMqConnectionModule = InfrastructureBullMqModule.forRootAsync({
      imports: [InfrastructureConfigModule],
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => mapAppConfigToBullMqOptions(config),
    });

    // Facade registers only registry-backed queues (see QueueJobRegistry in contracts).
    const bullMqQueuesModule = InfrastructureBullMqModule.registerQueues(
      [QUEUES.OUTBOX, QUEUES.EMAIL],
      {
        imports: [bullMqConnectionModule],
      },
    );

    return {
      module: InfrastructureModule,
      imports: [
        InfrastructureConfigModule,
        LoggerModule,
        redisModule,
        drizzleModule,
        bullMqConnectionModule,
        bullMqQueuesModule,
        CacheModule.register({ imports: [redisModule] }),
        ExceptionsModule,
        MailModule.forRootAsync({
          imports: [InfrastructureConfigModule],
          inject: [AppConfigService],
          useFactory: (config: AppConfigService) => mapAppConfigToMailOptions(config),
        }),
        StorageModule.forRootAsync({
          imports: [InfrastructureConfigModule],
          inject: [AppConfigService],
          useFactory: (config: AppConfigService) => mapAppConfigToStorageOptions(config),
        }),
        TransactionsModule.register({ imports: [drizzleModule] }),
        OutboxProcessorModule.forRootAsync({
          imports: [InfrastructureConfigModule, drizzleModule, bullMqQueuesModule],
          inject: [AppConfigService],
          useFactory: (config: AppConfigService) => config.outbox(),
        }),
        RateLimiterModule.register({ imports: [redisModule, InfrastructureConfigModule] }),
        LocksModule.register({ imports: [redisModule] }),
        IdempotencyModule.register({ imports: [redisModule] }),
        RepositoriesModule.register({ imports: [drizzleModule] }),
        AuthModule.forRootAsync({
          imports: [InfrastructureConfigModule, redisModule],
          inject: [AppConfigService],
          useFactory: (config: AppConfigService) => mapAppConfigToAuthOptions(config),
        }),
        HealthModule.registerAsync({
          imports: [InfrastructureConfigModule, redisModule, drizzleModule, bullMqQueuesModule],
          inject: [AppConfigService],
          useFactory: (config: AppConfigService) => mapAppConfigToHealthOptions(config),
        }),
      ],
      exports: [
        InfrastructureConfigModule,
        LoggerModule,
        RedisModule,
        DrizzleModule,
        InfrastructureBullMqModule,
        CacheModule,
        ExceptionsModule,
        MailModule,
        StorageModule,
        TransactionsModule,
        OutboxProcessorModule,
        AuditModule,
        RateLimiterModule,
        LocksModule,
        IdempotencyModule,
        RepositoriesModule,
        AuthModule,
        HealthModule,
      ],
    };
  }
}
