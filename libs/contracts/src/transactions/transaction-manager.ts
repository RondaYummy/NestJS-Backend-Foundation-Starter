export const TRANSACTION_CONTEXT = Symbol('TRANSACTION_CONTEXT');

export interface TransactionContext {
  readonly [TRANSACTION_CONTEXT]: unknown;
}

export interface ITransactionManager {
  run<T>(handler: (trx: TransactionContext) => Promise<T>): Promise<T>;
}
