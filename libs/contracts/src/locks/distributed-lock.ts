export interface LockHandle {
  key: string;
  token: string;
}
export interface IDistributedLock {
  acquire(key: string, ttlMs: number): Promise<LockHandle | null>;
  release(handle: LockHandle): Promise<void>;
  runWithLock<T>(key: string, ttlMs: number, handler: () => Promise<T>): Promise<T>;
}
