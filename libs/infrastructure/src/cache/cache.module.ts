import { DynamicModule, Module, type ModuleMetadata } from '@nestjs/common';
import { TOKENS } from '@contracts/tokens';
import { RedisCacheGateway } from './redis-cache.gateway';

type CacheModuleRegisterOptions = {
  imports?: ModuleMetadata['imports'];
};

@Module({})
export class CacheModule {
  static register(options: CacheModuleRegisterOptions = {}): DynamicModule {
    return {
      module: CacheModule,
      imports: options.imports ?? [],
      providers: [
        RedisCacheGateway,
        { provide: TOKENS.CacheGateway, useExisting: RedisCacheGateway },
      ],
      exports: [TOKENS.CacheGateway, RedisCacheGateway],
    };
  }
}
