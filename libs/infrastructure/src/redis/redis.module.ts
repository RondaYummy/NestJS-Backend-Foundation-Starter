import { Global, Module, OnApplicationShutdown } from '@nestjs/common';
import Redis from 'ioredis';
import { InfrastructureConfigModule } from '../config/infrastructure-config.module';
import { AppConfigService } from '../config/app-config.service';
import { LoggerModule } from '../logger/logger.module';
import { AppLogger } from '../logger/app-logger.service';
import { RedisService } from './redis.service';
import { REDIS_CLIENT } from './redis.tokens';
@Global()
@Module({
  imports: [InfrastructureConfigModule, LoggerModule],
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [AppConfigService, AppLogger],
      useFactory: (config: AppConfigService, logger: AppLogger) => {
        const redisConfig = config.redis();

        const client = new Redis({
          host: redisConfig.host,
          port: redisConfig.port,
          password: redisConfig.password || undefined,
          db: redisConfig.db,

          /*
           * Для довгоживучих Redis operations допускаємо очікування
           * відновлення connection.
           */
          maxRetriesPerRequest: null,

          /*
           * Один TCP connection attempt не повинен висіти надто довго.
           */
          connectTimeout: config.redis().connectTimeoutMs,

          /*
           * Після успішного startup runtime client повинен переживати
           * тимчасове падіння Redis.
           */
          retryStrategy: (attempt: number): number => {
            return Math.min(attempt * 250, 5000);
          },
        });
        client.on('error', (error) => logger.error('Redis connection error', error));
        return client;
      },
    },
    RedisService,
    {
      provide: 'REDIS_SHUTDOWN',
      inject: [REDIS_CLIENT],
      useFactory: (client: Redis) => new RedisShutdown(client),
    },
  ],
  exports: [REDIS_CLIENT, RedisService],
})
export class RedisModule {}
class RedisShutdown implements OnApplicationShutdown {
  constructor(private readonly client: Redis) {}
  async onApplicationShutdown(): Promise<void> {
    await this.client.quit();
  }
}
