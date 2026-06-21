import type { AppConfigService } from './app-config.service';
import type { AuthModuleOptions } from '../auth/auth.module-options';
import type { BullMqModuleOptions } from '../bullmq/bullmq.module-options';
import type { DrizzleModuleOptions } from '../database/drizzle/drizzle.module-options';
import type { MailModuleOptions } from '../mail/mail.module-options';
import type { RedisModuleOptions } from '../redis/redis.module-options';
import type { StorageModuleOptions } from '../storage/storage.module-options';
import type { HealthModuleOptions } from '../health/health.module-options';

export function mapAppConfigToRedisOptions(config: AppConfigService): RedisModuleOptions {
  return config.redis();
}

export function mapAppConfigToDrizzleOptions(config: AppConfigService): DrizzleModuleOptions {
  return {
    connectionString: config.database().url,
  };
}

export function mapAppConfigToBullMqOptions(config: AppConfigService): BullMqModuleOptions {
  const redisConfig = config.redis();
  const bullmqConfig = config.bullmq();

  return {
    connection: {
      host: redisConfig.host,
      port: redisConfig.port,
      password: redisConfig.password,
      db: redisConfig.db,
      connectTimeoutMs: redisConfig.connectTimeoutMs,
    },
    defaultJobOptions: {
      attempts: bullmqConfig.defaultAttempts,
      backoffDelay: bullmqConfig.backoffDelay,
    },
  };
}

export function mapAppConfigToAuthOptions(config: AppConfigService): AuthModuleOptions {
  const auth = config.auth();

  if (auth.driver === 'session') {
    return {
      driver: 'session',
      passwordSaltRounds: auth.passwordSaltRounds,
      sessionTtlSeconds: auth.sessionTtlSeconds,
      resolveSessionUser: () =>
        Promise.reject(
          new Error(
            'Session user resolver must be wired at the composition root (AuthApplicationCompositionModule)',
          ),
        ),
    };
  }

  return {
    driver: 'jwt',
    passwordSaltRounds: auth.passwordSaltRounds,
    jwt: config.jwt(),
  };
}

export function mapAppConfigToMailOptions(config: AppConfigService): MailModuleOptions {
  const mail = config.mail();

  if (mail.driver === 'smtp') {
    return {
      driver: 'smtp',
      smtp: mail.smtp,
    };
  }

  return { driver: 'null' };
}

export function mapAppConfigToHealthOptions(config: AppConfigService): HealthModuleOptions {
  return config.health();
}

export function mapAppConfigToStorageOptions(config: AppConfigService): StorageModuleOptions {
  const storage = config.storage();

  if (storage.driver === 's3') {
    return {
      driver: 's3',
      s3: storage.s3,
    };
  }

  return {
    driver: 'local',
    localPath: storage.localPath,
  };
}
