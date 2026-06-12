import { Injectable } from '@nestjs/common';

import type {
  IJwtTokenStore,
  RotateRefreshTokenInput,
  SaveRefreshTokenInput,
} from './jwt-token-store.service';

import { RedisService } from '../redis/redis.service';

@Injectable()
export class RedisJwtTokenStore implements IJwtTokenStore {
  constructor(private readonly redis: RedisService) {}

  async saveRefreshToken(input: SaveRefreshTokenInput): Promise<void> {
    const tokenKey = this.getRefreshTokenKey(input.tokenId);

    const familyKey = this.getRefreshFamilyKey(input.familyId);

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

      return 1
    `;

    await this.redis.eval(
      script,
      2,
      tokenKey,
      familyKey,
      JSON.stringify(input.record),
      input.ttlSeconds,
      input.tokenId,
    );
  }

  async rotateRefreshToken(input: RotateRefreshTokenInput): Promise<boolean> {
    const currentTokenKey = this.getRefreshTokenKey(input.currentTokenId);

    const nextTokenKey = this.getRefreshTokenKey(input.nextTokenId);

    const familyKey = this.getRefreshFamilyKey(input.familyId);

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

      return 1
    `;

    const result = await this.redis.eval(
      script,
      3,
      currentTokenKey,
      nextTokenKey,
      familyKey,

      // ARGV[1]
      input.currentTokenId,

      // ARGV[2]
      JSON.stringify(input.nextRecord),

      // ARGV[3]
      input.ttlSeconds,

      // ARGV[4]
      input.nextTokenId,
    );

    return Number(result) === 1;
  }

  async revokeRefreshTokenFamily(familyId: string): Promise<void> {
    const familyKey = this.getRefreshFamilyKey(familyId);

    const refreshTokenPrefix = this.getRefreshTokenPrefix();

    const script = `
      local currentTokenId =
        redis.call("GET", KEYS[1])

      if currentTokenId then
        redis.call(
          "DEL",
          ARGV[1] .. currentTokenId
        )
      end

      redis.call("DEL", KEYS[1])

      return 1
    `;

    await this.redis.eval(script, 1, familyKey, refreshTokenPrefix);
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

  private getRevokedAccessTokenKey(tokenId: string): string {
    return `auth:revoked-access-token:${tokenId}`;
  }
}
