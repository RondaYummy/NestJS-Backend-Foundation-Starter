/// <reference types="jest" />

import type { RedisService } from '../redis/redis.service';
import { RedisPasswordResetTokenStore } from './redis-password-reset-token-store.service';

describe('RedisPasswordResetTokenStore', () => {
  let redisService: jest.Mocked<Pick<RedisService, 'get' | 'set' | 'del' | 'compareAndDelete'>>;
  let store: RedisPasswordResetTokenStore;

  beforeEach(() => {
    redisService = {
      get: jest.fn(),
      set: jest.fn().mockResolvedValue(undefined),
      del: jest.fn().mockResolvedValue(undefined),
      compareAndDelete: jest.fn(),
    };
    store = new RedisPasswordResetTokenStore(redisService as unknown as RedisService);
  });

  describe('save', () => {
    it('stores only hashed token keys with the requested TTL (AC-09)', async () => {
      redisService.get.mockResolvedValue(null);

      await store.save('user-1', 'token-hash-abc', 1800);

      expect(redisService.set).toHaveBeenCalledWith(
        'password-reset:token:token-hash-abc',
        'user-1',
        1800,
      );
      expect(redisService.set).toHaveBeenCalledWith(
        'password-reset:user:user-1',
        'token-hash-abc',
        1800,
      );
      expect(redisService.del).not.toHaveBeenCalled();
    });

    it('invalidates the previously issued token for the same user', async () => {
      redisService.get.mockResolvedValue('old-token-hash');

      await store.save('user-1', 'new-token-hash', 1800);

      expect(redisService.get).toHaveBeenCalledWith('password-reset:user:user-1');
      expect(redisService.del).toHaveBeenCalledWith('password-reset:token:old-token-hash');
      expect(redisService.set).toHaveBeenCalledWith(
        'password-reset:token:new-token-hash',
        'user-1',
        1800,
      );
    });
  });

  describe('consume', () => {
    it('returns the bound user id and deletes the binding', async () => {
      redisService.get.mockResolvedValue('user-1');
      redisService.compareAndDelete.mockResolvedValue(true);

      const userId = await store.consume('token-hash-abc');

      expect(userId).toBe('user-1');
      expect(redisService.compareAndDelete).toHaveBeenCalledWith(
        'password-reset:token:token-hash-abc',
        'user-1',
      );
      expect(redisService.compareAndDelete).toHaveBeenCalledWith(
        'password-reset:user:user-1',
        'token-hash-abc',
      );
    });

    it('returns null for an unknown or expired token', async () => {
      redisService.get.mockResolvedValue(null);

      await expect(store.consume('missing-hash')).resolves.toBeNull();
      expect(redisService.compareAndDelete).not.toHaveBeenCalled();
    });

    it('returns null when a concurrent consumer already deleted the token (AC-08)', async () => {
      redisService.get.mockResolvedValue('user-1');
      redisService.compareAndDelete.mockResolvedValue(false);

      await expect(store.consume('token-hash-abc')).resolves.toBeNull();
      expect(redisService.compareAndDelete).toHaveBeenCalledTimes(1);
    });
  });
});
