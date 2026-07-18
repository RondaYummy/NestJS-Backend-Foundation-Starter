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
  exports: [TOKENS.OutboxProcessor],
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
    const optionsModule = OutboxProcessorOptionsModule.forRoot(options);

    return {
      module: OutboxProcessorModule,
      global: false,
      imports: [optionsModule, ...OutboxProcessorModule.buildFeatureImports()],
      exports: [optionsModule],
    };
  }

  static forRootAsync(options: typeof ASYNC_OPTIONS_TYPE): DynamicModule {
    const connectionImports = options.imports ?? [];
    const optionsModule = OutboxProcessorOptionsModule.forRootAsync(options);

    return {
      module: OutboxProcessorModule,
      global: false,
      imports: [optionsModule, ...OutboxProcessorModule.buildFeatureImports(connectionImports)],
      exports: [optionsModule],
    };
  }
}

export { OUTBOX_PROCESSOR_OPTIONS_MODULE_OPTIONS_TOKEN as OUTBOX_PROCESSOR_MODULE_OPTIONS_TOKEN } from './outbox-processor-options.module';
