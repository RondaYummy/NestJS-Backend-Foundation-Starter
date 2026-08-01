/// <reference types="jest" />

import type { RedisService } from '../redis/redis.service';
import { RedisJwtTokenStore } from './redis-jwt-token-store.service';

type EvalArgs = [string, number, ...Array<string | number>];

describe('RedisJwtTokenStore', () => {
  let redis: jest.Mocked<
    Pick<RedisService, 'eval' | 'get' | 'set' | 'del' | 'exists' | 'smembers' | 'srem'>
  >;
  let store: RedisJwtTokenStore;

  const lastEval = (): { script: string; keys: string[]; argv: Array<string | number> } => {
    const call = redis.eval.mock.calls.at(-1) as EvalArgs;
    const [script, numberOfKeys, ...args] = call;

    return {
      script,
      keys: args.slice(0, numberOfKeys) as string[],
      argv: args.slice(numberOfKeys),
    };
  };

  beforeEach(() => {
    redis = {
      eval: jest.fn().mockResolvedValue(1),
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
      del: jest.fn().mockResolvedValue(undefined),
      exists: jest.fn().mockResolvedValue(false),
      smembers: jest.fn().mockResolvedValue([]),
      srem: jest.fn().mockResolvedValue(1),
    };
    store = new RedisJwtTokenStore(redis as unknown as RedisService);
  });

  it('saveRefreshToken indexes the family under the per-user SET (P1-02 AC-02)', async () => {
    await store.saveRefreshToken({
      tokenId: 'token-1',
      familyId: 'family-1',
      record: { userId: 'user-1', familyId: 'family-1' },
      ttlSeconds: 604800,
    });

    const { script, keys, argv } = lastEval();

    expect(keys).toEqual([
      'auth:refresh-token:token-1',
      'auth:refresh-family:family-1',
      'auth:refresh-families:user:user-1',
    ]);
    expect(argv).toEqual([
      JSON.stringify({ userId: 'user-1', familyId: 'family-1' }),
      604800,
      'token-1',
      'family-1',
    ]);
    expect(script).toContain('redis.call("SADD", KEYS[3], ARGV[4])');
  });

  it('saveRefreshToken never shortens the user index TTL (P1-02 / P1-01 TTL rule)', async () => {
    await store.saveRefreshToken({
      tokenId: 'token-1',
      familyId: 'family-1',
      record: { userId: 'user-1', familyId: 'family-1' },
      ttlSeconds: 604800,
    });

    const { script } = lastEval();

    expect(script).toContain('local currentIndexTtl = redis.call("TTL", KEYS[3])');
    expect(script).toContain('if currentIndexTtl > indexTtl then');
    expect(script).toContain('redis.call("EXPIRE", KEYS[3], indexTtl)');
  });

  it('rotateRefreshToken keeps the family indexed for the rotating user', async () => {
    await expect(
      store.rotateRefreshToken({
        currentTokenId: 'token-1',
        nextTokenId: 'token-2',
        familyId: 'family-1',
        nextRecord: { userId: 'user-1', familyId: 'family-1' },
        ttlSeconds: 604800,
      }),
    ).resolves.toBe(true);

    const { script, keys, argv } = lastEval();

    expect(keys).toEqual([
      'auth:refresh-token:token-1',
      'auth:refresh-token:token-2',
      'auth:refresh-family:family-1',
      'auth:refresh-families:user:user-1',
    ]);
    expect(argv.at(-1)).toBe('family-1');
    expect(script).toContain('redis.call("SADD", KEYS[4], ARGV[5])');
    expect(script).toContain('redis.call("EXPIRE", KEYS[4], indexTtl)');
  });

  it('rotateRefreshToken reports failure without touching the index when the script rejects', async () => {
    redis.eval.mockResolvedValue(0);

    await expect(
      store.rotateRefreshToken({
        currentTokenId: 'token-1',
        nextTokenId: 'token-2',
        familyId: 'family-1',
        nextRecord: { userId: 'user-1', familyId: 'family-1' },
        ttlSeconds: 604800,
      }),
    ).resolves.toBe(false);
  });

  it('revokeRefreshTokenFamily removes the family from the owner index', async () => {
    redis.get
      .mockResolvedValueOnce('token-1')
      .mockResolvedValueOnce(JSON.stringify({ userId: 'user-1', familyId: 'family-1' }));

    await store.revokeRefreshTokenFamily('family-1');

    expect(redis.del).toHaveBeenCalledWith('auth:refresh-token:token-1');
    expect(redis.srem).toHaveBeenCalledWith('auth:refresh-families:user:user-1', 'family-1');
    expect(redis.del).toHaveBeenCalledWith('auth:refresh-family:family-1');
  });

  it('revokeRefreshTokenFamily still deletes family keys when the record is missing or corrupt', async () => {
    redis.get.mockResolvedValueOnce('token-1').mockResolvedValueOnce('not-json');

    await store.revokeRefreshTokenFamily('family-1');

    expect(redis.srem).not.toHaveBeenCalled();
    expect(redis.del).toHaveBeenCalledWith('auth:refresh-token:token-1');
    expect(redis.del).toHaveBeenCalledWith('auth:refresh-family:family-1');
  });

  it('revokeRefreshTokenFamily deletes only the family key when no active token exists', async () => {
    redis.get.mockResolvedValue(null);

    await store.revokeRefreshTokenFamily('family-1');

    expect(redis.del).toHaveBeenCalledTimes(1);
    expect(redis.del).toHaveBeenCalledWith('auth:refresh-family:family-1');
  });

  it('revokeAllRefreshTokenFamilies revokes every indexed family and clears the index (P1-02 AC-02)', async () => {
    redis.smembers.mockResolvedValue(['family-1', 'family-2']);
    redis.get.mockImplementation((key: string) => {
      if (key === 'auth:refresh-family:family-1') {
        return Promise.resolve('token-1');
      }

      if (key === 'auth:refresh-family:family-2') {
        return Promise.resolve('token-2');
      }

      return Promise.resolve(JSON.stringify({ userId: 'user-1', familyId: 'family-1' }));
    });

    await store.revokeAllRefreshTokenFamilies('user-1');

    expect(redis.smembers).toHaveBeenCalledWith('auth:refresh-families:user:user-1');
    expect(redis.del).toHaveBeenCalledWith('auth:refresh-token:token-1');
    expect(redis.del).toHaveBeenCalledWith('auth:refresh-token:token-2');
    expect(redis.del).toHaveBeenCalledWith('auth:refresh-family:family-1');
    expect(redis.del).toHaveBeenCalledWith('auth:refresh-family:family-2');
    expect(redis.del).toHaveBeenCalledWith('auth:refresh-families:user:user-1');
  });

  it('revokeAllRefreshTokenFamilies clears the index even when the user has no indexed families', async () => {
    await store.revokeAllRefreshTokenFamilies('user-1');

    expect(redis.del).toHaveBeenCalledTimes(1);
    expect(redis.del).toHaveBeenCalledWith('auth:refresh-families:user:user-1');
  });
});
