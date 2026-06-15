import {
  TRANSACTION_CONTEXT,
  type TransactionContext,
} from '@contracts/transactions/transaction-manager';

import type { DrizzleExecutor, DrizzleTransaction } from '../database/drizzle/drizzle.types';

/**
 * Infrastructure-specific представлення TransactionContext.
 *
 * Contracts бачать лише:
 *
 * TransactionContext {
 *   [TRANSACTION_CONTEXT]: unknown
 * }
 *
 * Drizzle infrastructure знає, що всередині
 * знаходиться DrizzleTransaction.
 */
export type DrizzleTransactionContext = TransactionContext & {
  readonly [TRANSACTION_CONTEXT]: DrizzleTransaction;
};

/**
 * Створює загальний TransactionContext
 * із конкретної Drizzle-транзакції.
 */
export function createDrizzleTransactionContext(
  transaction: DrizzleTransaction,
): DrizzleTransactionContext {
  return {
    [TRANSACTION_CONTEXT]: transaction,
  };
}

/**
 * Перевіряє та повертає Drizzle-транзакцію
 * із загального TransactionContext.
 */
export function getDrizzleTransaction(context: TransactionContext): DrizzleTransaction {
  const transaction = context[TRANSACTION_CONTEXT];

  if (!transaction) {
    throw new Error('Transaction context does not contain a transaction');
  }

  return transaction as DrizzleTransaction;
}

/**
 * Повертає executor для repository.
 *
 * Якщо TransactionContext передано —
 * repository використовує активну транзакцію.
 *
 * Якщо не передано —
 * repository використовує основне DB-з'єднання.
 */
export function resolveDrizzleExecutor(
  db: DrizzleExecutor,
  context?: TransactionContext,
): DrizzleExecutor {
  if (!context) {
    return db;
  }

  return getDrizzleTransaction(context);
}
