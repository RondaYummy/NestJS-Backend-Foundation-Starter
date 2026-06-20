import { DynamicModule, Module, type ModuleMetadata } from '@nestjs/common';
import { TOKENS } from '@contracts/tokens';
import { UserDrizzleRepository } from './user-drizzle.repository';

type RepositoriesModuleRegisterOptions = {
  imports?: ModuleMetadata['imports'];
};

@Module({})
export class RepositoriesModule {
  static register(options: RepositoriesModuleRegisterOptions = {}): DynamicModule {
    return {
      module: RepositoriesModule,
      imports: options.imports ?? [],
      providers: [
        UserDrizzleRepository,
        { provide: TOKENS.UserRepository, useExisting: UserDrizzleRepository },
      ],
      exports: [TOKENS.UserRepository],
    };
  }
}
