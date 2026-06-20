import { DynamicModule, Module, type ModuleMetadata } from '@nestjs/common';
import { TOKENS } from '@contracts/tokens';
import { RedisIdempotencyService } from './idempotency.service';
import { IdempotencyInterceptor } from './idempotency.interceptor';
import { RedisJobExecutionStore } from './redis-job-execution.store';

type IdempotencyModuleRegisterOptions = {
  imports?: ModuleMetadata['imports'];
};

@Module({})
export class IdempotencyModule {
  static register(options: IdempotencyModuleRegisterOptions = {}): DynamicModule {
    return {
      module: IdempotencyModule,
      imports: options.imports ?? [],
      providers: [
        RedisIdempotencyService,
        IdempotencyInterceptor,
        { provide: TOKENS.IdempotencyService, useExisting: RedisIdempotencyService },
        {
          provide: TOKENS.JobExecutionStore,
          useClass: RedisJobExecutionStore,
        },
      ],
      exports: [TOKENS.IdempotencyService, TOKENS.JobExecutionStore, IdempotencyInterceptor],
    };
  }
}
