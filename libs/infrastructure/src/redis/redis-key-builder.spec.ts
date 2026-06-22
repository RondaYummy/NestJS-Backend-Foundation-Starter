/// <reference types="jest" />

import { RedisKeyBuilder } from './redis-key-builder';

describe('RedisKeyBuilder', () => {
  it('normalizes prefix with trailing colon', () => {
    expect(RedisKeyBuilder.normalizePrefix('app')).toBe('app:');
    expect(RedisKeyBuilder.normalizePrefix('app:')).toBe('app:');
    expect(RedisKeyBuilder.normalizePrefix(' tenant-a ')).toBe('tenant-a:');
  });

  it('allows empty prefix for single-tenant local dev', () => {
    const builder = new RedisKeyBuilder('');

    expect(builder.getPrefix()).toBe('');
    expect(builder.toPhysicalKey('lock:outbox-cron')).toBe('lock:outbox-cron');
  });

  it('builds physical keys from segments', () => {
    const builder = new RedisKeyBuilder('app');

    expect(builder.buildKey('lock', 'outbox-cron')).toBe('app:lock:outbox-cron');
    expect(builder.buildKey('auth', 'refresh-token', 'token-1')).toBe(
      'app:auth:refresh-token:token-1',
    );
  });

  it('builds scan patterns preserving wildcards', () => {
    const builder = new RedisKeyBuilder('app');

    expect(builder.buildPattern('user', '*')).toBe('app:user:*');
    expect(builder.toPhysicalPattern('cache:p2-03:*')).toBe('app:cache:p2-03:*');
  });

  it('strips prefix when converting physical keys back to logical keys', () => {
    const builder = new RedisKeyBuilder('app');

    expect(builder.toLogicalKey('app:user:1')).toBe('user:1');
    expect(builder.toLogicalKey('user:1')).toBe('user:1');
  });

  describe('adapter segment conventions', () => {
    const builder = new RedisKeyBuilder('app');

    it.each([
      ['cache', 'users:1', 'app:users:1'],
      ['lock', 'lock:outbox-cron', 'app:lock:outbox-cron'],
      ['auth refresh token', 'auth:refresh-token:jti-1', 'app:auth:refresh-token:jti-1'],
      ['auth refresh family', 'auth:refresh-family:family-1', 'app:auth:refresh-family:family-1'],
      ['auth revoked access', 'auth:revoked-access-token:jti-1', 'app:auth:revoked-access-token:jti-1'],
      ['session', 'sessions:session-1', 'app:sessions:session-1'],
      ['idempotency lock', 'idem:api:req-1:lock', 'app:idem:api:req-1:lock'],
      ['idempotency result', 'idem:api:req-1:result', 'app:idem:api:req-1:result'],
      ['job execution', 'job-execution:welcome:user-1', 'app:job-execution:welcome:user-1'],
      ['rate limit', 'auth:login:127.0.0.1', 'app:auth:login:127.0.0.1'],
    ])('%s logical key %s becomes %s', (_label, logicalKey, physicalKey) => {
      expect(builder.toPhysicalKey(logicalKey)).toBe(physicalKey);
    });
  });
});
