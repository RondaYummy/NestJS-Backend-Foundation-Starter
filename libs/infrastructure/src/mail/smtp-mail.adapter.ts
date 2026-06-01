import { Injectable } from '@nestjs/common';
import nodemailer from 'nodemailer';
import type { IEmailGateway } from '@contracts/mail/email-gateway';
import { AppConfigService } from '../config/app-config.service';

@Injectable()
export class SmtpMailAdapter implements IEmailGateway {
  constructor(private readonly config: AppConfigService) {}
  async send(input: {
    to: string | string[];
    subject: string;
    html?: string;
    text?: string;
    from?: string;
  }): Promise<void> {
    const transporter = nodemailer.createTransport({
      host: this.config.getString('mail.smtp.host'),
      port: this.config.getNumber('mail.smtp.port'),
      auth: {
        user: this.config.getString('mail.smtp.user'),
        pass: this.config.getString('mail.smtp.password'),
      },
    });
    await transporter.sendMail({
      from: input.from ?? this.config.getString('mail.smtp.from'),
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
    });
  }
}
