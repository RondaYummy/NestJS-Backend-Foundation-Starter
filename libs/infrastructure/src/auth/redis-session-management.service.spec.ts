/// <reference types="jest" />

import type { SessionRecord } from '@contracts/auth/session-record';
import type { ISessionStore, SessionListEntry } from '@contracts/auth/session-store.service';
import { NotFoundError } from '@domain/errors/domain-errors';

import { RedisSessionManagementService } from './redis-session-management.service';
import { UnsupportedSessionManagementService } from './unsupported-session-management.service';

describe('RedisSessionManagementService', () => {
  let sessionStore: jest.Mocked<ISessionStore>;
  let service: RedisSessionManagementService;

  const record = (userId = 'user-1'): SessionRecord => ({
    userId,
    authVersion: 1,
    createdAt: '2026-07-19T09:00:00.000Z',
    lastActivityAt: '2026-07-19T09:00:00.000Z',
    ip: '203.0.113.10',
    userAgent: 'Mozilla/5.0',
  });

  const entry = (id: string, userId = 'user-1'): SessionListEntry => ({
    id,
    record: record(userId),
    expiresAt: new Date('2026-07-26T09:00:00.000Z'),
  });

  beforeEach(() => {
    sessionStore = {
      create: jest.fn(),
      get: jest.fn(),
      delete: jest.fn().mockResolvedValue(undefined),
      listByUserId: jest.fn(),
    };
    service = new RedisSessionManagementService(sessionStore);
  });

  it('lists sessions and marks exactly the current id as isCurrent', async () => {
    sessionStore.listByUserId.mockResolvedValue([entry('sid-a'), entry('sid-b')]);

    const listed = await service.listForUser('user-1', 'sid-b');

    expect(listed).toEqual([
      expect.objectContaining({ id: 'sid-a', isCurrent: false, ip: '203.0.113.10' }),
      expect.objectContaining({ id: 'sid-b', isCurrent: true }),
    ]);
    expect(listed.filter((item) => item.isCurrent)).toHaveLength(1);
  });

  it('revokeOne deletes an owned non-current session', async () => {
    sessionStore.get.mockResolvedValue(record());

    await expect(service.revokeOne('user-1', 'other', 'current')).resolves.toEqual({
      clearedCurrent: false,
    });
    expect(sessionStore.delete).toHaveBeenCalledWith('other');
  });

  it('revokeOne clears current when the target matches the cookie session', async () => {
    sessionStore.get.mockResolvedValue(record());

    await expect(service.revokeOne('user-1', 'current', 'current')).resolves.toEqual({
      clearedCurrent: true,
    });
  });

  it('revokeOne returns SESSION_NOT_FOUND for missing or foreign sessions without deleting', async () => {
    sessionStore.get.mockResolvedValue(null);

    await expect(service.revokeOne('user-1', 'missing', 'current')).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(sessionStore.delete).not.toHaveBeenCalled();

    sessionStore.get.mockResolvedValue(record('other-user'));

    await expect(service.revokeOne('user-1', 'foreign', 'current')).rejects.toMatchObject({
      code: 'SESSION_NOT_FOUND',
    });
    expect(sessionStore.delete).not.toHaveBeenCalled();
  });

  it('revokeOthers deletes every session except the current one', async () => {
    sessionStore.listByUserId.mockResolvedValue([
      entry('keep'),
      entry('drop-1'),
      entry('drop-2'),
    ]);

    await expect(service.revokeOthers('user-1', 'keep')).resolves.toEqual({ revokedCount: 2 });
    expect(sessionStore.delete).toHaveBeenCalledWith('drop-1');
    expect(sessionStore.delete).toHaveBeenCalledWith('drop-2');
    expect(sessionStore.delete).not.toHaveBeenCalledWith('keep');
  });

  it('revokeAll deletes every session for the user', async () => {
    sessionStore.listByUserId.mockResolvedValue([entry('a'), entry('b')]);

    await service.revokeAll('user-1');

    expect(sessionStore.delete).toHaveBeenCalledWith('a');
    expect(sessionStore.delete).toHaveBeenCalledWith('b');
  });
});

describe('UnsupportedSessionManagementService', () => {
  const service = new UnsupportedSessionManagementService();

  it.each([
    ['listForUser', () => service.listForUser('u', 's')],
    ['revokeOne', () => service.revokeOne('u', 's', 's')],
    ['revokeOthers', () => service.revokeOthers('u', 's')],
    ['revokeAll', () => service.revokeAll('u')],
  ] as const)('%s throws SESSION_DRIVER_REQUIRED', async (_name, invoke) => {
    await expect(invoke()).rejects.toMatchObject({ code: 'SESSION_DRIVER_REQUIRED' });
  });
});
