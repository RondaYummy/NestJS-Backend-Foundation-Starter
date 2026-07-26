import {
  DynamicModule,
  Module,
  Provider,
  type FactoryProvider,
  type ModuleMetadata,
} from '@nestjs/common';
import { TOKENS } from '@contracts/tokens';

import { LocalStorageAdapter } from './local-storage.adapter';
import { S3StorageAdapter } from './s3-storage.adapter';
import {
  STORAGE_MODULE_OPTIONS,
  isS3StorageOptions,
  type StorageModuleOptions,
} from './storage.module-options';

type StorageModuleAsyncOptions = Pick<
  FactoryProvider<StorageModuleOptions>,
  'useFactory' | 'inject'
> & {
  imports?: ModuleMetadata['imports'];
};

@Module({})
export class StorageModule {
  static forRoot(options: StorageModuleOptions): DynamicModule {
    const gatewayProviders = isS3StorageOptions(options)
      ? [S3StorageAdapter, { provide: TOKENS.StorageGateway, useExisting: S3StorageAdapter }]
      : [LocalStorageAdapter, { provide: TOKENS.StorageGateway, useExisting: LocalStorageAdapter }];

    return {
      module: StorageModule,
      global: false,
      providers: [{ provide: STORAGE_MODULE_OPTIONS, useValue: options }, ...gatewayProviders],
      exports: [TOKENS.StorageGateway],
    };
  }

  static forRootAsync(asyncOptions: StorageModuleAsyncOptions): DynamicModule {
    const optionsProvider: Provider = {
      provide: STORAGE_MODULE_OPTIONS,
      useFactory: asyncOptions.useFactory,
      inject: asyncOptions.inject ?? [],
    };

    return {
      module: StorageModule,
      global: false,
      imports: [...(asyncOptions.imports ?? [])],
      providers: [
        optionsProvider,
        {
          provide: TOKENS.StorageGateway,
          inject: [STORAGE_MODULE_OPTIONS],
          useFactory: (options: StorageModuleOptions) =>
            isS3StorageOptions(options)
              ? new S3StorageAdapter(options)
              : new LocalStorageAdapter(options),
        },
      ],
      exports: [TOKENS.StorageGateway],
    };
  }
}
