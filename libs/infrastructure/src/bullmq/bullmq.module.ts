import { BullModule } from '@nestjs/bullmq';
import {
  ConfigurableModuleBuilder,
  DynamicModule,
  Module,
  Provider,
  type ModuleMetadata,
} from '@nestjs/common';
import { TOKENS } from '@contracts/tokens';

import { InfrastructureConfigModule } from '../config/infrastructure-config.module';
import { AppConfigService } from '../config/app-config.service';
import {
  BULLMQ_MODULE_OPTIONS,
  BULLMQ_REGISTERED_QUEUES,
  type BullMqModuleOptions,
} from './bullmq.module-options';
import { BullQueueGateway } from './queue.gateway';

export const { ConfigurableModuleClass, MODULE_OPTIONS_TOKEN, OPTIONS_TYPE, ASYNC_OPTIONS_TYPE } =
  new ConfigurableModuleBuilder<BullMqModuleOptions>({
    optionsInjectionToken: BULLMQ_MODULE_OPTIONS,
  })
    .setClassMethodName('forRoot')
    .setFactoryMethodName('forRootAsync')
    .build();

function buildBullConnection(options: BullMqModuleOptions) {
  return {
    host: options.connection.host,
    port: options.connection.port,
    password: options.connection.password || undefined,
    db: options.connection.db,
    connectTimeout: options.connection.connectTimeoutMs,
    maxRetriesPerRequest: null,
    retryStrategy: (attempt: number): number => Math.min(attempt * 250, 5000),
  };
}

@Module({})
class InfrastructureBullMqQueuesModule {}

@Module({})
export class InfrastructureBullMqModule extends ConfigurableModuleClass {
  static forRoot(options: typeof OPTIONS_TYPE): DynamicModule {
    const rootModule = super.forRoot(options);

    return {
      ...rootModule,
      global: false,
      exports: [...(rootModule.exports ?? []), BULLMQ_MODULE_OPTIONS],
      imports: [
        ...(rootModule.imports ?? []),
        BullModule.forRoot({
          connection: buildBullConnection(options),
        }),
      ],
    };
  }

  static forRootAsync(options: typeof ASYNC_OPTIONS_TYPE): DynamicModule {
    const rootModule = super.forRootAsync(options);

    return {
      ...rootModule,
      global: false,
      exports: [...(rootModule.exports ?? []), BULLMQ_MODULE_OPTIONS],
      imports: [
        ...(rootModule.imports ?? []),
        BullModule.forRootAsync({
          imports: options.imports,
          inject: options.inject,
          useFactory: async (...args: unknown[]) => {
            const moduleOptions = await (
              options.useFactory as (
                ...factoryArgs: unknown[]
              ) => BullMqModuleOptions | Promise<BullMqModuleOptions>
            )(...args);

            return {
              connection: buildBullConnection(moduleOptions),
            };
          },
        }),
      ],
    };
  }

  static registerQueues(
    queueNames: readonly string[],
    options: { imports?: ModuleMetadata['imports'] } = {},
  ): DynamicModule {
    const providers: Provider[] = [
      {
        provide: BULLMQ_REGISTERED_QUEUES,
        useValue: queueNames,
      },
      BullQueueGateway,
      { provide: TOKENS.QueueGateway, useExisting: BullQueueGateway },
    ];

    return {
      module: InfrastructureBullMqQueuesModule,
      global: false,
      imports: [
        ...(options.imports ?? []),
        BullModule.registerQueue(...queueNames.map((name) => ({ name }))),
      ],
      providers,
      exports: [BullQueueGateway, TOKENS.QueueGateway, BullModule],
    };
  }

  /**
   * @deprecated Use `forRootAsync` and `registerQueues` at the composition root instead.
   */
  static forRootFromAppConfig(queueNames: readonly string[]): DynamicModule {
    const connectionModule = InfrastructureBullMqModule.forRootAsync({
      imports: [InfrastructureConfigModule],
      inject: [AppConfigService],
      useFactory: (config: AppConfigService): BullMqModuleOptions => {
        const redisConfig = config.redis();
        const bullmqConfig = config.bullmq();

        return {
          connection: {
            host: redisConfig.host,
            port: redisConfig.port,
            password: redisConfig.password,
            db: redisConfig.db,
            connectTimeoutMs: redisConfig.connectTimeoutMs,
          },
          defaultJobOptions: {
            attempts: bullmqConfig.defaultAttempts,
            backoffDelay: bullmqConfig.backoffDelay,
          },
        };
      },
    });

    return {
      module: InfrastructureBullMqModule,
      global: false,
      imports: [
        connectionModule,
        InfrastructureBullMqModule.registerQueues(queueNames, { imports: [connectionModule] }),
      ],
      exports: [BullQueueGateway, TOKENS.QueueGateway, BullModule],
    };
  }
}

export { MODULE_OPTIONS_TOKEN as BULLMQ_MODULE_OPTIONS_TOKEN };
