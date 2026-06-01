import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue, type JobsOptions } from 'bullmq';
import type { IQueueGateway } from '@contracts/queues/queue-gateway';
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
  async add<T>(
    queueName: string,
    jobName: string,
    payload: T,
    options?: JobsOptions,
  ): Promise<string> {
    const job = await this.getQueue(queueName).add(jobName, payload, {
      attempts: this.config.getNumber('bullmq.defaultAttempts'),
      backoff: { type: 'exponential', delay: this.config.getNumber('bullmq.backoffDelay') },
      removeOnComplete: 1000,
      removeOnFail: 5000,
      ...options,
    });
    return String(job.id);
  }
  async addBulk<T>(
    queueName: string,
    jobs: Array<{ name: string; payload: T; options?: JobsOptions }>,
  ): Promise<string[]> {
    const queue = this.getQueue(queueName);
    const result = await queue.addBulk(
      jobs.map((job) => ({ name: job.name, data: job.payload, opts: job.options })),
    );
    return result.map((job) => String(job.id));
  }
  private getQueue(name: string): Queue {
    const queue = this.queues[name];
    if (!queue) throw new Error(`Unknown queue: ${name}`);
    return queue;
  }
}
