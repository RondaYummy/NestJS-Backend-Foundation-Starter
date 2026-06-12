import { randomUUID } from 'node:crypto';

import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

import { RequestContextService } from './request-context.service';

const REQUEST_ID_HEADER = 'x-request-id';
const CORRELATION_ID_HEADER = 'x-correlation-id';

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  constructor(private readonly requestContext: RequestContextService) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const incomingRequestId = this.getHeader(req, REQUEST_ID_HEADER);

    const incomingCorrelationId = this.getHeader(req, CORRELATION_ID_HEADER);

    const requestId = incomingRequestId ?? randomUUID();

    const correlationId = incomingCorrelationId ?? incomingRequestId ?? requestId;

    (req as Request & { requestId: string; correlationId?: string }).requestId = requestId;
    (req as Request & { correlationId?: string }).correlationId = correlationId;

    res.setHeader(REQUEST_ID_HEADER, requestId);

    res.setHeader(CORRELATION_ID_HEADER, correlationId);

    this.requestContext.run(
      {
        requestId,
        correlationId,
      },
      () => {
        next();
      },
    );
  }

  private getHeader(req: Request, name: string): string | undefined {
    const value = req.headers[name];

    const normalized = Array.isArray(value) ? value[0]?.trim() : value?.trim();

    if (!normalized) {
      return undefined;
    }

    if (normalized.length > 128) {
      return undefined;
    }

    if (!/^[a-zA-Z0-9._:-]+$/.test(normalized)) {
      return undefined;
    }

    return normalized;
  }
}
