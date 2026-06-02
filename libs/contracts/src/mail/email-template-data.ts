import type { EmailTemplateId } from './email-template-id';

export type EmailTemplateDataMap = {
  welcome: {
    email: string;
  };
};

export type EmailTemplateData<T extends EmailTemplateId = EmailTemplateId> =
  EmailTemplateDataMap[T];
