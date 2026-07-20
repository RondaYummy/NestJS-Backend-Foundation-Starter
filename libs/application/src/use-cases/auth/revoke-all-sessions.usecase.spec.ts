/// <reference types="jest" />

import type { ISessionManagementService } from '@contracts/auth/session-management.service';

import { RevokeAllSessionsUseCase } from './revoke-all-sessions.usecase';

describe('RevokeAllSessionsUseCase', () => {
  it('delegates revoke-all for the authenticated user', async () => {
    const sessionManagement: jest.Mocked<Pick<ISessionManagementService, 'revokeAll'>> = {
      revokeAll: jest.fn().mockResolvedValue(undefined),
    };
    const useCase = new RevokeAllSessionsUseCase(
      sessionManagement as unknown as ISessionManagementService,
    );

    await expect(useCase.execute('user-1')).resolves.toBeUndefined();
    expect(sessionManagement.revokeAll).toHaveBeenCalledWith('user-1');
  });
});
