import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import type * as schema from './schema';

export type DrizzleDb = NodePgDatabase<typeof schema>;

/**
 * Тип callback, який приймає метод db.transaction().
 */
type DrizzleTransactionCallback = Parameters<DrizzleDb['transaction']>[0];

/**
 * Перший аргумент callback — реальна Drizzle-транзакція.
 *
 * Тобто тип значення tx у:
 *
 * db.transaction(async (tx) => {
 *   // tx має тип DrizzleTransaction
 * });
 */
export type DrizzleTransaction = Parameters<DrizzleTransactionCallback>[0];

/**
 * Repository може працювати або через основне DB-з'єднання,
 * або через активну транзакцію.
 */
export type DrizzleExecutor = DrizzleDb | DrizzleTransaction;
