/// <reference types="jest" />

import { createHash } from 'node:crypto';

import type { IAuthTokenService } from '@contracts/auth/auth-token.service';
import type { IPasswordHasher } from '@contracts/auth/password-hasher.service';
import type { IPasswordResetTokenStore } from '@contracts/auth/password-reset-token-store';
import type { IUserRepository } from '@contracts/repositories/user.repository';
import { User } from '@domain/entities/user.entity';
import { Email } from '@domain/value-objects/email.vo';
import { ValidationError } from '@domain/errors/domain-errors';

import { ResetPasswordUseCase } from './reset-password.usecase';

describe('ResetPasswordUseCase', () => {
  let tokenStore: jest.Mocked<IPasswordResetTokenStore>;
  let userRepository: jest.Mocked<Pick<IUserRepository, 'findById' | 'update'>>;
  let passwordHasher: jest.Mocked<Pick<IPasswordHasher, 'hash'>>;
  let authTokenService: jest.Mocked<Pick<IAuthTokenService, 'createAuthSession'>>;
  let useCase: ResetPasswordUseCase;

  const rawToken = 'raw-reset-token';
  const rawTokenHash = createHash('sha256').update(rawToken).digest('hex');

  const existingUser = () =>
    User.restore({
      id: 'user-1',
      email: Email.create('user@example.com'),
      passwordHash: 'old-hash',
      roles: ['user'],
      authVersion: 2,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

  beforeEach(() => {
    tokenStore = {
      save: jest.fn(),
      consume: jest.fn().mockResolvedValue('user-1'),
    };
    userRepository = {
      findById: jest.fn().mockResolvedValue(existingUser()),
      update: jest.fn().mockResolvedValue(undefined),
    };
    passwordHasher = {
      hash: jest.fn().mockResolvedValue('new-hash'),
    };
    authTokenService = {
      createAuthSession: jest.fn().mockResolvedValue({
        sessionId: 'session-1',
        expiresAt: new Date('2026-08-01T00:00:00.000Z'),
      }),
    };
    useCase = new ResetPasswordUseCase(
      tokenStore,
      userRepository as unknown as IUserRepository,
      passwordHasher as unknown as IPasswordHasher,
      authTokenService as unknown as IAuthTokenService,
    );
  });

  it('consumes the hashed token, sets the password, bumps authVersion and re-issues auth (AC-07)', async () => {
    const result = await useCase.execute({ token: rawToken, newPassword: 'new-password' });

    expect(tokenStore.consume).toHaveBeenCalledWith(rawTokenHash);
    expect(passwordHasher.hash).toHaveBeenCalledWith('new-password');

    const persistedUser = userRepository.update.mock.calls[0]![0];
    expect(persistedUser.passwordHash).toBe('new-hash');
    expect(persistedUser.authVersion).toBe(3);

    expect(authTokenService.createAuthSession).toHaveBeenCalledWith({
      id: 'user-1',
      email: 'user@example.com',
      roles: ['user'],
      authVersion: 3,
    });

    expect(result).toEqual({
      user: { id: 'user-1', email: 'user@example.com', roles: ['user'] },
      auth: {
        sessionId: 'session-1',
        expiresAt: new Date('2026-08-01T00:00:00.000Z'),
      },
    });
  });

  it('rejects an invalid, expired, or reused token with INVALID_RESET_TOKEN (AC-08)', async () => {
    tokenStore.consume.mockResolvedValue(null);

    const error: unknown = await useCase
      .execute({ token: rawToken, newPassword: 'new-password' })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).code).toBe('INVALID_RESET_TOKEN');
    expect(userRepository.update).not.toHaveBeenCalled();
    expect(authTokenService.createAuthSession).not.toHaveBeenCalled();
  });

  it('rejects when the bound user no longer exists, without changing anything', async () => {
    userRepository.findById.mockResolvedValue(null);

    const error: unknown = await useCase
      .execute({ token: rawToken, newPassword: 'new-password' })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).code).toBe('INVALID_RESET_TOKEN');
    expect(userRepository.update).not.toHaveBeenCalled();
  });

  it('never exposes passwordHash or plaintext passwords in the result (AC-09)', async () => {
    const result = await useCase.execute({ token: rawToken, newPassword: 'new-password' });

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('new-hash');
    expect(serialized).not.toContain('old-hash');
    expect(serialized).not.toContain('new-password');
    expect(serialized).not.toContain(rawToken);
  });
});
