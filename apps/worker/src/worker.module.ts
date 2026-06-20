import { Module } from '@nestjs/common';
import { EmailProcessor } from './processors/email.processor';
import { OutboxProcessor } from './processors/outbox.processor';
import { LoggerModule } from '@infrastructure/logger/logger.module';
import { MailModule } from '@infrastructure/mail/mail.module';
import { OutboxProcessorModule } from '@infrastructure/outbox/outbox-processor.module';
import { IdempotencyModule } from '@infrastructure/idempotency/idempotency.module';
import { InfrastructureBullMqModule } from '@infrastructure/bullmq/bullmq.module';
import { InfrastructureConfigModule } from '@infrastructure/config/infrastructure-config.module';
import { AppConfigService } from '@infrastructure/config/app-config.service';
import {
  mapAppConfigToBullMqOptions,
  mapAppConfigToDrizzleOptions,
  mapAppConfigToMailOptions,
  mapAppConfigToRedisOptions,
} from '@infrastructure/config/create-starter-kit-module-options';
import { DrizzleModule } from '@infrastructure/database/drizzle/drizzle.module';
import { RedisModule } from '@infrastructure/redis/redis.module';
import { QUEUES } from '@infrastructure/bullmq/queues';

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

const bullMqQueuesModule = InfrastructureBullMqModule.registerQueues(
  [QUEUES.OUTBOX, QUEUES.EMAIL],
  { imports: [bullMqConnectionModule] },
);

@Module({
  imports: [
    LoggerModule,
    InfrastructureConfigModule,
    redisModule,
    drizzleModule,
    bullMqConnectionModule,
    bullMqQueuesModule,
    MailModule.forRootAsync({
      imports: [InfrastructureConfigModule],
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => mapAppConfigToMailOptions(config),
    }),
    IdempotencyModule.register({ imports: [redisModule] }),
    OutboxProcessorModule.forRootAsync({
      imports: [InfrastructureConfigModule, drizzleModule, bullMqQueuesModule],
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => config.outbox(),
    }),
  ],
  providers: [EmailProcessor, OutboxProcessor],
})
export class WorkerModule {}
