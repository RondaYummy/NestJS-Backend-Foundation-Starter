import { EMAIL_TEMPLATE, type EmailTemplateId } from '@contracts/mail/email-template-id';
import type { EmailTemplateDataMap } from '@contracts/mail/email-template-data';
import type { ReactElement } from 'react';
import { WelcomeEmail } from './templates/welcome.email';
import { PasswordResetEmail } from './templates/password-reset.email';

export function resolveEmailTemplate<T extends EmailTemplateId>(
  template: T,
  data: EmailTemplateDataMap[T],
): ReactElement {
  switch (template) {
    case EMAIL_TEMPLATE.WELCOME:
      return <WelcomeEmail {...data} />;
    case EMAIL_TEMPLATE.PASSWORD_RESET:
      return <PasswordResetEmail {...(data as EmailTemplateDataMap['password-reset'])} />;
    default:
      throw new Error(`Unknown email template: ${String(template)}`);
  }
}
