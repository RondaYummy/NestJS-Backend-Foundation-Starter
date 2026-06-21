import { type EmailTemplateId } from '@contracts/mail/email-template-id';

export interface IEmailGateway {
  send(input: {
    to: string | string[];
    subject: string;
    html?: string;
    text?: string;
    from?: string;
    messageId?: string;
    template?: EmailTemplateId;
    data?: Record<string, unknown>;
  }): Promise<void>;
}
