import { IEmailGateway } from '@contracts/mail/email-gateway';
import { AppLogger } from '@infrastructure/logger/app-logger.service';
import { Injectable } from '@nestjs/common';

@Injectable()
export class NullMailAdapter implements IEmailGateway {
  constructor(private readonly logger: AppLogger) {}

  async send(input: {
    to: string | string[];
    subject: string;
    html?: string;
    text?: string;
    from?: string;
    messageId?: string;
  }): Promise<void> {
    this.logger.info('Email skipped by null mail driver', {
      to: input.to,
      subject: input.subject,
    });
    await Promise.resolve();
  }
}
