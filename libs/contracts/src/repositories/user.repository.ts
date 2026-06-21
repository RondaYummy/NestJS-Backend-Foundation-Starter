import type { TransactionContext } from '@contracts/transactions/transaction-manager';
import type { User } from '@domain/entities/user.entity';

export interface IUserRepository {
  findById(id: string, trx?: TransactionContext): Promise<User | null>;

  findByEmail(email: string, trx?: TransactionContext): Promise<User | null>;

  insert(user: User, trx?: TransactionContext): Promise<void>;

  update(user: User, trx?: TransactionContext): Promise<void>;

  /**
   * Bumps `authVersion` for the user. Downstream apps should call this on
   * password change, role change, and other security-reset events so
   * outstanding JWT/session credentials become stale on the next refresh or request.
   */
  incrementAuthVersion(userId: string, trx?: TransactionContext): Promise<number>;
}
