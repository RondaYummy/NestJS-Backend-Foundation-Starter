import { Module } from '@nestjs/common';
import { TOKENS } from '@contracts/tokens';
import { RedisModule } from '../redis/redis.module';
import { RedisIdempotencyService } from './idempotency.service';
import { IdempotencyInterceptor } from './idempotency.interceptor';
import { RedisJobExecutionStore } from './redis-job-execution.store';

@Module({
  imports: [RedisModule],
  providers: [
    RedisIdempotencyService,
    IdempotencyInterceptor,
    { provide: TOKENS.IdempotencyService, useExisting: RedisIdempotencyService },
    {
      provide: TOKENS.JobExecutionStore,
      useClass: RedisJobExecutionStore,
    },
  ],
  exports: [
    TOKENS.IdempotencyService,
    TOKENS.JobExecutionStore,
    IdempotencyInterceptor,
  ],
})
export class IdempotencyModule {}
