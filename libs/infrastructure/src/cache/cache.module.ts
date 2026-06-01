import { Module } from '@nestjs/common';
import { TOKENS } from '@contracts/tokens';
import { RedisModule } from '../redis/redis.module';
import { RedisCacheGateway } from './redis-cache.gateway';
@Module({
  imports: [RedisModule],
  providers: [RedisCacheGateway, { provide: TOKENS.CacheGateway, useExisting: RedisCacheGateway }],
  exports: [TOKENS.CacheGateway, RedisCacheGateway],
})
export class CacheModule {}
