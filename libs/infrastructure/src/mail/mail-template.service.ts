import { Injectable } from '@nestjs/common';
import { render } from '@react-email/render';
import type { EmailTemplateDataMap } from '@contracts/mail/email-template-data';
import type { EmailTemplateId } from '@contracts/mail/email-template-id';
import { resolveEmailTemplate } from './mail-template.registry';

@Injectable()
export class MailTemplateService {
  async render<T extends EmailTemplateId>(
    template: T,
    data: EmailTemplateDataMap[T],
  ): Promise<{ html: string; text: string }> {
    const element = resolveEmailTemplate(template, data);
    const html = await render(element);
    const text = await render(element, { plainText: true });
    return { html, text };
  }
}
