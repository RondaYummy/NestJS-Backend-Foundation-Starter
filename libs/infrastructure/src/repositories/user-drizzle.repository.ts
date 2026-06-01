import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { users } from '../database/drizzle/schema/users.schema';
import { DRIZZLE_DB } from '../database/drizzle/drizzle.tokens';
import { UserMapper } from '../mappers/user.mapper';
import { IUserRepository } from '@contracts/repositories/user.repository';
import { TransactionContext } from '@contracts/transactions/transaction-manager';
import { User } from '@domain/entities/user.entity';

@Injectable()
export class UserDrizzleRepository implements IUserRepository {
  constructor(
    @Inject(DRIZZLE_DB)
    private readonly db: any,
  ) {}

  async findById(id: string, trx?: TransactionContext): Promise<User | null> {
    const db = (trx?.tx ?? this.db) as typeof this.db & {
      insert: (table: unknown) => {
        values: (value: unknown) => { onConflictDoUpdate: (input: unknown) => Promise<unknown> };
      };
    };

    const [row] = await db
      .select()
      .from(users)
      .where(eq(users.id, id))
      .limit(1);

    return row ? UserMapper.toDomain(row) : null;
  }

  async findByEmail(email: string, trx?: TransactionContext): Promise<User | null> {
    const db = (trx?.tx ?? this.db) as typeof this.db & {
      insert: (table: unknown) => {
        values: (value: unknown) => { onConflictDoUpdate: (input: unknown) => Promise<unknown> };
      };
    };

    const [row] = await db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    return row ? UserMapper.toDomain(row) : null;
  }

  async save(user: User, trx?: TransactionContext): Promise<void> {
    const db = (trx?.tx ?? this.db) as typeof this.db & {
      insert: (table: unknown) => {
        values: (value: unknown) => { onConflictDoUpdate: (input: unknown) => Promise<unknown> };
      };
    };

    const data = UserMapper.toPersistence(user);

    await db
      .insert(users)
      .values(data)
      .onConflictDoUpdate({
        target: users.id,
        set: {
          email: data.email,
          passwordHash: data.passwordHash,
          roles: data.roles,
          updatedAt: new Date(),
        },
      });
  }
}
