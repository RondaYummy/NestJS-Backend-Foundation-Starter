export interface AuditLogInput {
  actorId?: string;
  actorType: 'user' | 'system';
  action: string;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
  ip?: string;
  userAgent?: string;
}
export interface IAuditLogger {
  log(input: AuditLogInput): Promise<void>;
}
