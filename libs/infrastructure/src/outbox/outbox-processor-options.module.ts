import { ConfigurableModuleBuilder, DynamicModule, Module } from '@nestjs/common';

import type { OutboxProcessorOptions } from '@contracts/outbox/outbox-processor.options';
import { TOKENS } from '@contracts/tokens';

import { OUTBOX_PROCESSOR_DEFAULT_OPTIONS } from './outbox-processor.defaults';

export const { ConfigurableModuleClass, MODULE_OPTIONS_TOKEN, OPTIONS_TYPE, ASYNC_OPTIONS_TYPE } =
  new ConfigurableModuleBuilder<OutboxProcessorOptions>({
    optionsInjectionToken: TOKENS.OutboxProcessorOptions,
  })
    .setClassMethodName('forRoot')
    .setFactoryMethodName('forRootAsync')
    .build();

@Module({})
export class OutboxProcessorOptionsModule extends ConfigurableModuleClass {
  static forRoot(options: typeof OPTIONS_TYPE = OUTBOX_PROCESSOR_DEFAULT_OPTIONS): DynamicModule {
    const rootModule = super.forRoot(options);

    return {
      ...rootModule,
      global: false,
      exports: [...(rootModule.exports ?? []), TOKENS.OutboxProcessorOptions],
    };
  }

  static forRootAsync(options: typeof ASYNC_OPTIONS_TYPE): DynamicModule {
    const rootModule = super.forRootAsync(options);

    return {
      ...rootModule,
      global: false,
      exports: [...(rootModule.exports ?? []), TOKENS.OutboxProcessorOptions],
    };
  }
}

export { MODULE_OPTIONS_TOKEN as OUTBOX_PROCESSOR_OPTIONS_MODULE_OPTIONS_TOKEN };
