export interface ProcessOutboxResult {
  selected: number;
  processed: number;
  failed: number;
}

export interface IOutboxProcessor {
  processPending(): Promise<ProcessOutboxResult>;
}
