import type { JobsOptions } from 'bullmq';
export interface IQueueGateway {
  add<T>(queueName: string, jobName: string, payload: T, options?: JobsOptions): Promise<string>;
  addBulk<T>(
    queueName: string,
    jobs: Array<{ name: string; payload: T; options?: JobsOptions }>,
  ): Promise<string[]>;
}
