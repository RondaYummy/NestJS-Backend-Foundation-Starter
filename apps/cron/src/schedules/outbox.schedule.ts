import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import type { IQueueGateway } from '@contracts/queues/queue-gateway';
import type { OutboxProcessorOptions } from '@contracts/outbox/outbox-processor.options';
import { TOKENS } from '@contracts/tokens';
import { QUEUES } from '@contracts/queues/queue-names';
import { type IDistributedLock } from '@contracts/locks/distributed-lock';
import { AppLogger } from '@infrastructure/logger/app-logger.service';

const OUTBOX_SCHEDULE_INTERVAL_NAME = 'outbox-schedule';

@Injectable()
export class OutboxSchedule implements OnModuleInit, OnModuleDestroy {
  private tickRunning = false;
  private shuttingDown = false;

  constructor(
    @Inject(TOKENS.QueueGateway) private readonly queues: IQueueGateway,
    @Inject(TOKENS.DistributedLock) private readonly lock: IDistributedLock,
    @Inject(TOKENS.OutboxProcessorOptions)
    private readonly options: OutboxProcessorOptions,
    private readonly schedulerRegistry: SchedulerRegistry,
    private readonly logger: AppLogger,
  ) {}

  onModuleInit(): void {
    const interval = setInterval(() => {
      void this.runTickSafely();
    }, this.options.pollIntervalMs);

    this.schedulerRegistry.addInterval(OUTBOX_SCHEDULE_INTERVAL_NAME, interval);
  }

  onModuleDestroy(): void {
    this.shuttingDown = true;
    this.schedulerRegistry.deleteInterval(OUTBOX_SCHEDULE_INTERVAL_NAME);
  }

  private async runTickSafely(): Promise<void> {
    if (this.shuttingDown || this.tickRunning) {
      return;
    }

    this.tickRunning = true;

    try {
      await this.tick();
    } catch (error) {
      this.logger.error('Outbox cron tick failed', error);
    } finally {
      this.tickRunning = false;
    }
  }

  async tick(): Promise<void> {
    const result = await this.lock.runWithLock(
      'cron:outbox',
      this.options.cronLockTtlMs,
      async () => {
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
      },
    );

    if (result === null) {
      this.logger.debug('Outbox cron tick skipped; distributed lock not acquired', {
        lockKey: 'cron:outbox',
      });
    }
  }
}
