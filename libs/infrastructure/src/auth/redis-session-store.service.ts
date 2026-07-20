import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';
import {
  ISessionStore,
  type SessionListEntry,
} from '@contracts/auth/session-store.service';
import type { SessionRecord } from '@contracts/auth/session-record';

const LEGACY_CREATED_AT_FALLBACK = '1970-01-01T00:00:00.000Z';

@Injectable()
export class RedisSessionStore implements ISessionStore {
  constructor(private readonly redisService: RedisService) {}

  async create(record: SessionRecord, ttlSeconds: number): Promise<string> {
    const sessionId = randomUUID();
    const sessionKey = this.sessionKey(sessionId);
    const userIndexKey = this.userIndexKey(record.userId);

    await this.redisService.set(sessionKey, JSON.stringify(record), ttlSeconds);
    await this.redisService.sadd(userIndexKey, sessionId);
    await this.redisService.expire(userIndexKey, ttlSeconds);

    return sessionId;
  }

  async get(sessionId: string): Promise<SessionRecord | null> {
    const raw = await this.redisService.get(this.sessionKey(sessionId));

    if (!raw) {
      return null;
    }

    try {
      return this.normalizeRecord(JSON.parse(raw) as unknown);
    } catch {
      return null;
    }
  }

  async delete(sessionId: string): Promise<void> {
    const record = await this.get(sessionId);
    await this.redisService.del(this.sessionKey(sessionId));

    if (record) {
      await this.redisService.srem(this.userIndexKey(record.userId), sessionId);
    }
  }

  async listByUserId(userId: string): Promise<SessionListEntry[]> {
    const userIndexKey = this.userIndexKey(userId);
    const members = await this.redisService.smembers(userIndexKey);
    const entries: SessionListEntry[] = [];

    for (const sessionId of members) {
      const record = await this.get(sessionId);

      if (!record) {
        await this.redisService.srem(userIndexKey, sessionId);
        continue;
      }

      const ttlSeconds = await this.redisService.ttl(this.sessionKey(sessionId));
      const expiresAt =
        ttlSeconds > 0
          ? new Date(Date.now() + ttlSeconds * 1000)
          : new Date(Date.now());

      entries.push({ id: sessionId, record, expiresAt });
    }

    return entries;
  }

  private sessionKey(sessionId: string): string {
    return `sessions:${sessionId}`;
  }

  private userIndexKey(userId: string): string {
    return `sessions:user:${userId}`;
  }

  /**
   * Dual-read: legacy `{ userId, authVersion }` records get null metadata and
   * a stable timestamp fallback so list/revoke do not crash.
   */
  private normalizeRecord(raw: unknown): SessionRecord | null {
    if (!raw || typeof raw !== 'object') {
      return null;
    }

    const value = raw as Record<string, unknown>;

    if (typeof value.userId !== 'string' || typeof value.authVersion !== 'number') {
      return null;
    }

    const createdAt =
      typeof value.createdAt === 'string' && value.createdAt.length > 0
        ? value.createdAt
        : LEGACY_CREATED_AT_FALLBACK;
    const lastActivityAt =
      typeof value.lastActivityAt === 'string' && value.lastActivityAt.length > 0
        ? value.lastActivityAt
        : createdAt;

    return {
      userId: value.userId,
      authVersion: value.authVersion,
      createdAt,
      lastActivityAt,
      ip: typeof value.ip === 'string' ? value.ip : null,
      userAgent: typeof value.userAgent === 'string' ? value.userAgent : null,
    };
  }
}
