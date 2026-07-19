import { User } from '@domain/entities/user.entity';
import { Email } from '@domain/value-objects/email.vo';

export class UserMapper {
  static toDomain(row: {
    id: string;
    email: string;
    passwordHash: string | null;
    googleSub: string | null;
    roles: string[];
    authVersion: number;
    createdAt: Date;
    updatedAt: Date;
  }): User {
    return User.restore({
      id: row.id,
      email: Email.create(row.email),
      passwordHash: row.passwordHash,
      googleSub: row.googleSub,
      roles: row.roles,
      authVersion: row.authVersion,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  }

  static toPersistence(user: User) {
    return {
      id: user.id,
      email: user.email.toString(),
      passwordHash: user.passwordHash,
      googleSub: user.googleSub,
      roles: user.roles,
      authVersion: user.authVersion,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }
}
