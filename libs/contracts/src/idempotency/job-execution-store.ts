export interface IJobExecutionStore {
  acquire(key: string, ttlSeconds: number): Promise<string | null>;

  extend(key: string, ownershipToken: string, ttlSeconds: number): Promise<boolean>;

  complete(key: string, ownershipToken: string, ttlSeconds: number): Promise<boolean>;

  release(key: string, ownershipToken: string): Promise<void>;
}
