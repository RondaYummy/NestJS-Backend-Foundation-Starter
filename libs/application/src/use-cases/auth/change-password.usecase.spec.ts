/// <reference types="jest" />

import type { IAuthTokenService } from '@contracts/auth/auth-token.service';
import type { IPasswordHasher } from '@contracts/auth/password-hasher.service';
import type { IUserRepository } from '@contracts/repositories/user.repository';
import { User } from '@domain/entities/user.entity';
import { Email } from '@domain/value-objects/email.vo';
import { NotFoundError, ValidationError } from '@domain/errors/domain-errors';

import { ChangePasswordUseCase } from './change-password.usecase';

describe('ChangePasswordUseCase', () => {
  let userRepository: jest.Mocked<Pick<IUserRepository, 'findById' | 'update'>>;
  let passwordHasher: jest.Mocked<Pick<IPasswordHasher, 'compare' | 'hash'>>;
  let authTokenService: jest.Mocked<
    Pick<IAuthTokenService, 'createAuthSession' | 'revokeAllForUser'>
  >;
  let useCase: ChangePasswordUseCase;

  const existingUser = () =>
    User.restore({
      id: 'user-1',
      email: Email.create('user@example.com'),
      passwordHash: 'old-hash',
      roles: ['user'],
      authVersion: 3,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    });

  beforeEach(() => {
    userRepository = {
      findById: jest.fn().mockResolvedValue(existingUser()),
      update: jest.fn().mockResolvedValue(undefined),
    };
    passwordHasher = {
      compare: jest.fn().mockResolvedValue(true),
      hash: jest.fn().mockResolvedValue('new-hash'),
    };
    authTokenService = {
      createAuthSession: jest.fn().mockResolvedValue({
        accessToken: 'new-access',
        refreshToken: 'new-refresh',
      }),
      revokeAllForUser: jest.fn().mockResolvedValue(undefined),
    };
    useCase = new ChangePasswordUseCase(
      userRepository as unknown as IUserRepository,
      passwordHasher,
      authTokenService as unknown as IAuthTokenService,
    );
  });

  it('changes the password, bumps authVersion and re-issues auth (AC-01, AC-05)', async () => {
    const result = await useCase.execute({
      userId: 'user-1',
      currentPassword: 'old-password',
      newPassword: 'new-password',
    });

    expect(passwordHasher.compare).toHaveBeenCalledWith('old-password', 'old-hash');
    expect(passwordHasher.hash).toHaveBeenCalledWith('new-password');

    const persistedUser = userRepository.update.mock.calls[0]![0];
    expect(persistedUser.passwordHash).toBe('new-hash');
    expect(persistedUser.authVersion).toBe(4);

    expect(authTokenService.createAuthSession).toHaveBeenCalledWith({
      id: 'user-1',
      email: 'user@example.com',
      roles: ['user'],
      authVersion: 4,
    });

    expect(result).toEqual({
      user: { id: 'user-1', email: 'user@example.com', roles: ['user'] },
      auth: { accessToken: 'new-access', refreshToken: 'new-refresh' },
    });
  });

  it('purges stored auth artifacts before re-issuing the new ones (P1-02 AC-01, AC-02, AC-03)', async () => {
    const callOrder: string[] = [];

    authTokenService.revokeAllForUser.mockImplementation(() => {
      callOrder.push('revokeAllForUser');

      return Promise.resolve();
    });
    authTokenService.createAuthSession.mockImplementation(() => {
      callOrder.push('createAuthSession');

      return Promise.resolve({ accessToken: 'new-access', refreshToken: 'new-refresh' });
    });

    await useCase.execute({
      userId: 'user-1',
      currentPassword: 'old-password',
      newPassword: 'new-password',
    });

    expect(authTokenService.revokeAllForUser).toHaveBeenCalledWith('user-1');
    expect(callOrder).toEqual(['revokeAllForUser', 'createAuthSession']);
  });

  it('does not purge auth artifacts when the password change fails (P1-02)', async () => {
    passwordHasher.compare.mockResolvedValue(false);

    await expect(
      useCase.execute({
        userId: 'user-1',
        currentPassword: 'wrong-password',
        newPassword: 'new-password',
      }),
    ).rejects.toBeInstanceOf(ValidationError);

    expect(authTokenService.revokeAllForUser).not.toHaveBeenCalled();
  });

  it('never exposes passwordHash or plaintext passwords in the result (AC-09)', async () => {
    const result = await useCase.execute({
      userId: 'user-1',
      currentPassword: 'old-password',
      newPassword: 'new-password',
    });

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('new-hash');
    expect(serialized).not.toContain('old-hash');
    expect(serialized).not.toContain('new-password');
    expect(serialized).not.toContain('old-password');
  });

  it('rejects a wrong current password with INVALID_CURRENT_PASSWORD and no persistence (AC-03)', async () => {
    passwordHasher.compare.mockResolvedValue(false);

    const error: unknown = await useCase
      .execute({
        userId: 'user-1',
        currentPassword: 'wrong-password',
        newPassword: 'new-password',
      })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).code).toBe('INVALID_CURRENT_PASSWORD');

    expect(userRepository.update).not.toHaveBeenCalled();
    expect(authTokenService.createAuthSession).not.toHaveBeenCalled();
  });

  it('rejects newPassword equal to currentPassword with SAME_PASSWORD (AC-04)', async () => {
    const error: unknown = await useCase
      .execute({
        userId: 'user-1',
        currentPassword: 'same-password',
        newPassword: 'same-password',
      })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).code).toBe('SAME_PASSWORD');

    expect(passwordHasher.hash).not.toHaveBeenCalled();
    expect(userRepository.update).not.toHaveBeenCalled();
  });

  it('rejects a Google-only account (null password hash) with PASSWORD_NOT_SET and no bcrypt compare (TASK-004)', async () => {
    userRepository.findById.mockResolvedValue(
      User.restore({
        id: 'user-1',
        email: Email.create('google-only@example.com'),
        passwordHash: null,
        googleSub: 'google-sub-1',
        roles: ['user'],
        authVersion: 0,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      }),
    );

    const error: unknown = await useCase
      .execute({
        userId: 'user-1',
        currentPassword: 'anything',
        newPassword: 'new-password',
      })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).code).toBe('PASSWORD_NOT_SET');

    expect(passwordHasher.compare).not.toHaveBeenCalled();
    expect(userRepository.update).not.toHaveBeenCalled();
    expect(authTokenService.createAuthSession).not.toHaveBeenCalled();
  });

  it('throws USER_NOT_FOUND when the authenticated user no longer exists', async () => {
    userRepository.findById.mockResolvedValue(null);

    await expect(
      useCase.execute({
        userId: 'user-1',
        currentPassword: 'old-password',
        newPassword: 'new-password',
      }),
    ).rejects.toBeInstanceOf(NotFoundError);

    expect(userRepository.update).not.toHaveBeenCalled();
  });
});
