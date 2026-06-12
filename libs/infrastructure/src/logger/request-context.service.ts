import { AsyncLocalStorage } from 'node:async_hooks';

import { Injectable } from '@nestjs/common';
import { RequestContext } from './request-context.types';

@Injectable()
export class RequestContextService {
  private readonly storage = new AsyncLocalStorage<RequestContext>();

  run<T>(context: RequestContext, callback: () => T): T {
    return this.storage.run(context, callback);
  }

  get(): RequestContext | undefined {
    return this.storage.getStore();
  }

  getRequestId(): string | undefined {
    return this.get()?.requestId;
  }

  getCorrelationId(): string | undefined {
    return this.get()?.correlationId;
  }

  getUserId(): string | undefined {
    return this.get()?.userId;
  }

  setUserId(userId: string): void {
    const context = this.get();

    if (!context) {
      return;
    }

    context.userId = userId;
  }

  setTraceId(traceId: string): void {
    const context = this.get();

    if (!context) {
      return;
    }

    context.traceId = traceId;
  }
}
