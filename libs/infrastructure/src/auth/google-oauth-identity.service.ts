import { OAuth2Client } from 'google-auth-library';

import type {
  GoogleIdentityProfile,
  IGoogleIdentityService,
} from '@contracts/auth/google-identity.service';
import { AuthenticationError } from '@domain/errors/domain-errors';

import type { GoogleSsoEnabledOptions } from './google-sso.module-options';

/**
 * Google OAuth 2.0 / OIDC adapter for the authorization-code redirect flow.
 * Configured exclusively through typed module options — never `process.env`.
 * Authorization codes, tokens and the client secret are never logged or
 * propagated in error details.
 */
export class GoogleOauthIdentityService implements IGoogleIdentityService {
  private readonly client: OAuth2Client;

  constructor(
    private readonly options: Pick<
      GoogleSsoEnabledOptions,
      'clientId' | 'clientSecret' | 'redirectUri' | 'hostedDomain'
    >,
    client?: OAuth2Client,
  ) {
    this.client =
      client ??
      new OAuth2Client({
        clientId: options.clientId,
        clientSecret: options.clientSecret,
        redirectUri: options.redirectUri,
      });
  }

  createAuthorizationUrl(state: string): string {
    return this.client.generateAuthUrl({
      response_type: 'code',
      scope: ['openid', 'email', 'profile'],
      state,
      ...(this.options.hostedDomain ? { hd: this.options.hostedDomain } : {}),
    });
  }

  async exchangeAuthorizationCode(code: string): Promise<GoogleIdentityProfile> {
    let idToken: string;

    try {
      const { tokens } = await this.client.getToken(code);

      if (!tokens.id_token) {
        throw new Error('Google token response did not include an ID token');
      }

      idToken = tokens.id_token;
    } catch (error) {
      throw this.tokenExchangeFailed(error);
    }

    let payload;

    try {
      const ticket = await this.client.verifyIdToken({
        idToken,
        audience: this.options.clientId,
      });

      payload = ticket.getPayload();
    } catch (error) {
      throw this.tokenExchangeFailed(error);
    }

    if (!payload?.sub || !payload.email) {
      throw new AuthenticationError(
        'GOOGLE_SSO_TOKEN_EXCHANGE_FAILED',
        'Google identity is missing required claims',
      );
    }

    if (
      this.options.hostedDomain &&
      payload.email.split('@')[1]?.toLowerCase() !== this.options.hostedDomain.toLowerCase()
    ) {
      throw new AuthenticationError(
        'GOOGLE_SSO_HOSTED_DOMAIN_MISMATCH',
        'Google account does not belong to the allowed hosted domain',
      );
    }

    return {
      sub: payload.sub,
      email: payload.email,
      emailVerified: payload.email_verified === true,
    };
  }

  private tokenExchangeFailed(error: unknown): AuthenticationError {
    if (error instanceof AuthenticationError) {
      return error;
    }

    // Intentionally generic: no authorization code, token or provider
    // response fragments may leak into the public error payload.
    return new AuthenticationError(
      'GOOGLE_SSO_TOKEN_EXCHANGE_FAILED',
      'Google authorization code exchange failed',
    );
  }
}
