import { DynamicModule, Module, type ModuleMetadata } from '@nestjs/common';
import { TOKENS } from '@contracts/tokens';
import { RedisDistributedLock } from './redis-distributed-lock';

type LocksModuleRegisterOptions = {
  imports?: ModuleMetadata['imports'];
};

@Module({})
export class LocksModule {
  static register(options: LocksModuleRegisterOptions = {}): DynamicModule {
    return {
      module: LocksModule,
      imports: options.imports ?? [],
      providers: [
        RedisDistributedLock,
        { provide: TOKENS.DistributedLock, useExisting: RedisDistributedLock },
      ],
      exports: [TOKENS.DistributedLock],
    };
  }
}
