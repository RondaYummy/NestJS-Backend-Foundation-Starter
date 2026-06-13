import { Injectable } from '@nestjs/common';
import nodemailer from 'nodemailer';
import type { IEmailGateway } from '@contracts/mail/email-gateway';
import { AppConfigService } from '../config/app-config.service';

@Injectable()
export class SmtpMailAdapter implements IEmailGateway {
  private readonly transporter: nodemailer.Transporter;

  constructor(private readonly config: AppConfigService) {
    this.transporter = nodemailer.createTransport({
      host: this.config.mail().smtp.host,
      port: this.config.mail().smtp.port,
      auth: {
        user: this.config.mail().smtp.user,
        pass: this.config.mail().smtp.password,
      },
    });
  }

  async send(input: {
    to: string | string[];
    subject: string;
    html?: string;
    text?: string;
    from?: string;
  }): Promise<void> {
    await this.transporter.sendMail({
      from: input.from ?? this.config.mail().smtp.from,
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
    });
  }
}
