import type { Queue } from 'bullmq';
import { sql } from 'drizzle-orm';
import type Redis from 'ioredis';

import type { HealthModuleOptions } from './health.module-options';
import { withHealthCheckTimeout } from './with-health-check-timeout';

type DependencyStatus = 'ok' | 'error';

type HealthResult = {
  status: DependencyStatus;
  services: {
    postgres: DependencyStatus;
    redis: DependencyStatus;
    bullmq: DependencyStatus;
  };
};

export class HealthService {
  constructor(
    private readonly db: {
      execute: (query: unknown) => Promise<unknown>;
    },
    private readonly redis: Redis,
    private readonly outboxQueue: Queue,
    private readonly options: HealthModuleOptions,
  ) {}

  async check(): Promise<HealthResult> {
    const services: HealthResult['services'] = {
      postgres: 'ok',
      redis: 'ok',
      bullmq: 'ok',
    };

    await Promise.allSettled([
      this.runCheck(this.db.execute(sql`select 1`), services, 'postgres'),
      this.runCheck(this.redis.ping(), services, 'redis'),
      this.runCheck(
        this.outboxQueue.getJobCounts('waiting', 'active', 'delayed', 'failed'),
        services,
        'bullmq',
      ),
    ]);

    return {
      status: Object.values(services).every((status) => status === 'ok') ? 'ok' : 'error',
      services,
    };
  }

  private async runCheck(
    operation: Promise<unknown>,
    services: HealthResult['services'],
    key: keyof HealthResult['services'],
  ): Promise<void> {
    try {
      await withHealthCheckTimeout(operation, this.options.checkTimeoutMs);
    } catch {
      services[key] = 'error';
    }
  }
}
