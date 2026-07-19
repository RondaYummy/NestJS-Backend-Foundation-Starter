import type { EmailTemplateId } from './email-template-id';

export type EmailTemplateDataMap = {
  welcome: {
    email: string;
  };

  'password-reset': {
    email: string;
    token: string;
    resetUrl?: string;
    expiresInMinutes: number;
  };
};

export type EmailTemplateData<T extends EmailTemplateId = EmailTemplateId> =
  EmailTemplateDataMap[T];
