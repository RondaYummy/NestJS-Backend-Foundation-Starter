/// <reference types="jest" />

import type { RedisService } from '../redis/redis.service';
import { RedisGoogleOAuthStateStore } from './redis-google-oauth-state.store';

describe('RedisGoogleOAuthStateStore', () => {
  let redisService: jest.Mocked<Pick<RedisService, 'get' | 'set' | 'compareAndDelete'>>;
  let store: RedisGoogleOAuthStateStore;

  beforeEach(() => {
    redisService = {
      get: jest.fn(),
      set: jest.fn().mockResolvedValue(undefined),
      compareAndDelete: jest.fn(),
    };
    store = new RedisGoogleOAuthStateStore(redisService as unknown as RedisService);
  });

  it('saves the state payload under a namespaced key with the requested TTL', async () => {
    await store.save('state-abc', { returnUrl: 'http://localhost:3000/done' }, 600);

    expect(redisService.set).toHaveBeenCalledWith(
      'google-sso:state:state-abc',
      JSON.stringify({ returnUrl: 'http://localhost:3000/done' }),
      600,
    );
  });

  it('consumes a valid state exactly once and returns its payload (AC-06)', async () => {
    const serialized = JSON.stringify({ returnUrl: 'http://localhost:3000/done' });
    redisService.get.mockResolvedValue(serialized);
    redisService.compareAndDelete.mockResolvedValue(true);

    const payload = await store.consume('state-abc');

    expect(payload).toEqual({ returnUrl: 'http://localhost:3000/done' });
    expect(redisService.compareAndDelete).toHaveBeenCalledWith(
      'google-sso:state:state-abc',
      serialized,
    );
  });

  it('returns null for an unknown or expired state (AC-06)', async () => {
    redisService.get.mockResolvedValue(null);

    await expect(store.consume('missing-state')).resolves.toBeNull();
    expect(redisService.compareAndDelete).not.toHaveBeenCalled();
  });

  it('returns null when a concurrent callback already consumed the state (AC-06)', async () => {
    redisService.get.mockResolvedValue('{}');
    redisService.compareAndDelete.mockResolvedValue(false);

    await expect(store.consume('state-abc')).resolves.toBeNull();
  });
});
