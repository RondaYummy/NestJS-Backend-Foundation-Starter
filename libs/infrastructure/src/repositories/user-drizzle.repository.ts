import { Inject, Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';

import {
  DuplicateRecordError,
  RepositoryRecordNotFoundError,
} from '@contracts/repositories/repository-errors';
import type { IUserRepository } from '@contracts/repositories/user.repository';
import type { TransactionContext } from '@contracts/transactions/transaction-manager';
import type { User } from '@domain/entities/user.entity';

import { DRIZZLE_DB } from '../database/drizzle/drizzle.tokens';
import type { DrizzleDb, DrizzleExecutor } from '../database/drizzle/drizzle.types';
import { UserMapper } from '../mappers/user.mapper';
import { resolveDrizzleExecutor } from '../transactions/drizzle-transaction-context';
import { users } from '../database/drizzle/schema/users.schema';

@Injectable()
export class UserDrizzleRepository implements IUserRepository {
  constructor(
    @Inject(DRIZZLE_DB)
    private readonly db: DrizzleDb,
  ) {}

  async findById(id: string, trx?: TransactionContext): Promise<User | null> {
    const db = this.resolveDb(trx);

    const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1);

    return row ? UserMapper.toDomain(row) : null;
  }

  async findByEmail(email: string, trx?: TransactionContext): Promise<User | null> {
    const db = this.resolveDb(trx);

    const [row] = await db.select().from(users).where(eq(users.email, email)).limit(1);

    return row ? UserMapper.toDomain(row) : null;
  }

  async findByGoogleSub(googleSub: string, trx?: TransactionContext): Promise<User | null> {
    const db = this.resolveDb(trx);

    const [row] = await db.select().from(users).where(eq(users.googleSub, googleSub)).limit(1);

    return row ? UserMapper.toDomain(row) : null;
  }

  async insert(user: User, trx?: TransactionContext): Promise<void> {
    const db = this.resolveDb(trx);
    const data = UserMapper.toPersistence(user);

    try {
      await db.insert(users).values(data);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new DuplicateRecordError(getViolatedConstraint(error) ?? 'users_email_unique');
      }

      throw error;
    }
  }

  async update(user: User, trx?: TransactionContext): Promise<void> {
    const db = this.resolveDb(trx);
    const data = UserMapper.toPersistence(user);

    try {
      const updated = await db
        .update(users)
        .set({
          email: data.email,
          passwordHash: data.passwordHash,
          googleSub: data.googleSub,
          roles: data.roles,
          authVersion: data.authVersion,
          updatedAt: new Date(),
        })
        .where(eq(users.id, data.id))
        .returning({
          id: users.id,
        });

      if (updated.length === 0) {
        throw new RepositoryRecordNotFoundError('users', data.id);
      }
    } catch (error) {
      // Concurrent Google-link race: another row already owns this google_sub.
      if (isUniqueViolation(error)) {
        throw new DuplicateRecordError(getViolatedConstraint(error));
      }

      throw error;
    }
  }

  async incrementAuthVersion(userId: string, trx?: TransactionContext): Promise<number> {
    const db = this.resolveDb(trx);

    const [row] = await db
      .update(users)
      .set({
        authVersion: sql`${users.authVersion} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId))
      .returning({ authVersion: users.authVersion });

    if (!row) {
      throw new RepositoryRecordNotFoundError('users', userId);
    }

    return row.authVersion;
  }

  private resolveDb(trx?: TransactionContext): DrizzleExecutor {
    return resolveDrizzleExecutor(this.db, trx);
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: string }).code === '23505'
  );
}

function getViolatedConstraint(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'constraint' in error) {
    const constraint = (error as { constraint?: unknown }).constraint;

    return typeof constraint === 'string' ? constraint : undefined;
  }

  return undefined;
}
