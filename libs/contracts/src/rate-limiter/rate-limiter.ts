export interface IRateLimiter {
  check(input: {
    key: string;
    limit: number;
    ttlSeconds: number;
  }): Promise<{ allowed: boolean; remaining: number; resetAt: Date }>;
}
