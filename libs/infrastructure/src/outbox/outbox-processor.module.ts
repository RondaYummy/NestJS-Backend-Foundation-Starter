import { ConfigurableModuleBuilder, Module } from '@nestjs/common';

import type { OutboxProcessorOptions } from '@contracts/outbox/outbox-processor.options';
import { TOKENS } from '@contracts/tokens';

import { AuditModule } from '../audit/audit.module';
import { DrizzleModule } from '../database/drizzle/drizzle.module';
import { EventsModule } from '../events/events.module';
import { LoggerModule } from '../logger/logger.module';
import { OUTBOX_PROCESSOR_DEFAULT_OPTIONS } from './outbox-processor.defaults';
import { DrizzleOutboxProcessor } from './drizzle-outbox-processor';

export const { ConfigurableModuleClass, MODULE_OPTIONS_TOKEN, OPTIONS_TYPE, ASYNC_OPTIONS_TYPE } =
  new ConfigurableModuleBuilder<OutboxProcessorOptions>({
    optionsInjectionToken: TOKENS.OutboxProcessorOptions,
  })
    .setClassMethodName('forRoot')
    .setFactoryMethodName('forRootAsync')
    .build();

@Module({
  imports: [DrizzleModule, AuditModule, EventsModule, LoggerModule],
  providers: [
    DrizzleOutboxProcessor,
    {
      provide: TOKENS.OutboxProcessor,
      useExisting: DrizzleOutboxProcessor,
    },
  ],
  exports: [TOKENS.OutboxProcessor, TOKENS.OutboxProcessorOptions],
})
export class OutboxProcessorModule extends ConfigurableModuleClass {
  static forRoot(options: typeof OPTIONS_TYPE = OUTBOX_PROCESSOR_DEFAULT_OPTIONS) {
    return {
      ...super.forRoot(options),
      global: false,
    };
  }

  static forRootAsync(options: typeof ASYNC_OPTIONS_TYPE) {
    return {
      ...super.forRootAsync(options),
      global: false,
    };
  }
}

export { MODULE_OPTIONS_TOKEN as OUTBOX_PROCESSOR_MODULE_OPTIONS_TOKEN };
