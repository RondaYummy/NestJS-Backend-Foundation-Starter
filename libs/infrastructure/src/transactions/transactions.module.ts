import { Global, Module } from '@nestjs/common';
import { TOKENS } from '@contracts/tokens';
import { DrizzleModule } from '../database/drizzle/drizzle.module';
import { DrizzleTransactionManager } from './drizzle-transaction.manager';
@Global()
@Module({
  imports: [DrizzleModule],
  providers: [
    DrizzleTransactionManager,
    { provide: TOKENS.TransactionManager, useExisting: DrizzleTransactionManager },
  ],
  exports: [TOKENS.TransactionManager],
})
export class TransactionsModule {}
