export interface IIdempotencyService {
  execute<T>(input: {
    key: string;
    scope: string;
    requestHash: string;
    ttlSeconds: number;
    handler: () => Promise<T>;
  }): Promise<T>;
}
