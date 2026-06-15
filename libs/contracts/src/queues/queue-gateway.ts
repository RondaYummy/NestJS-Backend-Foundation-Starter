import { EmailJobPayload } from '@contracts/mail/email-job';

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
  jobId?: string;
}

export interface IQueueGateway {
  add<TQueue extends QueueName, TJob extends JobName<TQueue>>(
    queueName: TQueue,
    jobName: TJob,
    payload: JobPayload<TQueue, TJob>,
    options?: QueueJobOptions,
  ): Promise<string>;

  addBulk<TQueue extends QueueName, TJob extends JobName<TQueue>>(
    queueName: TQueue,
    jobs: Array<{
      name: TJob;
      payload: JobPayload<TQueue, TJob>;
      options?: QueueJobOptions;
    }>,
  ): Promise<string[]>;
}

export interface QueueJobRegistry {
  email: {
    'send-welcome-email': EmailJobPayload;
  };

  outbox: {
    'process-pending-outbox-events': Record<string, never>;
  };
}

export type QueueName = keyof QueueJobRegistry;

export type JobName<TQueue extends QueueName> = keyof QueueJobRegistry[TQueue] & string;

export type JobPayload<
  TQueue extends QueueName,
  TJob extends JobName<TQueue>,
> = QueueJobRegistry[TQueue][TJob];

export type QueueJobItem<TQueue extends QueueName> = {
  [TJob in JobName<TQueue>]: {
    name: TJob;
    payload: JobPayload<TQueue, TJob>;
    options?: QueueJobOptions;
  };
}[JobName<TQueue>];
