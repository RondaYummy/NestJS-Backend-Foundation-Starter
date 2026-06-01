export interface DomainEvent {
  id: string;
  name: string;
  occurredAt: Date;
  payload: Record<string, unknown>;
}
