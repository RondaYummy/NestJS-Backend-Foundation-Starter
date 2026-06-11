import { Inject, Injectable } from '@nestjs/common';
import { AppConfigService } from '../config/app-config.service';
import { IAuthTokenService } from '@contracts/auth/auth-token.service';
import { ISessionStore } from '@contracts/auth/session-store.service';
import { TOKENS } from '@contracts/tokens';
import { CurrentUser } from '@contracts/auth/current-user';
import { AuthTokens } from '@contracts/auth/auth-token.service';

@Injectable()
export class SessionAuthTokenService implements IAuthTokenService {
  constructor(
    @Inject(TOKENS.SessionStore)
    private readonly sessionStore: ISessionStore,

    private readonly config: AppConfigService,
  ) {}

  async createAuthSession(user: CurrentUser): Promise<AuthTokens> {
    const ttlSeconds = this.config.getNumber('auth.sessionTtlSeconds');
    const sessionId = await this.sessionStore.create(user, ttlSeconds);

    return {
      sessionId,
      expiresAt: new Date(Date.now() + ttlSeconds * 1000),
    };
  }

  async verifyAccessToken(sessionId: string): Promise<CurrentUser | null> {
    return this.sessionStore.get(sessionId);
  }

  async revoke(sessionId: string): Promise<void> {
    await this.sessionStore.delete(sessionId);
  }

  async refreshAuthSession(_refreshToken: string): Promise<AuthTokens> {
    throw new Error('Refresh token is not supported for session authentication');
  }
}
