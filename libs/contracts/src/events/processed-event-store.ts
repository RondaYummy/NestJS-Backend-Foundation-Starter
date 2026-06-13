export interface IProcessedEventStore {
  executeOnce(consumer: string, eventId: string, handler: () => Promise<void>): Promise<boolean>;
}
