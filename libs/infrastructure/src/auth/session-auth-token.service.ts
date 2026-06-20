import { Inject, Injectable } from '@nestjs/common';
import {
  IAuthTokenService,
  RevokeAuthSessionInput,
  AuthTokens,
} from '@contracts/auth/auth-token.service';
import { ISessionStore } from '@contracts/auth/session-store.service';
import { TOKENS } from '@contracts/tokens';
import { CurrentUser } from '@contracts/auth/current-user';
import { AuthenticationError } from '@domain/errors/domain-errors';

import {
  AUTH_MODULE_OPTIONS,
  isSessionAuthOptions,
  type AuthModuleOptions,
} from './auth.module-options';

@Injectable()
export class SessionAuthTokenService implements IAuthTokenService {
  constructor(
    @Inject(TOKENS.SessionStore)
    private readonly sessionStore: ISessionStore,

    @Inject(AUTH_MODULE_OPTIONS)
    private readonly options: AuthModuleOptions,
  ) {}

  async createAuthSession(user: CurrentUser): Promise<AuthTokens> {
    if (!isSessionAuthOptions(this.options)) {
      throw new Error('SessionAuthTokenService requires session auth options');
    }

    const ttlSeconds = this.options.sessionTtlSeconds;
    const sessionId = await this.sessionStore.create(user, ttlSeconds);

    return {
      sessionId,
      expiresAt: new Date(Date.now() + ttlSeconds * 1000),
    };
  }

  async verifyAccessToken(sessionId: string): Promise<CurrentUser | null> {
    return this.sessionStore.get(sessionId);
  }

  async revoke(input: RevokeAuthSessionInput): Promise<void> {
    if (!input.sessionId) {
      return;
    }

    await this.sessionStore.delete(input.sessionId);
  }

  async refreshAuthSession(_refreshToken: string): Promise<AuthTokens> {
    return Promise.reject(
      new AuthenticationError(
        'REFRESH_TOKEN_NOT_SUPPORTED',
        'Refresh token is not supported for session authentication',
      ),
    );
  }
}
