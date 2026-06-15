import { Inject, Injectable } from '@nestjs/common';

import type {
  ITransactionManager,
  TransactionContext,
} from '@contracts/transactions/transaction-manager';

import { DRIZZLE_DB } from '../database/drizzle/drizzle.tokens';
import type { DrizzleDb } from '../database/drizzle/drizzle.types';
import { createDrizzleTransactionContext } from './drizzle-transaction-context';

@Injectable()
export class DrizzleTransactionManager implements ITransactionManager {
  constructor(
    @Inject(DRIZZLE_DB)
    private readonly db: DrizzleDb,
  ) {}

  run<T>(handler: (trx: TransactionContext) => Promise<T>): Promise<T> {
    return this.db.transaction(async (transaction) => {
      const context = createDrizzleTransactionContext(transaction);

      return handler(context);
    });
  }
}
