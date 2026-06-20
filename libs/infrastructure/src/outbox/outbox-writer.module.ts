import { DynamicModule, Module, type ModuleMetadata } from '@nestjs/common';

import { TOKENS } from '@contracts/tokens';

import { DrizzleOutboxWriter } from './drizzle-outbox-writer';

type OutboxWriterModuleRegisterOptions = {
  imports?: ModuleMetadata['imports'];
};

@Module({})
export class OutboxWriterModule {
  static register(options: OutboxWriterModuleRegisterOptions = {}): DynamicModule {
    return {
      module: OutboxWriterModule,
      imports: options.imports ?? [],
      providers: [
        DrizzleOutboxWriter,
        {
          provide: TOKENS.OutboxWriter,
          useExisting: DrizzleOutboxWriter,
        },
      ],
      exports: [TOKENS.OutboxWriter],
    };
  }
}
