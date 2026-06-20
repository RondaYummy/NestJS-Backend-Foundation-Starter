export type RedisModuleOptions = {
  host: string;
  port: number;
  password?: string;
  db: number;
  connectTimeoutMs: number;
};

export const REDIS_MODULE_OPTIONS = Symbol('REDIS_MODULE_OPTIONS');
