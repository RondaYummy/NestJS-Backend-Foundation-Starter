/// <reference types="jest" />

import type { ISessionManagementService } from '@contracts/auth/session-management.service';

import { RevokeOtherSessionsUseCase } from './revoke-other-sessions.usecase';

describe('RevokeOtherSessionsUseCase', () => {
  it('delegates revoke-others and returns revokedCount', async () => {
    const sessionManagement: jest.Mocked<Pick<ISessionManagementService, 'revokeOthers'>> = {
      revokeOthers: jest.fn().mockResolvedValue({ revokedCount: 2 }),
    };
    const useCase = new RevokeOtherSessionsUseCase(
      sessionManagement as unknown as ISessionManagementService,
    );

    await expect(useCase.execute('user-1', 'current-sid')).resolves.toEqual({ revokedCount: 2 });
    expect(sessionManagement.revokeOthers).toHaveBeenCalledWith('user-1', 'current-sid');
  });
});
