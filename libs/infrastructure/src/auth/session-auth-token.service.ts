import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { AppConfigService } from '../config/app-config.service';
import {
  IAuthTokenService,
  RevokeAuthSessionInput,
  AuthTokens,
} from '@contracts/auth/auth-token.service';
import { ISessionStore } from '@contracts/auth/session-store.service';
import { TOKENS } from '@contracts/tokens';
import { CurrentUser } from '@contracts/auth/current-user';

@Injectable()
export class SessionAuthTokenService implements IAuthTokenService {
  constructor(
    @Inject(TOKENS.SessionStore)
    private readonly sessionStore: ISessionStore,

    private readonly config: AppConfigService,
  ) {}

  async createAuthSession(user: CurrentUser): Promise<AuthTokens> {
    const ttlSeconds = this.config.auth().sessionTtlSeconds;
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
      new UnauthorizedException('Refresh token is not supported for session authentication'),
    );
  }
}
