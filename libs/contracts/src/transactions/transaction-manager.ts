export interface TransactionContext {
  readonly tx: unknown;
}
export interface ITransactionManager {
  run<T>(handler: (trx: TransactionContext) => Promise<T>): Promise<T>;
}
