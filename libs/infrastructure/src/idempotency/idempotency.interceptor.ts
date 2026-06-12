import { CallHandler, ExecutionContext, Inject, Injectable, NestInterceptor } from '@nestjs/common';
import { from, lastValueFrom, Observable } from 'rxjs';
import type { Request } from 'express';
import type { IIdempotencyService } from '@contracts/idempotency/idempotency-service';
import { TOKENS } from '@contracts/tokens';
import { hashObject } from '@shared/utils/hash-object';
import { Reflector } from '@nestjs/core';
import { IDEMPOTENT_KEY } from './idempotent.decorator';
import { ConflictError } from '@domain/errors/domain-errors';

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    @Inject(TOKENS.IdempotencyService)
    private readonly idem: IIdempotencyService,
    private readonly reflector: Reflector,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const enabled = this.reflector.getAllAndOverride<boolean>(IDEMPOTENT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!enabled) {
      return next.handle();
    }

    const req = context.switchToHttp().getRequest<Request>();
    const key = req.header('Idempotency-Key');
    if (!key) {
      throw new ConflictError('IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key header is required');
    }
    const request = req as Request & {
      user?: {
        id: string;
      };
    };

    const actorId = request.user?.id ?? request.ip;

    const scope = [actorId, req.method, req.baseUrl, req.path].join(':');

    const requestHash = hashObject({
      body: req.body,
      params: req.params,
      query: req.query,
      contentType: req.headers['content-type'],
    });

    return from(
      this.idem.execute({
        key,
        scope,
        requestHash,
        ttlSeconds: 86400,
        handler: () => lastValueFrom(next.handle()),
      }),
    );
  }
}
