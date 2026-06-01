import { Module } from '@nestjs/common';
import { TOKENS } from '@contracts/tokens';
import { RedisModule } from '../redis/redis.module';
import { RedisIdempotencyService } from './idempotency.service';
import { IdempotencyInterceptor } from './idempotency.interceptor';
@Module({
  imports: [RedisModule],
  providers: [
    RedisIdempotencyService,
    IdempotencyInterceptor,
    { provide: TOKENS.IdempotencyService, useExisting: RedisIdempotencyService },
  ],
  exports: [TOKENS.IdempotencyService, IdempotencyInterceptor],
})
export class IdempotencyModule {}
