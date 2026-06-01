import { Injectable } from '@nestjs/common';
import type { IEmailGateway } from '@contracts/mail/email-gateway';
@Injectable()
export class NullMailAdapter implements IEmailGateway {
  async send(): Promise<void> {
    return;
  }
}
