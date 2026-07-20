/// <reference types="jest" />

import type { ISessionManagementService } from '@contracts/auth/session-management.service';
import { ValidationError } from '@domain/errors/domain-errors';

import { ListSessionsUseCase } from './list-sessions.usecase';

describe('ListSessionsUseCase', () => {
  it('delegates to the management port with user and current session id', async () => {
    const sessions = [
      {
        id: 'sid-1',
        createdAt: '2026-07-19T09:00:00.000Z',
        lastActivityAt: '2026-07-19T09:00:00.000Z',
        expiresAt: '2026-07-26T09:00:00.000Z',
        ip: '203.0.113.10',
        userAgent: 'Mozilla/5.0',
        isCurrent: true,
      },
    ];
    const sessionManagement: jest.Mocked<Pick<ISessionManagementService, 'listForUser'>> = {
      listForUser: jest.fn().mockResolvedValue(sessions),
    };

    const useCase = new ListSessionsUseCase(
      sessionManagement as unknown as ISessionManagementService,
    );

    await expect(useCase.execute('user-1', 'sid-1')).resolves.toEqual(sessions);
    expect(sessionManagement.listForUser).toHaveBeenCalledWith('user-1', 'sid-1');
  });

  it('propagates SESSION_DRIVER_REQUIRED from the JWT stub', async () => {
    const sessionManagement: jest.Mocked<Pick<ISessionManagementService, 'listForUser'>> = {
      listForUser: jest
        .fn()
        .mockRejectedValue(
          new ValidationError(
            'SESSION_DRIVER_REQUIRED',
            'Session management is only available when AUTH_DRIVER=session',
          ),
        ),
    };

    const useCase = new ListSessionsUseCase(
      sessionManagement as unknown as ISessionManagementService,
    );

    const error: unknown = await useCase.execute('user-1', 'sid-1').catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).code).toBe('SESSION_DRIVER_REQUIRED');
  });
});
