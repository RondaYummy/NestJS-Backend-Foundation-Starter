export type MailSmtpOptions = {
  host: string;
  port: number;
  user: string;
  password: string;
  from: string;
};

export type MailModuleOptions =
  | {
      driver: 'null';
    }
  | {
      driver: 'smtp';
      smtp: MailSmtpOptions;
    };

export const MAIL_MODULE_OPTIONS = Symbol('MAIL_MODULE_OPTIONS');

export function isSmtpMailOptions(
  options: MailModuleOptions,
): options is Extract<MailModuleOptions, { driver: 'smtp' }> {
  return options.driver === 'smtp';
}
