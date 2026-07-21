import {
  DynamicModule,
  Module,
  Provider,
  type FactoryProvider,
  type ModuleMetadata,
} from '@nestjs/common';

import { AppLogger } from './app-logger.service';
import { LOGGER_MODULE_OPTIONS, type LoggerModuleOptions } from './logger.module-options';
import { RequestContextService } from './request-context.service';
import { RequestContextMiddleware } from './request-context.middleware';

type LoggerModuleAsyncOptions = Pick<
  FactoryProvider<LoggerModuleOptions>,
  'useFactory' | 'inject'
> & {
  imports?: ModuleMetadata['imports'];
};

@Module({})
export class LoggerModule {
  static forRoot(options: LoggerModuleOptions): DynamicModule {
    return {
      module: LoggerModule,
      global: true,
      providers: [
        { provide: LOGGER_MODULE_OPTIONS, useValue: options },
        AppLogger,
        RequestContextService,
        RequestContextMiddleware,
      ],
      exports: [AppLogger, RequestContextService, RequestContextMiddleware],
    };
  }

  static forRootAsync(asyncOptions: LoggerModuleAsyncOptions): DynamicModule {
    const optionsProvider: Provider = {
      provide: LOGGER_MODULE_OPTIONS,
      useFactory: asyncOptions.useFactory,
      inject: asyncOptions.inject ?? [],
    };

    return {
      module: LoggerModule,
      global: true,
      imports: [...(asyncOptions.imports ?? [])],
      providers: [
        optionsProvider,
        AppLogger,
        RequestContextService,
        RequestContextMiddleware,
      ],
      exports: [AppLogger, RequestContextService, RequestContextMiddleware],
    };
  }
}
