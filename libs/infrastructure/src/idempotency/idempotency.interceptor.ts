import { CallHandler, ExecutionContext, Inject, Injectable, NestInterceptor } from '@nestjs/common';
import { from, lastValueFrom, Observable } from 'rxjs';
import type { Request } from 'express';
import type { IIdempotencyService } from '@contracts/idempotency/idempotency-service';
import { TOKENS } from '@contracts/tokens';
import { hashObject } from '@shared/utils/hash-object';

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(@Inject(TOKENS.IdempotencyService) private readonly idem: IIdempotencyService) {}
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request>();
    const key = req.header('Idempotency-Key');
    if (!key || req.method === 'GET') return next.handle();
    return from(
      this.idem.execute({
        key,
        scope: `${req.method}:${req.path}`,
        requestHash: hashObject(req.body),
        ttlSeconds: 86400,
        handler: () => lastValueFrom(next.handle()),
      }),
    );
  }
}
