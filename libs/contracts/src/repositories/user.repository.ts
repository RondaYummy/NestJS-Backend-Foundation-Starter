import type { TransactionContext } from '@contracts/transactions/transaction-manager';
import type { User } from '@domain/entities/user.entity';

export interface IUserRepository<TTx = unknown> {
  findById(id: string, trx?: TransactionContext<TTx>): Promise<User | null>;
  findByEmail(email: string, trx?: TransactionContext<TTx>): Promise<User | null>;
  save(user: User, trx?: TransactionContext<TTx>): Promise<void>;
}
