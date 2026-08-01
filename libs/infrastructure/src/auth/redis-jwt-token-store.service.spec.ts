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

  it('revokeRefreshTokenFamily uses a single atomic eval (P1-04 AC-01)', async () => {
    await store.revokeRefreshTokenFamily('family-1');

    expect(redis.eval).toHaveBeenCalledTimes(1);
    expect(redis.get).not.toHaveBeenCalled();
    expect(redis.del).not.toHaveBeenCalled();
    expect(redis.srem).not.toHaveBeenCalled();

    const { script, keys, argv } = lastEval();

    expect(keys).toEqual(['auth:refresh-family:family-1']);
    expect(argv).toEqual(['family-1']);
    expect(script).toContain('redis.call("GET", KEYS[1])');
    expect(script).toContain('auth:refresh-token:');
    expect(script).toContain('pcall(cjson.decode, rawRecord)');
    expect(script).toContain('auth:refresh-families:user:');
    expect(script).toContain('"SREM"');
    expect(script).toContain('redis.call("DEL", KEYS[1])');
  });

  it('revokeRefreshTokenFamily script derives physical keys from KEYS[1] prefix (P1-04 AC-05)', async () => {
    await store.revokeRefreshTokenFamily('family-1');

    const { script } = lastEval();

    expect(script).toContain('local familyMarker = "auth:refresh-family:"');
    expect(script).toContain('string.find(KEYS[1], familyMarker, 1, true)');
    expect(script).toContain('local prefix = string.sub(KEYS[1], 1, markerStart - 1)');
    expect(script).toContain('local tokenKey = prefix .. "auth:refresh-token:" .. currentTokenId');
    expect(script).toContain('prefix .. "auth:refresh-families:user:" .. userId');
  });

  it('revokeRefreshTokenFamily script still deletes token + family when record is corrupt (P1-04 AC-06)', async () => {
    await store.revokeRefreshTokenFamily('family-1');

    const { script } = lastEval();

    // Best-effort SREM is gated by successful decode + non-empty userId.
    expect(script).toContain('if ok and type(record) == "table" then');
    expect(script).toContain('if type(userId) == "string" and userId ~= "" then');
    // Token + family deletes are unconditional once a cursor exists / always.
    expect(script).toContain('redis.call("DEL", tokenKey)');
    expect(script).toMatch(/redis\.call\("DEL", KEYS\[1\]\)[\s\S]*return 1/);
  });

  it('revokeRefreshTokenFamily is a single eval closing the orphan-token race with rotate (P1-04 AC-03)', async () => {
    await store.rotateRefreshToken({
      currentTokenId: 'token-1',
      nextTokenId: 'token-2',
      familyId: 'family-1',
      nextRecord: { userId: 'user-1', familyId: 'family-1' },
      ttlSeconds: 604800,
    });
    const rotateScript = lastEval().script;

    await store.revokeRefreshTokenFamily('family-1');

    expect(redis.eval).toHaveBeenCalledTimes(2);
    expect(redis.get).not.toHaveBeenCalled();
    expect(redis.del).not.toHaveBeenCalled();
    expect(redis.srem).not.toHaveBeenCalled();

    const revoke = lastEval();

    // Rotate remains its own multi-key atomic eval (unchanged contract).
    expect(rotateScript).toContain('redis.call("GET", KEYS[1])');
    expect(rotateScript).toContain('redis.call("GET", KEYS[3])');
    expect(rotateScript).toContain('redis.call("SADD", KEYS[4], ARGV[5])');

    // Revoke is one eval that GETs the cursor then DELs token + family inside the script.
    expect(revoke.keys).toEqual(['auth:refresh-family:family-1']);
    expect(revoke.argv).toEqual(['family-1']);
    expect(revoke.script).toContain('local currentTokenId = redis.call("GET", KEYS[1])');
    expect(revoke.script).toContain('redis.call("DEL", tokenKey)');
    expect(revoke.script).toContain('redis.call("DEL", KEYS[1])');
  });

  it('revokeAllRefreshTokenFamilies revokes every indexed family via eval and clears the index (P1-02 AC-02)', async () => {
    redis.smembers.mockResolvedValue(['family-1', 'family-2']);

    await store.revokeAllRefreshTokenFamilies('user-1');

    expect(redis.smembers).toHaveBeenCalledWith('auth:refresh-families:user:user-1');
    expect(redis.eval).toHaveBeenCalledTimes(2);
    expect(redis.get).not.toHaveBeenCalled();
    expect(redis.srem).not.toHaveBeenCalled();

    const firstRevoke = redis.eval.mock.calls[0] as EvalArgs;
    const secondRevoke = redis.eval.mock.calls[1] as EvalArgs;

    expect(firstRevoke[1]).toBe(1);
    expect(firstRevoke[2]).toBe('auth:refresh-family:family-1');
    expect(firstRevoke[3]).toBe('family-1');
    expect(secondRevoke[2]).toBe('auth:refresh-family:family-2');
    expect(secondRevoke[3]).toBe('family-2');
    expect(redis.del).toHaveBeenCalledTimes(1);
    expect(redis.del).toHaveBeenCalledWith('auth:refresh-families:user:user-1');
  });

  it('revokeAllRefreshTokenFamilies clears the index even when the user has no indexed families', async () => {
    await store.revokeAllRefreshTokenFamilies('user-1');

    expect(redis.eval).not.toHaveBeenCalled();
    expect(redis.del).toHaveBeenCalledTimes(1);
    expect(redis.del).toHaveBeenCalledWith('auth:refresh-families:user:user-1');
  });
});
