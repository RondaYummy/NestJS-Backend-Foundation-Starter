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
    accessTokenTtl: string;
    refreshTokenTtl: string;
    sessionTtlSeconds: number;
    passwordSaltRounds: number;
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
  constructor(private readonly config: ConfigService) {}
  get<K extends Leaves<ConfigShape>>(key: K): unknown {
    return this.config.get(key, { infer: true });
  }
  getString(key: Leaves<ConfigShape>): string {
    return String(this.get(key) ?? '');
  }
  getNumber(key: Leaves<ConfigShape>): number {
    return Number(this.get(key));
  }
}
