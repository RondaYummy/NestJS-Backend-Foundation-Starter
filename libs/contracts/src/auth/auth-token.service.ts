import type { CurrentUser } from './current-user';

export interface AuthTokens {
  accessToken?: string;
  refreshToken?: string;
  sessionId?: string;
  expiresAt?: Date;
}

export interface IAuthTokenService {
  createAuthSession(user: CurrentUser): Promise<AuthTokens>;

  refreshAuthSession(refreshToken: string): Promise<AuthTokens>;

  verifyAccessToken(token: string): Promise<CurrentUser | null>;

  revoke(tokenOrSessionId: string): Promise<void>;
}
