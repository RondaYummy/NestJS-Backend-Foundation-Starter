import { Inject, Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { IQueueGateway } from '@contracts/queues/queue-gateway';
import { TOKENS } from '@contracts/tokens';
import { QUEUES } from '@contracts/queues/queue-names';

@Injectable()
export class OutboxSchedule {
  constructor(@Inject(TOKENS.QueueGateway) private readonly queues: IQueueGateway) {}
  @Cron(CronExpression.EVERY_10_SECONDS) async tick(): Promise<void> {
    await this.queues.add(QUEUES.OUTBOX, 'process-pending-outbox-events', {});
  }
}
