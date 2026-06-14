import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

type ConfigShape = {
  app: { env: string; port: number; allowedOrigins: string };
  database: { url: string };
  redis: { host: string; port: number; password?: string; db: number };
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
};

type DotPrefix<T extends string, U extends string> = `${T}.${U}`;
type Leaves<T> = T extends object
  ? { [K in keyof T & string]: T[K] extends object ? DotPrefix<K, Leaves<T[K]>> : K }[keyof T &
      string]
  : never;

@Injectable()
export class AppConfigService {
  constructor(private readonly config: ConfigService<ConfigShape, true>) {}
  app(): ConfigShape['app'] {
    return this.config.get('app', { infer: true }) as ConfigShape['app'];
  }

  database(): ConfigShape['database'] {
    return this.config.get('database', { infer: true }) as ConfigShape['database'];
  }

  redis(): ConfigShape['redis'] {
    return this.config.get('redis', { infer: true }) as ConfigShape['redis'];
  }

  jwt(): ConfigShape['jwt'] {
    return this.config.get('jwt', { infer: true }) as ConfigShape['jwt'];
  }

  auth(): ConfigShape['auth'] {
    return this.config.get('auth', { infer: true }) as ConfigShape['auth'];
  }

  rateLimit(): ConfigShape['rateLimit'] {
    return this.config.get('rateLimit', { infer: true }) as ConfigShape['rateLimit'];
  }

  logger(): ConfigShape['logger'] {
    return this.config.get('logger', { infer: true }) as ConfigShape['logger'];
  }

  bullmq(): ConfigShape['bullmq'] {
    return this.config.get('bullmq', { infer: true });
  }

  mail(): ConfigShape['mail'] {
    return this.config.get('mail', { infer: true });
  }

  storage(): ConfigShape['storage'] {
    return this.config.get('storage', { infer: true }) as ConfigShape['storage'];
  }
}
