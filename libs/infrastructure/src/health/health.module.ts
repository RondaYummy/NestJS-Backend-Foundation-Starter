import {
  DynamicModule,
  Module,
  type FactoryProvider,
  type ModuleMetadata,
  type Provider,
} from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import type Redis from 'ioredis';

import { QUEUES } from '@contracts/queues/queue-names';

import { DRIZZLE_DB } from '../database/drizzle/drizzle.tokens';
import { REDIS_CLIENT } from '../redis/redis.tokens';
import { HealthController } from './health.controller';
import { HEALTH_MODULE_OPTIONS, type HealthModuleOptions } from './health.module-options';
import { HealthService } from './health.service';

type HealthModuleRegisterOptions = {
  imports?: ModuleMetadata['imports'];
  checkTimeoutMs: number;
};

type HealthModuleRegisterAsyncOptions = Pick<
  FactoryProvider<HealthModuleOptions>,
  'inject' | 'useFactory'
> & {
  imports?: ModuleMetadata['imports'];
};

@Module({})
export class HealthModule {
  static register(options: HealthModuleRegisterOptions): DynamicModule {
    return HealthModule.buildDynamicModule(options.imports ?? [], {
      provide: HEALTH_MODULE_OPTIONS,
      useValue: { checkTimeoutMs: options.checkTimeoutMs },
    });
  }

  static registerAsync(options: HealthModuleRegisterAsyncOptions): DynamicModule {
    return HealthModule.buildDynamicModule(options.imports ?? [], {
      provide: HEALTH_MODULE_OPTIONS,
      inject: options.inject ?? [],
      useFactory: options.useFactory,
    });
  }

  private static buildDynamicModule(
    imports: ModuleMetadata['imports'],
    optionsProvider: Provider,
  ): DynamicModule {
    return {
      module: HealthModule,
      imports,
      controllers: [HealthController],
      providers: [
        optionsProvider,
        {
          provide: HealthService,
          useFactory: (
            db: { execute: (query: unknown) => Promise<unknown> },
            redis: Redis,
            queue: Queue,
            healthOptions: HealthModuleOptions,
          ) => new HealthService(db, redis, queue, healthOptions),
          inject: [DRIZZLE_DB, REDIS_CLIENT, getQueueToken(QUEUES.OUTBOX), HEALTH_MODULE_OPTIONS],
        },
      ],
      exports: [HealthService],
    };
  }
}
