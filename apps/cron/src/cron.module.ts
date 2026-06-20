import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { OutboxSchedule } from './schedules/outbox.schedule';
import { InfrastructureConfigModule } from '@infrastructure/config/infrastructure-config.module';
import { LoggerModule } from '@infrastructure/logger/logger.module';
import { LocksModule } from '@infrastructure/locks/locks.module';
import { InfrastructureBullMqModule } from '@infrastructure/bullmq/bullmq.module';
import { OutboxProcessorModule } from '@infrastructure/outbox/outbox-processor.module';
import { AppConfigService } from '@infrastructure/config/app-config.service';
import {
  mapAppConfigToBullMqOptions,
  mapAppConfigToDrizzleOptions,
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

const bullMqQueuesModule = InfrastructureBullMqModule.registerQueues([QUEUES.OUTBOX], {
  imports: [bullMqConnectionModule],
});

@Module({
  imports: [
    ScheduleModule.forRoot(),
    InfrastructureConfigModule,
    LoggerModule,
    redisModule,
    drizzleModule,
    bullMqConnectionModule,
    bullMqQueuesModule,
    LocksModule.register({ imports: [redisModule] }),
    OutboxProcessorModule.forRootAsync({
      imports: [InfrastructureConfigModule, drizzleModule, bullMqQueuesModule],
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => config.outbox(),
    }),
  ],
  providers: [OutboxSchedule],
})
export class CronModule {}
