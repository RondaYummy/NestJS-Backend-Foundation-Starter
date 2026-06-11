import { User } from '@domain/entities/user.entity';
import { Email } from '@domain/value-objects/email.vo';

export class UserMapper {
  static toDomain(row: {
    id: string;
    email: string;
    passwordHash: string;
    roles: string[];
    createdAt: Date;
    updatedAt: Date;
  }): User {
    return User.restore({
      id: row.id,
      email: Email.create(row.email),
      passwordHash: row.passwordHash,
      roles: row.roles,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  }

  static toPersistence(user: User) {
    return {
      id: user.id,
      email: user.email.toString(),
      passwordHash: user.passwordHash,
      roles: user.roles,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }
}
