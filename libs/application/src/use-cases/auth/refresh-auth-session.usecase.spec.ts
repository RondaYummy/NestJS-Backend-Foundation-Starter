/// <reference types="jest" />

import type { IAuthTokenService, ParsedRefreshToken } from '@contracts/auth/auth-token.service';
import type { IUserRepository } from '@contracts/repositories/user.repository';
import type { CurrentUser } from '@contracts/auth/current-user';
import { User } from '@domain/entities/user.entity';
import { Email } from '@domain/value-objects/email.vo';
import { AuthenticationError } from '@domain/errors/domain-errors';

import { RefreshAuthSessionUseCase } from './refresh-auth-session.usecase';

describe('RefreshAuthSessionUseCase', () => {
  let authTokenService: jest.Mocked<
    Pick<IAuthTokenService, 'parseRefreshToken' | 'rotateAuthSession'>
  >;
  let userRepository: jest.Mocked<Pick<IUserRepository, 'findById'>>;
  let useCase: RefreshAuthSessionUseCase;

  const parsed: ParsedRefreshToken = {
    userId: 'user-1',
    familyId: 'family-1',
    tokenId: 'refresh-jti',
    authVersion: 1,
  };

  beforeEach(() => {
    authTokenService = {
      parseRefreshToken: jest.fn().mockResolvedValue(parsed),
      rotateAuthSession: jest.fn().mockResolvedValue({
        accessToken: 'new-access',
        refreshToken: 'new-refresh',
      }),
    };
    userRepository = {
      findById: jest.fn(),
    };
    useCase = new RefreshAuthSessionUseCase(
      authTokenService as unknown as IAuthTokenService,
      userRepository as unknown as IUserRepository,
    );
  });

  function restoreUser(roles: string[], authVersion: number) {
    return User.restore({
      id: 'user-1',
      email: Email.create('user@example.com'),
      passwordHash: 'hash',
      roles,
      authVersion,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  it('reloads user from repository and rotates with fresh roles (V-11 / AC-4, AC-5)', async () => {
    userRepository.findById.mockResolvedValue(restoreUser(['user'], 1));

    const result = await useCase.execute('refresh-token');

    expect(authTokenService.parseRefreshToken).toHaveBeenCalledWith('refresh-token');
    expect(userRepository.findById).toHaveBeenCalledWith('user-1');
    expect(authTokenService.rotateAuthSession).toHaveBeenCalledWith(parsed, {
      id: 'user-1',
      email: 'user@example.com',
      roles: ['user'],
      authVersion: 1,
    } satisfies CurrentUser);
    expect(result).toEqual({
      accessToken: 'new-access',
      refreshToken: 'new-refresh',
    });
  });

  it('rejects refresh when authVersion mismatch after role revoke (V-11)', async () => {
    userRepository.findById.mockResolvedValue(restoreUser(['user'], 2));

    await expect(useCase.execute('refresh-token')).rejects.toBeInstanceOf(AuthenticationError);
    expect(authTokenService.rotateAuthSession).not.toHaveBeenCalled();
  });

  it('rejects refresh when user is missing', async () => {
    userRepository.findById.mockResolvedValue(null);

    await expect(useCase.execute('refresh-token')).rejects.toBeInstanceOf(AuthenticationError);
    expect(authTokenService.rotateAuthSession).not.toHaveBeenCalled();
  });
});
