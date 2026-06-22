import { DynamicModule, Module, type ModuleMetadata } from '@nestjs/common';

import { TOKENS } from '@contracts/tokens';

import { AuditModule } from '../audit/audit.module';
import { EventsModule } from '../events/events.module';
import { LoggerModule } from '../logger/logger.module';
import { OUTBOX_PROCESSOR_DEFAULT_OPTIONS } from './outbox-processor.defaults';
import { DrizzleOutboxProcessor } from './drizzle-outbox-processor';
import {
  ASYNC_OPTIONS_TYPE,
  OPTIONS_TYPE,
  OutboxProcessorOptionsModule,
} from './outbox-processor-options.module';

@Module({
  providers: [
    DrizzleOutboxProcessor,
    {
      provide: TOKENS.OutboxProcessor,
      useExisting: DrizzleOutboxProcessor,
    },
  ],
  exports: [TOKENS.OutboxProcessor, TOKENS.OutboxProcessorOptions],
})
export class OutboxProcessorModule {
  private static buildFeatureImports(
    connectionImports: NonNullable<ModuleMetadata['imports']> = [],
  ): NonNullable<ModuleMetadata['imports']> {
    return [
      ...connectionImports,
      AuditModule.register({ imports: connectionImports }),
      EventsModule.register({ imports: connectionImports }),
      LoggerModule,
    ];
  }

  static forRoot(options: typeof OPTIONS_TYPE = OUTBOX_PROCESSOR_DEFAULT_OPTIONS): DynamicModule {
    return {
      module: OutboxProcessorModule,
      global: false,
      imports: [
        OutboxProcessorOptionsModule.forRoot(options),
        ...OutboxProcessorModule.buildFeatureImports(),
      ],
    };
  }

  static forRootAsync(options: typeof ASYNC_OPTIONS_TYPE): DynamicModule {
    const connectionImports = options.imports ?? [];

    return {
      module: OutboxProcessorModule,
      global: false,
      imports: [
        OutboxProcessorOptionsModule.forRootAsync(options),
        ...OutboxProcessorModule.buildFeatureImports(connectionImports),
      ],
    };
  }
}

export { OUTBOX_PROCESSOR_OPTIONS_MODULE_OPTIONS_TOKEN as OUTBOX_PROCESSOR_MODULE_OPTIONS_TOKEN } from './outbox-processor-options.module';
