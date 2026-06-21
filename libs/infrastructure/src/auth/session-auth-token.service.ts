import { Inject, Injectable } from '@nestjs/common';
import {
  IAuthTokenService,
  RevokeAuthSessionInput,
  AuthTokens,
  ParsedRefreshToken,
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

  private sessionConfig() {
    if (!isSessionAuthOptions(this.options)) {
      throw new Error('SessionAuthTokenService requires session auth options');
    }

    return this.options;
  }

  async createAuthSession(user: CurrentUser): Promise<AuthTokens> {
    const { sessionTtlSeconds } = this.sessionConfig();

    const sessionId = await this.sessionStore.create(
      {
        userId: user.id,
        authVersion: user.authVersion,
      },
      sessionTtlSeconds,
    );

    return {
      sessionId,
      expiresAt: new Date(Date.now() + sessionTtlSeconds * 1000),
    };
  }

  async verifyAccessToken(sessionId: string): Promise<CurrentUser | null> {
    const record = await this.sessionStore.get(sessionId);

    if (!record) {
      return null;
    }

    const user = await this.sessionConfig().resolveSessionUser(record.userId);

    if (!user) {
      return null;
    }

    if (user.authVersion !== record.authVersion) {
      return null;
    }

    return user;
  }

  async revoke(input: RevokeAuthSessionInput): Promise<void> {
    if (!input.sessionId) {
      return;
    }

    await this.sessionStore.delete(input.sessionId);
  }

  async parseRefreshToken(_refreshToken: string): Promise<ParsedRefreshToken> {
    return Promise.reject(
      new AuthenticationError(
        'REFRESH_TOKEN_NOT_SUPPORTED',
        'Refresh token is not supported for session authentication',
      ),
    );
  }

  async rotateAuthSession(
    _parsed: ParsedRefreshToken,
    _freshUser: CurrentUser,
  ): Promise<AuthTokens> {
    return Promise.reject(
      new AuthenticationError(
        'REFRESH_TOKEN_NOT_SUPPORTED',
        'Refresh token is not supported for session authentication',
      ),
    );
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
