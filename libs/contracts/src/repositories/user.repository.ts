import { TransactionContext } from '@contracts/transactions/transaction-manager';
import { User } from '@domain/entities/user.entity';

export interface IUserRepository<TTx = unknown> {
  findById(id: string, trx?: TransactionContext<TTx>): Promise<User | null>;

  findByEmail(email: string, trx?: TransactionContext<TTx>): Promise<User | null>;

  insert(user: User, trx?: TransactionContext<TTx>): Promise<void>;

  update(user: User, trx?: TransactionContext<TTx>): Promise<void>;
}
