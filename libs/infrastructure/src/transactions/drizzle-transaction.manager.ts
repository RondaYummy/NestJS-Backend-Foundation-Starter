import { Inject, Injectable } from '@nestjs/common';
import type {
  ITransactionManager,
  TransactionContext,
} from '@contracts/transactions/transaction-manager';
import { DRIZZLE_DB } from '../database/drizzle/drizzle.tokens';
@Injectable()
export class DrizzleTransactionManager implements ITransactionManager {
  constructor(
    @Inject(DRIZZLE_DB)
    private readonly db: { transaction: <T>(handler: (tx: unknown) => Promise<T>) => Promise<T> },
  ) {}
  run<T>(handler: (trx: TransactionContext) => Promise<T>): Promise<T> {
    return this.db.transaction((tx) => handler({ tx }));
  }
}
