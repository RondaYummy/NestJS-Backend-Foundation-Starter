/// <reference types="jest" />

import type { ISessionManagementService } from '@contracts/auth/session-management.service';
import { NotFoundError } from '@domain/errors/domain-errors';

import { RevokeSessionUseCase } from './revoke-session.usecase';

describe('RevokeSessionUseCase', () => {
  let sessionManagement: jest.Mocked<Pick<ISessionManagementService, 'revokeOne'>>;
  let useCase: RevokeSessionUseCase;

  beforeEach(() => {
    sessionManagement = {
      revokeOne: jest.fn().mockResolvedValue({ clearedCurrent: false }),
    };
    useCase = new RevokeSessionUseCase(
      sessionManagement as unknown as ISessionManagementService,
    );
  });

  it('revokes a non-current session without clearing current', async () => {
    await expect(useCase.execute('user-1', 'other-sid', 'current-sid')).resolves.toEqual({
      clearedCurrent: false,
    });
    expect(sessionManagement.revokeOne).toHaveBeenCalledWith(
      'user-1',
      'other-sid',
      'current-sid',
    );
  });

  it('returns clearedCurrent when revoking the current session', async () => {
    sessionManagement.revokeOne.mockResolvedValue({ clearedCurrent: true });

    await expect(useCase.execute('user-1', 'current-sid', 'current-sid')).resolves.toEqual({
      clearedCurrent: true,
    });
  });

  it('propagates SESSION_NOT_FOUND for missing or non-owned ids', async () => {
    sessionManagement.revokeOne.mockRejectedValue(
      new NotFoundError('SESSION_NOT_FOUND', 'Session not found'),
    );

    const error: unknown = await useCase
      .execute('user-1', 'foreign-sid', 'current-sid')
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(NotFoundError);
    expect((error as NotFoundError).code).toBe('SESSION_NOT_FOUND');
  });
});
