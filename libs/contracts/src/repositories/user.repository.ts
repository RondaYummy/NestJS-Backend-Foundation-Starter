import { type TransactionContext } from '@contracts/transactions/transaction-manager';
import type { User } from '@domain/entities/user.entity';

export interface IUserRepository {
  findById(id: string, trx?: TransactionContext): Promise<User | null>;

  findByEmail(email: string, trx?: TransactionContext): Promise<User | null>;

  save(user: User, trx?: TransactionContext): Promise<void>;
}
