import { createHash, randomBytes } from 'node:crypto';

import type { IPasswordResetTokenStore } from '@contracts/auth/password-reset-token-store';
import type { TemplatedEmailJob } from '@contracts/mail/email-job';
import { EMAIL_TEMPLATE } from '@contracts/mail/email-template-id';
import type { IQueueGateway } from '@contracts/queues/queue-gateway';
import { QUEUES } from '@contracts/queues/queue-names';
import type { IUserRepository } from '@contracts/repositories/user.repository';
import { Email } from '@domain/value-objects/email.vo';

type ForgotPasswordInput = {
  email: string;
};

export type ForgotPasswordOptions = {
  tokenTtlSeconds: number;
  /** Optional frontend URL; when set, the email links to `${urlBase}?token=<raw token>`. */
  resetUrlBase: string;
};

/**
 * Minimal structural logger port so the use case stays free of
 * infrastructure imports; `AppLogger` satisfies it at composition time.
 */
export type ForgotPasswordLogger = {
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
};

export class ForgotPasswordUseCase {
  constructor(
    private readonly userRepository: IUserRepository,
    private readonly passwordResetTokenStore: IPasswordResetTokenStore,
    private readonly queueGateway: IQueueGateway,
    private readonly options: ForgotPasswordOptions,
    private readonly logger: ForgotPasswordLogger,
  ) {}

  /**
   * Enumeration-safe: always resolves to a generic success. The raw reset
   * token is never persisted, logged, or returned — only its SHA-256 hash is
   * stored and only the email payload carries the raw token.
   */
  async execute(input: ForgotPasswordInput): Promise<{ success: true }> {
    const normalizedEmail = Email.create(input.email).toString();
    const user = await this.userRepository.findByEmail(normalizedEmail);

    if (!user) {
      return { success: true };
    }

    const rawToken = randomBytes(32).toString('base64url');
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');

    await this.passwordResetTokenStore.save(user.id, tokenHash, this.options.tokenTtlSeconds);

    const resetUrl = this.options.resetUrlBase
      ? `${this.options.resetUrlBase}?token=${rawToken}`
      : undefined;

    const emailJob: TemplatedEmailJob<'password-reset'> = {
      to: normalizedEmail,
      subject: 'Password reset',
      idempotencyKey: `password-reset:${user.id}:${tokenHash}`,
      template: EMAIL_TEMPLATE.PASSWORD_RESET,
      data: {
        email: normalizedEmail,
        token: rawToken,
        resetUrl,
        expiresInMinutes: Math.round(this.options.tokenTtlSeconds / 60),
      },
    };

    try {
      await this.queueGateway.add(QUEUES.EMAIL, 'send-password-reset-email', emailJob, {
        jobId: `password-reset-email:${tokenHash}`,
      });

      this.logger.info('Password reset email enqueued', { userId: user.id });
    } catch (error) {
      // FR-12 / FR-15: never reveal delivery problems to the caller.
      this.logger.warn('Failed to enqueue password reset email', {
        userId: user.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return { success: true };
  }
}
