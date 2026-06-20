import { Inject, Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { getQueueToken } from '@nestjs/bullmq';
import { Queue, type Job, type JobsOptions } from 'bullmq';
import type {
  IQueueGateway,
  QueueJobItem,
  QueueJobOptions,
  QueueName,
} from '@contracts/queues/queue-gateway';

import { BULLMQ_MODULE_OPTIONS, BULLMQ_REGISTERED_QUEUES } from './bullmq.module-options';
import type { BullMqModuleOptions } from './bullmq.module-options';

@Injectable()
export class BullQueueGateway implements IQueueGateway {
  private readonly queues: ReadonlyMap<string, Queue>;

  constructor(
    private readonly moduleRef: ModuleRef,
    @Inject(BULLMQ_REGISTERED_QUEUES) registeredQueues: readonly string[],
    @Inject(BULLMQ_MODULE_OPTIONS) private readonly options: BullMqModuleOptions,
  ) {
    this.queues = new Map(
      registeredQueues.map((name) => [
        name,
        this.moduleRef.get<Queue>(getQueueToken(name), { strict: false }),
      ]),
    );
  }

  private buildJobOptions(options?: QueueJobOptions): JobsOptions {
    const defaults = this.options.defaultJobOptions ?? { attempts: 3, backoffDelay: 1000 };

    return {
      attempts: defaults.attempts,
      backoff: {
        type: 'exponential',
        delay: defaults.backoffDelay,
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

  async addBulk<TQueue extends QueueName>(
    queueName: TQueue,
    jobs: Array<QueueJobItem<TQueue>>,
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
    const queue = this.queues.get(name);
    if (!queue) throw new Error(`Unknown queue: ${name}`);
    return queue;
  }
}
