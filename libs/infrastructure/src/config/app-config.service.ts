import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { OutboxProcessorOptions } from '@contracts/outbox/outbox-processor.options';
import type { JobExecutionOptions } from '@contracts/idempotency/job-execution.options';

type ConfigShape = {
  app: { env: string; port: number; allowedOrigins: string };
  database: { url: string };
  redis: { host: string; port: number; password?: string; db: number; connectTimeoutMs: number };
  bullmq: { defaultAttempts: number; backoffDelay: number };
  mail: {
    driver: 'smtp' | 'null';
    smtp: { host: string; port: number; user: string; password: string; from: string };
  };
  storage: {
    driver: 'local' | 's3';
    localPath: string;
    s3: {
      endpoint?: string;
      region: string;
      bucket?: string;
      accessKeyId?: string;
      secretAccessKey?: string;
    };
  };
  auth: {
    driver: 'jwt' | 'session';
    sessionTtlSeconds: number;
    passwordSaltRounds: number;

    sessionCookieName: string;
    sessionCookiePath: string;
    sessionCookieDomain?: string;
    sessionCookieSameSite: 'lax' | 'strict' | 'none';
  };
  jwt: { secret: string; expiresIn: string; refreshSecret: string; refreshExpiresIn: string };
  rateLimit: { ttl: number; max: number; authTtl: number; authMax: number };
  logger: { level: string };
  outbox: OutboxProcessorOptions;
  jobExecution: JobExecutionOptions;
};

@Injectable()
export class AppConfigService {
  constructor(private readonly config: ConfigService<ConfigShape, true>) {}
  app(): ConfigShape['app'] {
    return this.config.get('app', { infer: true });
  }

  database(): ConfigShape['database'] {
    return this.config.get('database', { infer: true });
  }

  redis(): ConfigShape['redis'] {
    return this.config.get('redis', { infer: true });
  }

  jwt(): ConfigShape['jwt'] {
    return this.config.get('jwt', { infer: true });
  }

  auth(): ConfigShape['auth'] {
    return this.config.get('auth', { infer: true });
  }

  rateLimit(): ConfigShape['rateLimit'] {
    return this.config.get('rateLimit', { infer: true });
  }

  logger(): ConfigShape['logger'] {
    return this.config.get('logger', { infer: true });
  }

  bullmq(): ConfigShape['bullmq'] {
    return this.config.get('bullmq', { infer: true });
  }

  mail(): ConfigShape['mail'] {
    return this.config.get('mail', { infer: true });
  }

  storage(): ConfigShape['storage'] {
    return this.config.get('storage', { infer: true });
  }

  outbox(): ConfigShape['outbox'] {
    return this.config.get('outbox', { infer: true });
  }

  jobExecution(): ConfigShape['jobExecution'] {
    return this.config.get('jobExecution', { infer: true });
  }
}
