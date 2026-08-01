import { Injectable } from '@nestjs/common';

import type {
  IJwtTokenStore,
  RefreshTokenRecord,
  RotateRefreshTokenInput,
  SaveRefreshTokenInput,
} from '@contracts/auth/jwt-token-store.service';

import { RedisService } from '../redis/redis.service';

/**
 * Keeps the per-user family index alive at least as long as any indexed
 * family: a shorter new TTL must never shorten the remaining index TTL.
 * Redis TTL -1 (no expiry) / -2 (missing) are negative and therefore fall
 * back to the finite new TTL (same rule as the session user index, P1-01).
 */
function buildIndexTtlRefreshScript(indexKeyRef: string, ttlArgvRef: string): string {
  return `
      local currentIndexTtl = redis.call("TTL", ${indexKeyRef})
      local indexTtl = tonumber(${ttlArgvRef})

      if currentIndexTtl > indexTtl then
        indexTtl = currentIndexTtl
      end

      redis.call("EXPIRE", ${indexKeyRef}, indexTtl)
  `;
}

@Injectable()
export class RedisJwtTokenStore implements IJwtTokenStore {
  constructor(private readonly redis: RedisService) {}

  async saveRefreshToken(input: SaveRefreshTokenInput): Promise<void> {
    const tokenKey = this.getRefreshTokenKey(input.tokenId);

    const familyKey = this.getRefreshFamilyKey(input.familyId);

    const userFamilyIndexKey = this.getUserFamilyIndexKey(input.record.userId);

    const script = `
      redis.call(
        "SET",
        KEYS[1],
        ARGV[1],
        "EX",
        ARGV[2]
      )

      redis.call(
        "SET",
        KEYS[2],
        ARGV[3],
        "EX",
        ARGV[2]
      )

      redis.call("SADD", KEYS[3], ARGV[4])

      ${buildIndexTtlRefreshScript('KEYS[3]', 'ARGV[2]')}

      return 1
    `;

    await this.redis.eval(
      script,
      3,
      tokenKey,
      familyKey,
      userFamilyIndexKey,

      // ARGV[1]
      JSON.stringify(input.record),

      // ARGV[2]
      input.ttlSeconds,

      // ARGV[3]
      input.tokenId,

      // ARGV[4]
      input.familyId,
    );
  }

  async rotateRefreshToken(input: RotateRefreshTokenInput): Promise<boolean> {
    const currentTokenKey = this.getRefreshTokenKey(input.currentTokenId);

    const nextTokenKey = this.getRefreshTokenKey(input.nextTokenId);

    const familyKey = this.getRefreshFamilyKey(input.familyId);

    const userFamilyIndexKey = this.getUserFamilyIndexKey(input.nextRecord.userId);

    const script = `
      local currentToken =
        redis.call("GET", KEYS[1])

      if not currentToken then
        return 0
      end

      local activeFamilyTokenId =
        redis.call("GET", KEYS[3])

      if not activeFamilyTokenId then
        return 0
      end

      if activeFamilyTokenId ~= ARGV[1] then
        return 0
      end

      redis.call("DEL", KEYS[1])

      redis.call(
        "SET",
        KEYS[2],
        ARGV[2],
        "EX",
        ARGV[3]
      )

      redis.call(
        "SET",
        KEYS[3],
        ARGV[4],
        "EX",
        ARGV[3]
      )

      redis.call("SADD", KEYS[4], ARGV[5])

      ${buildIndexTtlRefreshScript('KEYS[4]', 'ARGV[3]')}

      return 1
    `;

    const result = await this.redis.eval(
      script,
      4,
      currentTokenKey,
      nextTokenKey,
      familyKey,
      userFamilyIndexKey,

      // ARGV[1]
      input.currentTokenId,

      // ARGV[2]
      JSON.stringify(input.nextRecord),

      // ARGV[3]
      input.ttlSeconds,

      // ARGV[4]
      input.nextTokenId,

      // ARGV[5]
      input.familyId,
    );

    return Number(result) === 1;
  }

  async revokeRefreshTokenFamily(familyId: string): Promise<void> {
    const familyKey = this.getRefreshFamilyKey(familyId);
    const currentTokenId = await this.redis.get(familyKey);

    if (currentTokenId) {
      const tokenKey = this.getRefreshTokenKey(currentTokenId);
      const rawRecord = await this.redis.get(tokenKey);

      await this.redis.del(tokenKey);

      const userId = this.readUserId(rawRecord);

      if (userId) {
        await this.redis.srem(this.getUserFamilyIndexKey(userId), familyId);
      }
    }

    await this.redis.del(familyKey);
  }

  async revokeAllRefreshTokenFamilies(userId: string): Promise<void> {
    const userFamilyIndexKey = this.getUserFamilyIndexKey(userId);
    const familyIds = await this.redis.smembers(userFamilyIndexKey);

    for (const familyId of familyIds) {
      await this.revokeRefreshTokenFamily(familyId);
    }

    await this.redis.del(userFamilyIndexKey);
  }

  async revokeAccessToken(tokenId: string, ttlSeconds: number): Promise<void> {
    if (ttlSeconds <= 0) {
      return;
    }

    await this.redis.set(this.getRevokedAccessTokenKey(tokenId), '1', ttlSeconds);
  }

  async isAccessTokenRevoked(tokenId: string): Promise<boolean> {
    return this.redis.exists(this.getRevokedAccessTokenKey(tokenId));
  }

  private getRefreshTokenPrefix(): string {
    return 'auth:refresh-token:';
  }

  private getRefreshTokenKey(tokenId: string): string {
    return `${this.getRefreshTokenPrefix()}${tokenId}`;
  }

  private getRefreshFamilyKey(familyId: string): string {
    return `auth:refresh-family:${familyId}`;
  }

  private getUserFamilyIndexKey(userId: string): string {
    return `auth:refresh-families:user:${userId}`;
  }

  private getRevokedAccessTokenKey(tokenId: string): string {
    return `auth:revoked-access-token:${tokenId}`;
  }

  private readUserId(rawRecord: string | null): string | null {
    if (!rawRecord) {
      return null;
    }

    try {
      const parsed = JSON.parse(rawRecord) as Partial<RefreshTokenRecord>;

      return typeof parsed.userId === 'string' && parsed.userId.length > 0 ? parsed.userId : null;
    } catch {
      return null;
    }
  }
}
