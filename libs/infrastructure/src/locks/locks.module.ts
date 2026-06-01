import { Module } from '@nestjs/common';
import { TOKENS } from '@contracts/tokens';
import { RedisModule } from '../redis/redis.module';
import { RedisDistributedLock } from './redis-distributed-lock';

@Module({
  imports: [RedisModule],
  providers: [
    RedisDistributedLock,
    { provide: TOKENS.DistributedLock, useExisting: RedisDistributedLock },
  ],
  exports: [TOKENS.DistributedLock],
})
export class LocksModule {}
