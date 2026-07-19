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
  let authTokenService: jest.Mocked<Pick<IAuthTokenService, 'createAuthSession'>>;
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
