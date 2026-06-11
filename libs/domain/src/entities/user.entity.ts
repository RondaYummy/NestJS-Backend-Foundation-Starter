import { randomUUID } from 'node:crypto';
import { Email } from '../value-objects/email.vo';

type UserProps = {
  id: string;
  email: Email;
  passwordHash: string;
  roles: string[];
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

  get createdAt(): Date {
    return this.props.createdAt;
  }

  get updatedAt(): Date {
    return this.props.updatedAt;
  }
}
