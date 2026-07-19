/**
 * Verified Google identity claims exposed to the Application layer.
 * Never carries Google SDK types, raw tokens, or authorization codes.
 */
export type GoogleIdentityProfile = {
  /** Durable Google OIDC subject identifier. */
  sub: string;
  email: string;
  emailVerified: boolean;
};

export interface IGoogleIdentityService {
  /**
   * Builds the Google OAuth 2.0 authorization URL for the redirect flow
   * (`response_type=code`, `scope=openid email profile`) carrying the CSRF `state`.
   */
  createAuthorizationUrl(state: string): string;

  /**
   * Exchanges an authorization `code` for a verified Google identity profile.
   * Throws a domain `AuthenticationError` when the exchange or verification fails.
   */
  exchangeAuthorizationCode(code: string): Promise<GoogleIdentityProfile>;
}
