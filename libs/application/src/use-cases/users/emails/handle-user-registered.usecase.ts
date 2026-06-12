import { Inject, Injectable } from '@nestjs/common';

import type { IQueueGateway } from '@contracts/queues/queue-gateway';
import { QUEUES } from '@contracts/queues/queue-names';
import { TOKENS } from '@contracts/tokens';
import { EMAIL_TEMPLATE } from '@contracts/mail/email-template-id';

export type HandleUserRegisteredInput = {
  userId: string;
  email: string;
};

@Injectable()
export class HandleUserRegisteredUseCase {
  constructor(
    @Inject(TOKENS.QueueGateway)
    private readonly queueGateway: IQueueGateway,
  ) {}

  async execute(input: HandleUserRegisteredInput): Promise<void> {
    await this.queueGateway.add(
      QUEUES.EMAIL,
      'send-welcome-email',
      {
        to: input.email,
        subject: 'Welcome',
        template: EMAIL_TEMPLATE.WELCOME,
        data: {
          email: input.email,
        },
      },
      {
        jobId: `welcome-email:${input.userId}`,
      },
    );
  }
}
