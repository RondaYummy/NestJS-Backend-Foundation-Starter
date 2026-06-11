import { Inject, Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { IQueueGateway } from '@contracts/queues/queue-gateway';
import { TOKENS } from '@contracts/tokens';
import { QUEUES } from '@contracts/queues/queue-names';
import { IDistributedLock } from '@contracts/locks/distributed-lock';

@Injectable()
export class OutboxSchedule {
  constructor(
    @Inject(TOKENS.QueueGateway) private readonly queues: IQueueGateway,
    @Inject(TOKENS.DistributedLock) private readonly lock: IDistributedLock,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE) async tick(): Promise<void> {
    await this.lock.runWithLock('cron:outbox', 55_000, async () => {
      await this.queues.add(
        QUEUES.OUTBOX,
        'process-pending-outbox-events',
        {},
        {
          jobId: 'outbox:process-pending',
          removeOnComplete: true,
          removeOnFail: true,
        },
      );
    });
  }
}
