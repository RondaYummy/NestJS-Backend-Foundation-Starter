import { Injectable } from '@nestjs/common';

import type { IPasswordResetTokenStore } from '@contracts/auth/password-reset-token-store';

import { RedisService } from '../redis/redis.service';

const tokenKey = (tokenHash: string): string => `password-reset:token:${tokenHash}`;
const userKey = (userId: string): string => `password-reset:user:${userId}`;

/**
 * Redis-backed password-reset token store. Persists only token hashes with a
 * TTL; single-use is enforced with an atomic compare-and-delete on consume.
 */
@Injectable()
export class RedisPasswordResetTokenStore implements IPasswordResetTokenStore {
  constructor(private readonly redisService: RedisService) {}

  async save(userId: string, tokenHash: string, ttlSeconds: number): Promise<void> {
    const previousTokenHash = await this.redisService.get(userKey(userId));

    if (previousTokenHash) {
      await this.redisService.del(tokenKey(previousTokenHash));
    }

    await this.redisService.set(tokenKey(tokenHash), userId, ttlSeconds);
    await this.redisService.set(userKey(userId), tokenHash, ttlSeconds);
  }

  async consume(tokenHash: string): Promise<string | null> {
    const key = tokenKey(tokenHash);
    const userId = await this.redisService.get(key);

    if (!userId) {
      return null;
    }

    // Only one concurrent consumer wins the atomic compare-and-delete.
    const consumed = await this.redisService.compareAndDelete(key, userId);

    if (!consumed) {
      return null;
    }

    await this.redisService.compareAndDelete(userKey(userId), tokenHash);

    return userId;
  }
}
