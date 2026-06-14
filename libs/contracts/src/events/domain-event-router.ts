export type RoutableDomainEvent = {
  id: string;
  name: string;
  payload: unknown;
  occurredAt: string;
};

export interface IDomainEventRouter {
  route(event: RoutableDomainEvent): Promise<void>;
}
