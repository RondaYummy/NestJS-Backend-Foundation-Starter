import { DynamicModule, Module, type ModuleMetadata, type Type } from '@nestjs/common';

import type { IDomainEventHandler } from '@contracts/events/domain-event-handler';
import { TOKENS } from '@contracts/tokens';

import { AuditModule } from '../audit/audit.module';
import { EventsModule } from '../events/events.module';
import { OUTBOX_PROCESSOR_DEFAULT_OPTIONS } from './outbox-processor.defaults';
import { DrizzleOutboxProcessor } from './drizzle-outbox-processor';
import {
  ASYNC_OPTIONS_TYPE,
  OPTIONS_TYPE,
  OutboxProcessorOptionsModule,
} from './outbox-processor-options.module';

type OutboxProcessorFeatures = {
  eventHandlers?: Type<IDomainEventHandler>[];
};

@Module({
  providers: [
    DrizzleOutboxProcessor,
    {
      provide: TOKENS.OutboxProcessor,
      useExisting: DrizzleOutboxProcessor,
    },
  ],
  exports: [TOKENS.OutboxProcessor],
})
export class OutboxProcessorModule {
  private static buildFeatureImports(
    connectionImports: NonNullable<ModuleMetadata['imports']> = [],
    eventHandlers?: Type<IDomainEventHandler>[],
  ): NonNullable<ModuleMetadata['imports']> {
    return [
      ...connectionImports,
      AuditModule.register({ imports: connectionImports }),
      EventsModule.register({ imports: connectionImports, handlers: eventHandlers }),
    ];
  }

  static forRoot(
    options: typeof OPTIONS_TYPE = OUTBOX_PROCESSOR_DEFAULT_OPTIONS,
    features?: OutboxProcessorFeatures,
  ): DynamicModule {
    const optionsModule = OutboxProcessorOptionsModule.forRoot(options);

    return {
      module: OutboxProcessorModule,
      global: false,
      imports: [
        optionsModule,
        ...OutboxProcessorModule.buildFeatureImports([], features?.eventHandlers),
      ],
      exports: [optionsModule],
    };
  }

  static forRootAsync(
    options: typeof ASYNC_OPTIONS_TYPE,
    features?: OutboxProcessorFeatures,
  ): DynamicModule {
    const connectionImports = options.imports ?? [];
    const optionsModule = OutboxProcessorOptionsModule.forRootAsync(options);

    return {
      module: OutboxProcessorModule,
      global: false,
      imports: [
        optionsModule,
        ...OutboxProcessorModule.buildFeatureImports(connectionImports, features?.eventHandlers),
      ],
      exports: [optionsModule],
    };
  }
}

export { OUTBOX_PROCESSOR_OPTIONS_MODULE_OPTIONS_TOKEN as OUTBOX_PROCESSOR_MODULE_OPTIONS_TOKEN } from './outbox-processor-options.module';
