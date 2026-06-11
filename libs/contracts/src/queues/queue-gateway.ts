export interface QueueJobBackoffOptions {
  type: 'fixed' | 'exponential';
  delay: number;
}

export interface QueueJobOptions {
  delay?: number;
  attempts?: number;
  backoff?: QueueJobBackoffOptions;
  removeOnComplete?: boolean | number;
  removeOnFail?: boolean | number;
}

export interface IQueueGateway {
  add<T>(
    queueName: string,
    jobName: string,
    payload: T,
    options?: QueueJobOptions,
  ): Promise<string>;

  addBulk<T>(
    queueName: string,
    jobs: Array<{
      name: string;
      payload: T;
      options?: QueueJobOptions;
    }>,
  ): Promise<string[]>;
}
