/// <reference types="jest" />

import type { SessionRecord } from '@contracts/auth/session-record';

import type { RedisService } from '../redis/redis.service';
import { RedisSessionStore } from './redis-session-store.service';

describe('RedisSessionStore', () => {
  let redis: jest.Mocked<
    Pick<RedisService, 'set' | 'get' | 'del' | 'ttl' | 'sadd' | 'smembers' | 'srem' | 'expire'>
  >;
  let store: RedisSessionStore;

  const fullRecord = (overrides: Partial<SessionRecord> = {}): SessionRecord => ({
    userId: 'user-1',
    authVersion: 1,
    createdAt: '2026-07-19T09:00:00.000Z',
    lastActivityAt: '2026-07-19T09:00:00.000Z',
    ip: '203.0.113.10',
    userAgent: 'Mozilla/5.0',
    ...overrides,
  });

  beforeEach(() => {
    redis = {
      set: jest.fn().mockResolvedValue(undefined),
      get: jest.fn().mockResolvedValue(null),
      del: jest.fn().mockResolvedValue(undefined),
      ttl: jest.fn().mockResolvedValue(3600),
      sadd: jest.fn().mockResolvedValue(1),
      smembers: jest.fn().mockResolvedValue([]),
      srem: jest.fn().mockResolvedValue(1),
      expire: jest.fn().mockResolvedValue(undefined),
    };
    store = new RedisSessionStore(redis as unknown as RedisService);
  });

  it('create writes session JSON and indexes the id under the user SET', async () => {
    const sessionId = await store.create(fullRecord(), 3600);

    expect(sessionId).toEqual(expect.any(String));
    expect(redis.set).toHaveBeenCalledWith(
      `sessions:${sessionId}`,
      JSON.stringify(fullRecord()),
      3600,
    );
    expect(redis.sadd).toHaveBeenCalledWith('sessions:user:user-1', sessionId);
    expect(redis.expire).toHaveBeenCalledWith('sessions:user:user-1', 3600);
  });

  it('get dual-reads legacy JSON missing metadata fields', async () => {
    redis.get.mockResolvedValue(JSON.stringify({ userId: 'user-1', authVersion: 2 }));

    await expect(store.get('legacy-sid')).resolves.toEqual({
      userId: 'user-1',
      authVersion: 2,
      createdAt: '1970-01-01T00:00:00.000Z',
      lastActivityAt: '1970-01-01T00:00:00.000Z',
      ip: null,
      userAgent: null,
    });
  });

  it('listByUserId returns indexed sessions with expiresAt and prunes stale members', async () => {
    redis.smembers.mockResolvedValue(['alive', 'stale']);
    redis.get.mockImplementation((key: string) => {
      if (key === 'sessions:alive') {
        return Promise.resolve(JSON.stringify(fullRecord()));
      }
      return Promise.resolve(null);
    });
    redis.ttl.mockResolvedValue(120);

    const listed = await store.listByUserId('user-1');

    expect(listed).toHaveLength(1);
    expect(listed[0]?.id).toBe('alive');
    expect(listed[0]?.record.userId).toBe('user-1');
    expect(listed[0]?.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(redis.srem).toHaveBeenCalledWith('sessions:user:user-1', 'stale');
  });

  it('delete removes the session key and SREM from the user index', async () => {
    redis.get.mockResolvedValue(JSON.stringify(fullRecord()));

    await store.delete('sid-1');

    expect(redis.del).toHaveBeenCalledWith('sessions:sid-1');
    expect(redis.srem).toHaveBeenCalledWith('sessions:user:user-1', 'sid-1');
  });

  it('does not use KEYS or unbounded SCAN for listByUserId', async () => {
    redis.smembers.mockResolvedValue([]);

    await store.listByUserId('user-1');

    expect(redis.smembers).toHaveBeenCalledWith('sessions:user:user-1');
    expect(Object.keys(redis)).not.toContain('scan');
  });
});
