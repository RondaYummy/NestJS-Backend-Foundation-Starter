/// <reference types="jest" />

import { createHash } from 'node:crypto';

import type { IPasswordResetTokenStore } from '@contracts/auth/password-reset-token-store';
import type { IQueueGateway } from '@contracts/queues/queue-gateway';
import type { IUserRepository } from '@contracts/repositories/user.repository';
import type { TemplatedEmailJob } from '@contracts/mail/email-job';
import { User } from '@domain/entities/user.entity';
import { Email } from '@domain/value-objects/email.vo';

import { ForgotPasswordUseCase, type ForgotPasswordLogger } from './forgot-password.usecase';

describe('ForgotPasswordUseCase', () => {
  let userRepository: jest.Mocked<Pick<IUserRepository, 'findByEmail'>>;
  let tokenStore: jest.Mocked<IPasswordResetTokenStore>;
  let queueGateway: jest.Mocked<IQueueGateway>;
  let logger: jest.Mocked<ForgotPasswordLogger>;

  const existingUser = () =>
    User.restore({
      id: 'user-1',
      email: Email.create('user@example.com'),
      passwordHash: 'hash',
      roles: ['user'],
      authVersion: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

  function createUseCase(options?: { resetUrlBase?: string }) {
    return new ForgotPasswordUseCase(
      userRepository as unknown as IUserRepository,
      tokenStore,
      queueGateway,
      {
        tokenTtlSeconds: 1800,
        resetUrlBase: options?.resetUrlBase ?? '',
      },
      logger,
    );
  }

  beforeEach(() => {
    userRepository = {
      findByEmail: jest.fn().mockResolvedValue(existingUser()),
    };
    tokenStore = {
      save: jest.fn().mockResolvedValue(undefined),
      consume: jest.fn(),
    };
    queueGateway = {
      add: jest.fn().mockResolvedValue('job-1'),
      addBulk: jest.fn(),
    };
    logger = {
      info: jest.fn(),
      warn: jest.fn(),
    };
  });

  it('returns the same generic success for known and unknown emails (AC-06)', async () => {
    const useCase = createUseCase();

    const knownResult = await useCase.execute({ email: 'user@example.com' });

    userRepository.findByEmail.mockResolvedValue(null);
    const unknownResult = await useCase.execute({ email: 'nobody@example.com' });

    expect(knownResult).toEqual({ success: true });
    expect(unknownResult).toEqual({ success: true });
  });

  it('skips token storage and enqueue for unknown emails', async () => {
    userRepository.findByEmail.mockResolvedValue(null);

    await createUseCase().execute({ email: 'nobody@example.com' });

    expect(tokenStore.save).not.toHaveBeenCalled();
    expect(queueGateway.add).not.toHaveBeenCalled();
  });

  it('stores only the SHA-256 hash and enqueues the raw token for a known user (AC-07, AC-09)', async () => {
    await createUseCase().execute({ email: 'user@example.com' });

    expect(tokenStore.save).toHaveBeenCalledTimes(1);
    const [userId, storedHash, ttlSeconds] = tokenStore.save.mock.calls[0]!;

    expect(queueGateway.add).toHaveBeenCalledTimes(1);
    const [queueName, jobName, payload] = queueGateway.add.mock.calls[0]!;
    const job = payload as TemplatedEmailJob<'password-reset'>;

    expect(queueName).toBe('email');
    expect(jobName).toBe('send-password-reset-email');
    expect(job.template).toBe('password-reset');
    expect(job.to).toBe('user@example.com');
    expect(job.data.expiresInMinutes).toBe(30);
    expect(job.data.resetUrl).toBeUndefined();

    expect(userId).toBe('user-1');
    expect(ttlSeconds).toBe(1800);

    // The stored value is the hash of the enqueued raw token, never the raw token.
    const expectedHash = createHash('sha256').update(job.data.token).digest('hex');
    expect(storedHash).toBe(expectedHash);
    expect(storedHash).not.toBe(job.data.token);
  });

  it('includes a reset URL when PASSWORD_RESET_URL_BASE is configured', async () => {
    await createUseCase({ resetUrlBase: 'https://app.example/reset' }).execute({
      email: 'user@example.com',
    });

    const job = queueGateway.add.mock.calls[0]![2] as TemplatedEmailJob<'password-reset'>;

    expect(job.data.resetUrl).toBe(`https://app.example/reset?token=${job.data.token}`);
  });

  it('still returns success and logs a warning when enqueue fails (FR-12, FR-15)', async () => {
    queueGateway.add.mockRejectedValue(new Error('queue unavailable'));

    const result = await createUseCase().execute({ email: 'user@example.com' });

    expect(result).toEqual({ success: true });
    expect(logger.warn).toHaveBeenCalledWith(
      'Failed to enqueue password reset email',
      expect.objectContaining({ userId: 'user-1' }),
    );
  });

  it('never logs the raw token or its hash (AC-09)', async () => {
    await createUseCase().execute({ email: 'user@example.com' });

    const job = queueGateway.add.mock.calls[0]![2] as TemplatedEmailJob<'password-reset'>;
    const loggedPayloads = [...logger.info.mock.calls, ...logger.warn.mock.calls].map((call) =>
      JSON.stringify(call),
    );

    for (const logged of loggedPayloads) {
      expect(logged).not.toContain(job.data.token);
    }
  });
});
