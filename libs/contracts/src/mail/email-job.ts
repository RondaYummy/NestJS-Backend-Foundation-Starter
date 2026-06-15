import type { EmailTemplateDataMap } from './email-template-data';
import type { EmailTemplateId } from './email-template-id';

export type TemplatedEmailJob<T extends EmailTemplateId = EmailTemplateId> = {
  to: string;
  idempotencyKey: string;
  subject: string;
  template: T;
  data: EmailTemplateDataMap[T];
};

export type RawEmailJob = {
  to: string;
  subject: string;
  html: string;
  text?: string;
  from?: string;
};

export type EmailJobPayload = TemplatedEmailJob | RawEmailJob;

export function isTemplatedEmailJob(payload: EmailJobPayload): payload is TemplatedEmailJob {
  return 'template' in payload;
}
