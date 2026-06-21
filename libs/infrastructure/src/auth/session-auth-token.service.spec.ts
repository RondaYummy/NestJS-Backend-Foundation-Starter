/// <reference types="jest" />

import type { ISessionStore } from '@contracts/auth/session-store.service';
import type { CurrentUser } from '@contracts/auth/current-user';

import { SessionAuthTokenService } from './session-auth-token.service';
import type { AuthModuleOptions } from './auth.module-options';

describe('SessionAuthTokenService', () => {
  const resolveSessionUser = jest.fn<Promise<CurrentUser | null>, [string]>();

  const sessionOptions: AuthModuleOptions = {
    driver: 'session',
    passwordSaltRounds: 10,
    sessionTtlSeconds: 3600,
    resolveSessionUser,
  };

  let sessionStore: jest.Mocked<ISessionStore>;
  let service: SessionAuthTokenService;

  beforeEach(() => {
    sessionStore = {
      create: jest.fn().mockResolvedValue('session-id'),
      get: jest.fn(),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    resolveSessionUser.mockReset();
    service = new SessionAuthTokenService(sessionStore, sessionOptions);
  });

  it('stores userId and authVersion instead of full role snapshot', async () => {
    await service.createAuthSession({
      id: 'user-1',
      email: 'user@example.com',
      roles: ['admin'],
      authVersion: 4,
    });

    expect(sessionStore.create).toHaveBeenCalledWith(
      { userId: 'user-1', authVersion: 4 },
      3600,
    );
  });

  it('verifyAccessToken returns fresh user when session version matches DB (V-11)', async () => {
    sessionStore.get.mockResolvedValue({ userId: 'user-1', authVersion: 2 });
    resolveSessionUser.mockResolvedValue({
      id: 'user-1',
      email: 'user@example.com',
      roles: ['user'],
      authVersion: 2,
    });

    await expect(service.verifyAccessToken('session-id')).resolves.toEqual({
      id: 'user-1',
      email: 'user@example.com',
      roles: ['user'],
      authVersion: 2,
    });
  });

  it('verifyAccessToken returns null when authVersion is stale (V-11 / AC-6)', async () => {
    sessionStore.get.mockResolvedValue({ userId: 'user-1', authVersion: 1 });
    resolveSessionUser.mockResolvedValue({
      id: 'user-1',
      email: 'user@example.com',
      roles: ['user'],
      authVersion: 2,
    });

    await expect(service.verifyAccessToken('session-id')).resolves.toBeNull();
  });

  it('verifyAccessToken returns null when user no longer exists', async () => {
    sessionStore.get.mockResolvedValue({ userId: 'user-1', authVersion: 1 });
    resolveSessionUser.mockResolvedValue(null);

    await expect(service.verifyAccessToken('session-id')).resolves.toBeNull();
  });
});
