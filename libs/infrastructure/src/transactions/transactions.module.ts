import { DynamicModule, Module, type ModuleMetadata } from '@nestjs/common';
import { TOKENS } from '@contracts/tokens';
import { DrizzleTransactionManager } from './drizzle-transaction.manager';

type TransactionsModuleRegisterOptions = {
  imports?: ModuleMetadata['imports'];
};

@Module({})
export class TransactionsModule {
  static register(options: TransactionsModuleRegisterOptions = {}): DynamicModule {
    return {
      module: TransactionsModule,
      imports: options.imports ?? [],
      providers: [
        DrizzleTransactionManager,
        { provide: TOKENS.TransactionManager, useExisting: DrizzleTransactionManager },
      ],
      exports: [TOKENS.TransactionManager],
    };
  }
}
