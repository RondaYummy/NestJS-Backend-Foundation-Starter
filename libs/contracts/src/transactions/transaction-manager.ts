export interface TransactionContext<TTx = unknown> {
  tx: TTx;
}

export interface ITransactionManager {
  run<T>(handler: (trx: TransactionContext) => Promise<T>): Promise<T>;
}
