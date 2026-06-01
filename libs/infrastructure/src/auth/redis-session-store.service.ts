import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';
import { ISessionStore } from '@contracts/auth/session-store.service';
import { CurrentUser } from '@contracts/auth/current-user';

@Injectable()
export class RedisSessionStore implements ISessionStore {
  constructor(private readonly redisService: RedisService) {}

  async create(user: CurrentUser, ttlSeconds: number): Promise<string> {
    const sessionId = randomUUID();

    await this.redisService.set(
      `sessions:${sessionId}`,
      JSON.stringify(user),
      ttlSeconds,
    );

    return sessionId;
  }

  async get(sessionId: string): Promise<CurrentUser | null> {
    const raw = await this.redisService.get(`sessions:${sessionId}`);

    if (!raw) {
      return null;
    }

    return JSON.parse(raw) as CurrentUser;
  }

  async delete(sessionId: string): Promise<void> {
    await this.redisService.del(`sessions:${sessionId}`);
  }
}