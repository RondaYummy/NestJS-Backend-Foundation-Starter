import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue, type Job, type JobsOptions } from 'bullmq';
import type { IQueueGateway, QueueJobOptions } from '@contracts/queues/queue-gateway';
import { AppConfigService } from '../config/app-config.service';
import { QUEUES } from './queues';

@Injectable()
export class BullQueueGateway implements IQueueGateway {
  private readonly queues: Record<string, Queue>;
  constructor(
    @InjectQueue(QUEUES.DEFAULT) defaultQueue: Queue,
    @InjectQueue(QUEUES.EMAIL) emailQueue: Queue,
    @InjectQueue(QUEUES.EVENTS) eventsQueue: Queue,
    @InjectQueue(QUEUES.OUTBOX) outboxQueue: Queue,
    private readonly config: AppConfigService,
  ) {
    this.queues = {
      [QUEUES.DEFAULT]: defaultQueue,
      [QUEUES.EMAIL]: emailQueue,
      [QUEUES.EVENTS]: eventsQueue,
      [QUEUES.OUTBOX]: outboxQueue,
    };
  }

  private buildJobOptions(options?: QueueJobOptions): JobsOptions {
    return {
      attempts: this.config.bullmq().defaultAttempts,
      backoff: {
        type: 'exponential',
        delay: this.config.bullmq().backoffDelay,
      },
      removeOnComplete: 1000,
      removeOnFail: 5000,
      ...options,
    };
  }

  async add<T>(
    queueName: string,
    jobName: string,
    payload: T,
    options?: QueueJobOptions,
  ): Promise<string> {
    const job = await this.getQueue(queueName).add(jobName, payload, this.buildJobOptions(options));
    return String(job.id);
  }

  async addBulk<T>(
    queueName: string,
    jobs: Array<{
      name: string;
      payload: T;
      options?: QueueJobOptions;
    }>,
  ): Promise<string[]> {
    const queue = this.getQueue(queueName);
    const result = await queue.addBulk(
      jobs.map((job) => ({
        name: job.name,
        data: job.payload,
        opts: this.buildJobOptions(job.options),
      })),
    );
    return result.map((job: Job) => String(job.id));
  }
  private getQueue(name: string): Queue {
    const queue = this.queues[name];
    if (!queue) throw new Error(`Unknown queue: ${name}`);
    return queue;
  }
}
