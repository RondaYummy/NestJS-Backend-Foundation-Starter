export type GoogleSsoEnabledOptions = {
  enabled: true;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  /** Optional Google Workspace hosted-domain restriction (`hd`); empty/undefined = unrestricted. */
  hostedDomain?: string;
  /** Optional fallback `returnUrl` used when the start request omits one; must pass the same allowlist. */
  defaultReturnUrl?: string;
  /** One-time OAuth `state` TTL in Redis. */
  stateTtlSeconds: number;
};

export type GoogleSsoModuleOptions = { enabled: false } | GoogleSsoEnabledOptions;

export const GOOGLE_SSO_MODULE_OPTIONS = Symbol('GOOGLE_SSO_MODULE_OPTIONS');

export function isGoogleSsoEnabledOptions(
  options: GoogleSsoModuleOptions,
): options is GoogleSsoEnabledOptions {
  return options.enabled;
}
