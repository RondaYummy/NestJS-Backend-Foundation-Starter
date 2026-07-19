export const EMAIL_TEMPLATE = {
  WELCOME: 'welcome',
  PASSWORD_RESET: 'password-reset',
} as const;

export type EmailTemplateId = (typeof EMAIL_TEMPLATE)[keyof typeof EMAIL_TEMPLATE];

export const EMAIL_TEMPLATE_IDS = Object.values(EMAIL_TEMPLATE);
