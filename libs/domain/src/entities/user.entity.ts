import { randomUUID } from 'node:crypto';
import { Email } from '../value-objects/email.vo';

type UserProps = {
  id: string;
  email: Email;
  /** `null` for identity-provider-only accounts (e.g. Google SSO) that never set a password. */
  passwordHash: string | null;
  /** Durable Google OIDC subject (`sub`) association; `null` when the account is not linked. */
  googleSub: string | null;
  roles: string[];
  authVersion: number;
  createdAt: Date;
  updatedAt: Date;
};

type RestoreUserProps = Omit<UserProps, 'googleSub'> & { googleSub?: string | null };

export class User {
  private constructor(private readonly props: UserProps) {}

  static create(input: { email: string; passwordHash: string; roles?: string[] }): User {
    const now = new Date();

    return new User({
      id: randomUUID(),
      email: Email.create(input.email),
      passwordHash: input.passwordHash,
      googleSub: null,
      roles: input.roles ?? ['user'],
      authVersion: 0,
      createdAt: now,
      updatedAt: now,
    });
  }

  /**
   * Creates a Google-only account: no local password (`passwordHash: null`).
   * Password login must reject such accounts; reset-password is the way to
   * set an initial local password later.
   */
  static createFromGoogle(input: { email: string; googleSub: string; roles?: string[] }): User {
    const now = new Date();

    return new User({
      id: randomUUID(),
      email: Email.create(input.email),
      passwordHash: null,
      googleSub: input.googleSub,
      roles: input.roles ?? ['user'],
      authVersion: 0,
      createdAt: now,
      updatedAt: now,
    });
  }

  static restore(props: RestoreUserProps): User {
    return new User({ ...props, googleSub: props.googleSub ?? null });
  }

  get id(): string {
    return this.props.id;
  }

  get email(): Email {
    return this.props.email;
  }

  get passwordHash(): string | null {
    return this.props.passwordHash;
  }

  get googleSub(): string | null {
    return this.props.googleSub;
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

  /**
   * Associates a verified Google subject with an existing account
   * (auto-link on verified email match). Link-only: no authVersion bump.
   */
  linkGoogleSubject(googleSub: string): User {
    return User.restore({
      ...this.props,
      googleSub,
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
