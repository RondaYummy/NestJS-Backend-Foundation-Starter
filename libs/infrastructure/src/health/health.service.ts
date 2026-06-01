import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type Redis from 'ioredis';
import { DRIZZLE_DB } from '../database/drizzle/drizzle.tokens';
import { REDIS_CLIENT } from '../redis/redis.tokens';

@Injectable()
export class HealthService {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: { execute: (query: unknown) => Promise<unknown> },
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}
  async check(): Promise<{ status: string; services: Record<string, string> }> {
    const services: Record<string, string> = { postgres: 'ok', redis: 'ok', bullmq: 'ok' };
    try {
      await this.db.execute(sql`select 1`);
    } catch {
      services.postgres = 'error';
    }
    try {
      await this.redis.ping();
    } catch {
      services.redis = 'error';
      services.bullmq = 'error';
    }
    return { status: Object.values(services).every((v) => v === 'ok') ? 'ok' : 'error', services };
  }
}
