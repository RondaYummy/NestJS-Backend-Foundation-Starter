import { Inject, Injectable } from '@nestjs/common';
import nodemailer from 'nodemailer';
import type { IEmailGateway } from '@contracts/mail/email-gateway';

import {
  MAIL_MODULE_OPTIONS,
  isSmtpMailOptions,
  type MailModuleOptions,
} from './mail.module-options';

@Injectable()
export class SmtpMailAdapter implements IEmailGateway {
  private readonly transporter: nodemailer.Transporter;
  private readonly defaultFrom: string;

  constructor(@Inject(MAIL_MODULE_OPTIONS) options: MailModuleOptions) {
    if (!isSmtpMailOptions(options)) {
      throw new Error('SmtpMailAdapter requires SMTP mail options');
    }

    this.defaultFrom = options.smtp.from;
    this.transporter = nodemailer.createTransport({
      host: options.smtp.host,
      port: options.smtp.port,
      auth: {
        user: options.smtp.user,
        pass: options.smtp.password,
      },
    });
  }

  async send(input: {
    to: string | string[];
    subject: string;
    html?: string;
    text?: string;
    from?: string;
    messageId?: string;
  }): Promise<void> {
    await this.transporter.sendMail({
      from: input.from ?? this.defaultFrom,
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
      messageId: input.messageId,
    });
  }
}
