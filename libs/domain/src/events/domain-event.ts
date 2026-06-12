export interface DomainEvent<TPayload = unknown> {
  readonly id: string;
  readonly name: string;
  readonly payload: TPayload;
  readonly occurredAt: Date;
}
