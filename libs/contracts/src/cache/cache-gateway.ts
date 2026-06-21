export interface ICacheGateway {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlSeconds?: number): Promise<void>;
  del(key: string): Promise<void>;
  remember<T>(key: string, ttlSeconds: number, resolver: () => Promise<T>): Promise<T>;
  /**
   * Removes all cached entries whose keys match a Redis glob pattern.
   *
   * @param pattern Logical glob pattern relative to the gateway prefix (e.g. `users:*`),
   *   not including the `app:` prefix applied by other cache methods.
   *
   * Deletion is best-effort: keys created concurrently during the scan may survive.
   * Redis errors propagate to the caller.
   */
  forgetByPattern(pattern: string): Promise<void>;
}
