import { DynamicModule, Module, type ModuleMetadata } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';

import { GlobalExceptionFilter } from './global-exception.filter';

export type ExceptionsModuleRegisterOptions = {
  /** Must include a configured `LoggerModule.forRoot` / `forRootAsync` (or equivalent that exports `AppLogger`). */
  imports: NonNullable<ModuleMetadata['imports']>;
};

@Module({})
export class ExceptionsModule {
  static register(options: ExceptionsModuleRegisterOptions): DynamicModule {
    return {
      module: ExceptionsModule,
      imports: options.imports,
      providers: [
        GlobalExceptionFilter,
        {
          provide: APP_FILTER,
          useExisting: GlobalExceptionFilter,
        },
      ],
    };
  }
}
