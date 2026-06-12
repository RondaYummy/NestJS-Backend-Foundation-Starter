export interface RequestContext {
  requestId: string;
  correlationId: string;
  traceId?: string;
  userId?: string;
}
