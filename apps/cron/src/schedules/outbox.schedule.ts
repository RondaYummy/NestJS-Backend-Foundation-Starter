import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import type { IQueueGateway } from '@contracts/queues/queue-gateway';
import type { OutboxProcessorOptions } from '@contracts/outbox/outbox-processor.options';
import { TOKENS } from '@contracts/tokens';
import { QUEUES } from '@contracts/queues/queue-names';
import { type IDistributedLock } from '@contracts/locks/distributed-lock';

const OUTBOX_SCHEDULE_INTERVAL_NAME = 'outbox-schedule';

@Injectable()
export class OutboxSchedule implements OnModuleInit, OnModuleDestroy {
  constructor(
    @Inject(TOKENS.QueueGateway) private readonly queues: IQueueGateway,
    @Inject(TOKENS.DistributedLock) private readonly lock: IDistributedLock,
    @Inject(TOKENS.OutboxProcessorOptions)
    private readonly options: OutboxProcessorOptions,
    private readonly schedulerRegistry: SchedulerRegistry,
  ) {}

  onModuleInit(): void {
    const interval = setInterval(() => {
      void this.tick();
    }, this.options.pollIntervalMs);

    this.schedulerRegistry.addInterval(OUTBOX_SCHEDULE_INTERVAL_NAME, interval);
  }

  onModuleDestroy(): void {
    this.schedulerRegistry.deleteInterval(OUTBOX_SCHEDULE_INTERVAL_NAME);
  }

  async tick(): Promise<void> {
    await this.lock.runWithLock('cron:outbox', this.options.cronLockTtlMs, async () => {
      await this.queues.add(
        QUEUES.OUTBOX,
        'process-pending-outbox-events',
        {},
        {
          jobId: 'outbox-process-pending',
          removeOnComplete: true,
          removeOnFail: true,
        },
      );
    });
  }
}
