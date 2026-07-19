import { randomUUID } from 'node:crypto';
import { Email } from '../value-objects/email.vo';

type UserProps = {
  id: string;
  email: Email;
  passwordHash: string;
  roles: string[];
  authVersion: number;
  createdAt: Date;
  updatedAt: Date;
};

export class User {
  private constructor(private readonly props: UserProps) {}

  static create(input: { email: string; passwordHash: string; roles?: string[] }): User {
    const now = new Date();

    return new User({
      id: randomUUID(),
      email: Email.create(input.email),
      passwordHash: input.passwordHash,
      roles: input.roles ?? ['user'],
      authVersion: 0,
      createdAt: now,
      updatedAt: now,
    });
  }

  static restore(props: UserProps): User {
    return new User(props);
  }

  get id(): string {
    return this.props.id;
  }

  get email(): Email {
    return this.props.email;
  }

  get passwordHash(): string {
    return this.props.passwordHash;
  }

  get roles(): string[] {
    return this.props.roles;
  }

  get authVersion(): number {
    return this.props.authVersion;
  }

  incrementAuthVersion(): User {
    return User.restore({
      ...this.props,
      authVersion: this.props.authVersion + 1,
      updatedAt: new Date(),
    });
  }

  /**
   * Replaces the password hash and bumps `authVersion` in one atomic domain
   * transition so outstanding JWT/session credentials become stale together
   * with the credential change.
   */
  changePassword(passwordHash: string): User {
    return User.restore({
      ...this.props,
      passwordHash,
      authVersion: this.props.authVersion + 1,
      updatedAt: new Date(),
    });
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  get updatedAt(): Date {
    return this.props.updatedAt;
  }
}
