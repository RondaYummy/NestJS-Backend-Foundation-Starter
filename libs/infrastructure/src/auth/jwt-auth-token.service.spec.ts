/// <reference types="jest" />

import type { JwtService } from '@nestjs/jwt';

import type { IJwtTokenStore } from '@contracts/auth/jwt-token-store.service';
import type { CurrentUser } from '@contracts/auth/current-user';

import { JwtAuthTokenService } from './jwt-auth-token.service';
import type { AuthModuleOptions } from './auth.module-options';

describe('JwtAuthTokenService', () => {
  const jwtOptions: AuthModuleOptions = {
    driver: 'jwt',
    passwordSaltRounds: 10,
    jwt: {
      secret: 'access-secret',
      expiresIn: '15m',
      refreshSecret: 'refresh-secret',
      refreshExpiresIn: '7d',
    },
  };

  const freshUser: CurrentUser = {
    id: 'user-1',
    email: 'user@example.com',
    roles: ['admin', 'user'],
    authVersion: 2,
  };

  let jwtService: jest.Mocked<Pick<JwtService, 'signAsync' | 'verifyAsync'>>;
  let tokenStore: jest.Mocked<IJwtTokenStore>;
  let service: JwtAuthTokenService;

  beforeEach(() => {
    jwtService = {
      signAsync: jest.fn(),
      verifyAsync: jest.fn(),
    };
    tokenStore = {
      saveRefreshToken: jest.fn().mockResolvedValue(undefined),
      rotateRefreshToken: jest.fn().mockResolvedValue(true),
      revokeRefreshTokenFamily: jest.fn().mockResolvedValue(undefined),
      revokeAccessToken: jest.fn().mockResolvedValue(undefined),
      isAccessTokenRevoked: jest.fn().mockResolvedValue(false),
    };
    service = new JwtAuthTokenService(jwtService as unknown as JwtService, jwtOptions, tokenStore);
  });

  it('embeds authVersion in access and refresh JWT payloads at issuance (V-11 / AC-3)', async () => {
    jwtService.signAsync.mockResolvedValueOnce('access-token').mockResolvedValueOnce('refresh-token');

    await service.createAuthSession(freshUser);

    expect(jwtService.signAsync).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        id: freshUser.id,
        email: freshUser.email,
        roles: freshUser.roles,
        authVersion: 2,
        type: 'access',
      }),
      expect.any(Object),
    );
    expect(jwtService.signAsync).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        id: freshUser.id,
        authVersion: 2,
        type: 'refresh',
      }),
      expect.any(Object),
    );
  });

  it('parseRefreshToken returns authVersion and treats missing claim as 0 (legacy)', async () => {
    jwtService.verifyAsync.mockResolvedValue({
      id: 'user-1',
      email: 'user@example.com',
      roles: ['user'],
      type: 'refresh',
      jti: 'refresh-jti',
      familyId: 'family-1',
    });

    await expect(service.parseRefreshToken('refresh-token')).resolves.toEqual({
      userId: 'user-1',
      familyId: 'family-1',
      tokenId: 'refresh-jti',
      authVersion: 0,
    });
  });

  it('rotateAuthSession issues tokens with fresh user data, not stale refresh payload (V-11 / AC-5)', async () => {
    jwtService.signAsync.mockResolvedValueOnce('new-access').mockResolvedValueOnce('new-refresh');

    const updatedUser: CurrentUser = {
      id: 'user-1',
      email: 'user@example.com',
      roles: ['user'],
      authVersion: 3,
    };

    const tokens = await service.rotateAuthSession(
      {
        userId: 'user-1',
        familyId: 'family-1',
        tokenId: 'refresh-jti',
        authVersion: 3,
      },
      updatedUser,
    );

    expect(tokens).toEqual({
      accessToken: 'new-access',
      refreshToken: 'new-refresh',
    });
    expect(jwtService.signAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        roles: ['user'],
        authVersion: 3,
        type: 'access',
      }),
      expect.any(Object),
    );
  });

  it('verifyAccessToken treats missing authVersion claim as 0', async () => {
    jwtService.verifyAsync.mockResolvedValue({
      id: 'user-1',
      email: 'user@example.com',
      roles: ['user'],
      type: 'access',
      jti: 'access-jti',
    });

    await expect(service.verifyAccessToken('access-token')).resolves.toEqual({
      id: 'user-1',
      email: 'user@example.com',
      roles: ['user'],
      authVersion: 0,
    });
  });
});
