import type { IAuthTokenService } from '@contracts/auth/auth-token.service';
import type { GoogleIdentityProfile } from '@contracts/auth/google-identity.service';
import type { IOutboxWriter } from '@contracts/outbox/outbox-writer';
import { DuplicateRecordError } from '@contracts/repositories/repository-errors';
import type { IUserRepository } from '@contracts/repositories/user.repository';
import type { ITransactionManager } from '@contracts/transactions/transaction-manager';
import { User } from '@domain/entities/user.entity';
import { AuthenticationError, ConflictError } from '@domain/errors/domain-errors';
import { UserRegisteredEvent } from '@domain/events/user-registered.event';
import { Email } from '@domain/value-objects/email.vo';

/**
 * Completes a Google sign-in for an already-verified Google identity profile
 * (FR-01, FR-06..FR-08). Resolution order:
 *
 * 1. durable Google `sub` association;
 * 2. auto-link by e-mail — only when Google asserts the e-mail is verified;
 * 3. first-time creation of a Google-only user (null password hash) with the
 *    same `UserRegisteredEvent` outbox parity as password registration.
 *
 * Issues auth artifacts through the active `IAuthTokenService` driver, exactly
 * like `LoginUseCase`.
 */
export class CompleteGoogleSignInUseCase {
  constructor(
    private readonly userRepository: IUserRepository,
    private readonly authTokenService: IAuthTokenService,
    private readonly transactionManager: ITransactionManager,
    private readonly outboxWriter: IOutboxWriter,
  ) {}

  async execute(profile: GoogleIdentityProfile) {
    const user = await this.resolveUser(profile);

    const auth = await this.authTokenService.createAuthSession({
      id: user.id,
      email: user.email.toString(),
      roles: user.roles,
      authVersion: user.authVersion,
    });

    return {
      user: {
        id: user.id,
        email: user.email.toString(),
        roles: user.roles,
      },
      auth,
    };
  }

  private async resolveUser(profile: GoogleIdentityProfile): Promise<User> {
    const existingBySub = await this.userRepository.findByGoogleSub(profile.sub);

    if (existingBySub) {
      return existingBySub;
    }

    if (!profile.emailVerified) {
      throw new AuthenticationError(
        'GOOGLE_SSO_EMAIL_UNVERIFIED',
        'Google account e-mail is not verified',
      );
    }

    const normalizedEmail = Email.create(profile.email).toString();
    const existingByEmail = await this.userRepository.findByEmail(normalizedEmail);

    if (existingByEmail) {
      const linkedUser = existingByEmail.linkGoogleSubject(profile.sub);

      await this.userRepository.update(linkedUser);

      return linkedUser;
    }

    return this.createGoogleOnlyUser(normalizedEmail, profile.sub);
  }

  private async createGoogleOnlyUser(email: string, googleSub: string): Promise<User> {
    return this.transactionManager.run(async (trx) => {
      const newUser = User.createFromGoogle({
        email,
        googleSub,
        roles: ['user'],
      });

      try {
        await this.userRepository.insert(newUser, trx);
      } catch (error) {
        // Concurrent register/Google sign-in race on email or google_sub.
        if (error instanceof DuplicateRecordError) {
          throw new ConflictError('USER_ALREADY_EXISTS', 'User already exists');
        }

        throw error;
      }

      await this.outboxWriter.append(
        new UserRegisteredEvent({
          userId: newUser.id,
          email: newUser.email.toString(),
        }),
        trx,
      );

      return newUser;
    });
  }
}
