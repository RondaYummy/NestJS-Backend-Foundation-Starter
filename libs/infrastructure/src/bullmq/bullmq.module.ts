import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { InfrastructureConfigModule } from '../config/infrastructure-config.module';
import { AppConfigService } from '../config/app-config.service';
import { TOKENS } from '@contracts/tokens';
import { QUEUES } from './queues';
import { BullQueueGateway } from './queue.gateway';

@Global()
@Module({
  imports: [
    InfrastructureConfigModule,
    BullModule.forRootAsync({
      imports: [InfrastructureConfigModule],
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => {
        const redisConfig = config.redis();

        return {
          connection: {
            host: redisConfig.host,
            port: redisConfig.port,
            password: redisConfig.password || undefined,
            db: redisConfig.db,

            connectTimeout: redisConfig.connectTimeoutMs,

            /*
             * Для BullMQ Worker має залишатися null.
             *
             * Після успішного startup Worker повинен переживати
             * тимчасову недоступність Redis, а не падати після
             * фіксованої кількості command retries.
             */
            maxRetriesPerRequest: null,

            retryStrategy: (attempt: number): number => {
              return Math.min(attempt * 250, 5000);
            },
          },
        };
      },
    }),
    BullModule.registerQueue(...Object.values(QUEUES).map((name) => ({ name }))),
  ],
  providers: [BullQueueGateway, { provide: TOKENS.QueueGateway, useExisting: BullQueueGateway }],
  exports: [BullQueueGateway, TOKENS.QueueGateway, BullModule],
})
export class InfrastructureBullMqModule {}
