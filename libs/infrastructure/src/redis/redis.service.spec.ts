/// <reference types="jest" />

import type Redis from 'ioredis';

import { RedisKeyBuilder } from './redis-key-builder';
import { RedisService } from './redis.service';

describe('RedisService', () => {
  let redis: jest.Mocked<Pick<Redis, 'get' | 'set' | 'del' | 'scan' | 'unlink' | 'eval' | 'exists' | 'incr' | 'expire'>>;
  let service: RedisService;

  beforeEach(() => {
    redis = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue('OK'),
      del: jest.fn().mockResolvedValue(1),
      scan: jest.fn().mockResolvedValue(['0', []]),
      unlink: jest.fn().mockResolvedValue(1),
      eval: jest.fn().mockResolvedValue(1),
      exists: jest.fn().mockResolvedValue(0),
      incr: jest.fn().mockResolvedValue(1),
      expire: jest.fn().mockResolvedValue(1),
    };

    service = new RedisService(redis as unknown as Redis, new RedisKeyBuilder('app'));
  });

  it('prefixes get/set/del operations once', async () => {
    await service.set('users:1', 'value', 60);
    await service.get('users:1');
    await service.del('users:1');

    expect(redis.set).toHaveBeenCalledWith('app:users:1', 'value', 'EX', 60);
    expect(redis.get).toHaveBeenCalledWith('app:users:1');
    expect(redis.del).toHaveBeenCalledWith('app:users:1');
  });

  it('prefixes eval KEYS arguments only', async () => {
    await service.eval('return 1', 2, 'idem:scope:key:lock', 'idem:scope:key:result', 'token', 30);

    expect(redis.eval).toHaveBeenCalledWith(
      'return 1',
      2,
      'app:idem:scope:key:lock',
      'app:idem:scope:key:result',
      'token',
      30,
    );
  });

  it('prefixes scan match and returns logical keys', async () => {
    redis.scan.mockResolvedValueOnce(['0', ['app:user:1', 'app:user:2']]);

    const batches: string[][] = [];

    for await (const batch of service.scanKeys('user:*')) {
      batches.push(batch);
    }

    expect(redis.scan).toHaveBeenCalledWith('0', 'MATCH', 'app:user:*', 'COUNT', 100);
    expect(batches).toEqual([['user:1', 'user:2']]);
  });

  it('prefixes unlink keys', async () => {
    await service.unlink('user:1', 'user:2');

    expect(redis.unlink).toHaveBeenCalledWith('app:user:1', 'app:user:2');
  });

  it('uses PX NX for millisecond lock acquisition', async () => {
    redis.set.mockResolvedValue('OK');

    const acquired = await service.setPxIfNotExists('lock:outbox-cron', 'token', 30_000);

    expect(acquired).toBe(true);
    expect(redis.set).toHaveBeenCalledWith(
      'app:lock:outbox-cron',
      'token',
      'PX',
      30_000,
      'NX',
    );
  });
});
