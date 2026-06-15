export interface IJobExecutionStore {
  isCompleted(key: string): Promise<boolean>;

  markCompleted(key: string, ttlSeconds: number): Promise<void>;
}
