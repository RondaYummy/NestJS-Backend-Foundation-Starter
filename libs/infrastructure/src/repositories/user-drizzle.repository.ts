import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';

import type { IUserRepository } from '@contracts/repositories/user.repository';
import type { TransactionContext } from '@contracts/transactions/transaction-manager';
import type { User } from '@domain/entities/user.entity';
import { ConflictError } from '@domain/errors/domain-errors';

import { DRIZZLE_DB } from '../database/drizzle/drizzle.tokens';
import type { DrizzleDb } from '../database/drizzle/drizzle.types';
import { users } from '../database/drizzle/schema/users.schema';
import { UserMapper } from '../mappers/user.mapper';

type DrizzleTransactionContext = TransactionContext<DrizzleDb>;

@Injectable()
export class UserDrizzleRepository implements IUserRepository {
  constructor(
    @Inject(DRIZZLE_DB)
    private readonly db: DrizzleDb,
  ) {}

  async findById(id: string, trx?: DrizzleTransactionContext): Promise<User | null> {
    const db = trx?.tx ?? this.db;

    const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1);

    return row ? UserMapper.toDomain(row) : null;
  }

  async findByEmail(email: string, trx?: DrizzleTransactionContext): Promise<User | null> {
    const db = trx?.tx ?? this.db;

    const [row] = await db.select().from(users).where(eq(users.email, email)).limit(1);

    return row ? UserMapper.toDomain(row) : null;
  }

  async save(user: User, trx?: DrizzleTransactionContext): Promise<void> {
    const db = trx?.tx ?? this.db;
    const data = UserMapper.toPersistence(user);

    try {
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
    } catch (error) {
      if (isUniqueEmailViolation(error)) {
        throw new ConflictError('USER_ALREADY_EXISTS', 'User already exists');
      }

      throw error;
    }
  }
}

function isUniqueEmailViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: string }).code === '23505'
  );
}
