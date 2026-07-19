import { randomBytes } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import type { IGoogleIdentityService } from '@contracts/auth/google-identity.service';
import type {
  GoogleOAuthStatePayload,
  IGoogleOAuthStateStore,
} from '@contracts/auth/google-oauth-state.store';
import { TOKENS } from '@contracts/tokens';
import {
  AuthenticationError,
  ServiceUnavailableError,
  ValidationError,
} from '@domain/errors/domain-errors';
import {
  GOOGLE_SSO_MODULE_OPTIONS,
  isGoogleSsoEnabledOptions,
  type GoogleSsoEnabledOptions,
  type GoogleSsoModuleOptions,
} from '@infrastructure/auth/google-sso.module-options';
import { AppConfigService } from '@infrastructure/config/app-config.service';

export type GoogleSsoStartResult = {
  state: string;
  authorizationUrl: string;
  stateTtlSeconds: number;
};

export type GoogleSsoCallbackInput = {
  state?: string;
  stateFromCookie?: unknown;
  error?: string;
  code?: string;
};

export type GoogleSsoValidatedCallback = {
  code: string;
  payload: GoogleOAuthStatePayload;
};

/**
 * OAuth flow orchestration for `GoogleAuthController`: feature gating, return
 * URL allowlisting, and one-time CSRF state handling. Keeps the controller a
 * thin HTTP adapter (cookies, redirects, response envelopes).
 */
@Injectable()
export class GoogleSsoFlowService {
  constructor(
    @Inject(GOOGLE_SSO_MODULE_OPTIONS)
    private readonly options: GoogleSsoModuleOptions,
    @Inject(TOKENS.GoogleIdentityService)
    private readonly googleIdentityService: IGoogleIdentityService,
    @Inject(TOKENS.GoogleOAuthStateStore)
    private readonly stateStore: IGoogleOAuthStateStore,
    private readonly config: AppConfigService,
  ) {}

  /**
   * OQ-05: routes stay registered while disabled and answer 503 without
   * contacting Google (AC-07).
   */
  assertEnabled(): GoogleSsoEnabledOptions {
    if (!isGoogleSsoEnabledOptions(this.options)) {
      throw new ServiceUnavailableError('GOOGLE_SSO_DISABLED', 'Google SSO is disabled');
    }

    return this.options;
  }

  async start(requestedReturnUrl: string | undefined): Promise<GoogleSsoStartResult> {
    const options = this.assertEnabled();

    const returnUrl = this.resolveReturnUrl(requestedReturnUrl, options.defaultReturnUrl);

    const state = randomBytes(32).toString('base64url');
    const payload: GoogleOAuthStatePayload = returnUrl ? { returnUrl } : {};

    await this.stateStore.save(state, payload, options.stateTtlSeconds);

    return {
      state,
      authorizationUrl: this.googleIdentityService.createAuthorizationUrl(state),
      stateTtlSeconds: options.stateTtlSeconds,
    };
  }

  /**
   * Double-submit CSRF check: the query state must equal the httpOnly cookie
   * value and the one-time server-side record must still exist (AC-06). Only
   * then are the Google `error`/`code` parameters interpreted.
   */
  async validateCallback(input: GoogleSsoCallbackInput): Promise<GoogleSsoValidatedCallback> {
    this.assertEnabled();

    if (
      !input.state ||
      typeof input.stateFromCookie !== 'string' ||
      input.stateFromCookie !== input.state
    ) {
      throw new ValidationError('GOOGLE_SSO_INVALID_STATE', 'OAuth state is missing or mismatched');
    }

    const payload = await this.stateStore.consume(input.state);

    if (payload === null) {
      throw new ValidationError(
        'GOOGLE_SSO_INVALID_STATE',
        'OAuth state is expired or already used',
      );
    }

    if (input.error) {
      throw new AuthenticationError(
        'GOOGLE_SSO_TOKEN_EXCHANGE_FAILED',
        'Google reported an authorization error',
      );
    }

    if (!input.code) {
      throw new ValidationError('GOOGLE_SSO_INVALID_STATE', 'Authorization code is missing');
    }

    return { code: input.code, payload };
  }

  exchangeCode(code: string): ReturnType<IGoogleIdentityService['exchangeAuthorizationCode']> {
    return this.googleIdentityService.exchangeAuthorizationCode(code);
  }

  /**
   * OQ-04: the returnUrl origin must belong to the CORS allowlist. An explicit
   * invalid returnUrl fails fast (400); an invalid configured default is
   * ignored so misconfiguration cannot break the plain JSON flow.
   */
  private resolveReturnUrl(
    requested: string | undefined,
    configuredDefault: string | undefined,
  ): string | undefined {
    if (requested !== undefined) {
      if (!this.isAllowlistedUrl(requested)) {
        throw new ValidationError(
          'INVALID_RETURN_URL',
          'returnUrl must be an absolute URL with an origin listed in CORS_ORIGINS',
        );
      }

      return requested;
    }

    if (configuredDefault && this.isAllowlistedUrl(configuredDefault)) {
      return configuredDefault;
    }

    return undefined;
  }

  private isAllowlistedUrl(candidate: string): boolean {
    let parsed: URL;

    try {
      parsed = new URL(candidate);
    } catch {
      return false;
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return false;
    }

    const allowedOrigins = this.config
      .app()
      .allowedOrigins.split(',')
      .map((origin) => origin.trim())
      .filter(Boolean);

    return allowedOrigins.includes(parsed.origin);
  }
}
