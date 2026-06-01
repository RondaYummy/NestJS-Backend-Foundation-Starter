import { Module } from '@nestjs/common';
import { DrizzleModule } from '../database/drizzle/drizzle.module';
import { RedisModule } from '../redis/redis.module';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

@Module({
  imports: [DrizzleModule, RedisModule],
  controllers: [HealthController],
  providers: [HealthService],
  exports: [HealthService],
})
export class HealthModule {}
