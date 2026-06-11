import { Inject, Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { sql } from 'drizzle-orm';
import type Redis from 'ioredis';

import { QUEUES } from '@contracts/queues/queue-names';

import { DRIZZLE_DB } from '../database/drizzle/drizzle.tokens';
import { REDIS_CLIENT } from '../redis/redis.tokens';

type DependencyStatus = 'ok' | 'error';

type HealthResult = {
  status: DependencyStatus;
  services: {
    postgres: DependencyStatus;
    redis: DependencyStatus;
    bullmq: DependencyStatus;
  };
};

@Injectable()
export class HealthService {
  constructor(
    @Inject(DRIZZLE_DB)
    private readonly db: {
      execute: (query: unknown) => Promise<unknown>;
    },

    @Inject(REDIS_CLIENT)
    private readonly redis: Redis,

    @InjectQueue(QUEUES.DEFAULT)
    private readonly defaultQueue: Queue,
  ) {}

  async check(): Promise<HealthResult> {
    const services: HealthResult['services'] = {
      postgres: 'ok',
      redis: 'ok',
      bullmq: 'ok',
    };

    await Promise.all([
      this.checkPostgres(services),
      this.checkRedis(services),
      this.checkBullMq(services),
    ]);

    return {
      status: Object.values(services).every((status) => status === 'ok') ? 'ok' : 'error',
      services,
    };
  }

  private async checkPostgres(services: HealthResult['services']): Promise<void> {
    try {
      await this.db.execute(sql`select 1`);
    } catch {
      services.postgres = 'error';
    }
  }

  private async checkRedis(services: HealthResult['services']): Promise<void> {
    try {
      await this.redis.ping();
    } catch {
      services.redis = 'error';
    }
  }

  private async checkBullMq(services: HealthResult['services']): Promise<void> {
    try {
      await this.defaultQueue.getJobCounts('waiting', 'active', 'delayed', 'failed');
    } catch {
      services.bullmq = 'error';
    }
  }
}
