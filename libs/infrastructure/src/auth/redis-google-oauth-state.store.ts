import { Injectable } from '@nestjs/common';

import type {
  GoogleOAuthStatePayload,
  IGoogleOAuthStateStore,
} from '@contracts/auth/google-oauth-state.store';

import { RedisService } from '../redis/redis.service';

const stateKey = (state: string): string => `google-sso:state:${state}`;

/**
 * Redis-backed one-time OAuth `state` store for the Google SSO redirect flow.
 * Consume is atomic (compare-and-delete) so a state value can never be
 * replayed by concurrent callbacks.
 */
@Injectable()
export class RedisGoogleOAuthStateStore implements IGoogleOAuthStateStore {
  constructor(private readonly redisService: RedisService) {}

  async save(state: string, payload: GoogleOAuthStatePayload, ttlSeconds: number): Promise<void> {
    await this.redisService.set(stateKey(state), JSON.stringify(payload), ttlSeconds);
  }

  async consume(state: string): Promise<GoogleOAuthStatePayload | null> {
    const key = stateKey(state);
    const serialized = await this.redisService.get(key);

    if (serialized === null) {
      return null;
    }

    // Only one concurrent consumer wins the atomic compare-and-delete.
    const consumed = await this.redisService.compareAndDelete(key, serialized);

    if (!consumed) {
      return null;
    }

    try {
      return JSON.parse(serialized) as GoogleOAuthStatePayload;
    } catch {
      return null;
    }
  }
}
