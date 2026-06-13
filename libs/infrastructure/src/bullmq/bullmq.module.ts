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
      useFactory: (config: AppConfigService) => ({
        connection: {
          host: config.redis().host,
          port: config.redis().port,
          password: config.redis().password || undefined,
          db: config.redis().db,
        },
      }),
    }),
    BullModule.registerQueue(...Object.values(QUEUES).map((name) => ({ name }))),
  ],
  providers: [BullQueueGateway, { provide: TOKENS.QueueGateway, useExisting: BullQueueGateway }],
  exports: [BullQueueGateway, TOKENS.QueueGateway, BullModule],
})
export class InfrastructureBullMqModule {}
