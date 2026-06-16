import { Module } from '@nestjs/common';
import { AuditModule } from './audit/audit.module';
import { InfrastructureBullMqModule } from './bullmq/bullmq.module';
import { CacheModule } from './cache/cache.module';
import { InfrastructureConfigModule } from './config/infrastructure-config.module';
import { DrizzleModule } from './database/drizzle/drizzle.module';
import { ExceptionsModule } from './exceptions/exceptions.module';
import { IdempotencyModule } from './idempotency/idempotency.module';
import { LocksModule } from './locks/locks.module';
import { LoggerModule } from './logger/logger.module';
import { MailModule } from './mail/mail.module';
import { OutboxProcessorModule } from './outbox/outbox-processor.module';
import { RateLimiterModule } from './rate-limiter/rate-limiter.module';
import { RedisModule } from './redis/redis.module';
import { RepositoriesModule } from './repositories/repositories.module';
import { StorageModule } from './storage/storage.module';
import { TransactionsModule } from './transactions/transactions.module';
import { AuthModule } from './auth/auth.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    InfrastructureConfigModule,
    LoggerModule,
    DrizzleModule,
    RedisModule,
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
  exports: [
    InfrastructureConfigModule,
    LoggerModule,
    DrizzleModule,
    RedisModule,
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
})
export class InfrastructureModule {}
