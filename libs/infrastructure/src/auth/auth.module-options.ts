import type { CurrentUser } from '@contracts/auth/current-user';

export type AuthJwtOptions = {
  secret: string;
  expiresIn: string;
  refreshSecret: string;
  refreshExpiresIn: string;
};

export type AuthModuleOptions =
  | {
      driver: 'jwt';
      passwordSaltRounds: number;
      jwt: AuthJwtOptions;
      resolveAccessUser?: (userId: string) => Promise<CurrentUser | null>;
    }
  | {
      driver: 'session';
      passwordSaltRounds: number;
      sessionTtlSeconds: number;
      resolveSessionUser: (userId: string) => Promise<CurrentUser | null>;
    };

export const AUTH_MODULE_OPTIONS = Symbol('AUTH_MODULE_OPTIONS');

export function isJwtAuthOptions(
  options: AuthModuleOptions,
): options is Extract<AuthModuleOptions, { driver: 'jwt' }> {
  return options.driver === 'jwt';
}

export function isSessionAuthOptions(
  options: AuthModuleOptions,
): options is Extract<AuthModuleOptions, { driver: 'session' }> {
  return options.driver === 'session';
}
