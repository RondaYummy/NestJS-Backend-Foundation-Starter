import type { CurrentUser } from './current-user';

export interface AuthTokens {
  accessToken?: string;
  refreshToken?: string;
  sessionId?: string;
  expiresAt?: Date;
}

export interface ParsedRefreshToken {
  userId: string;
  familyId: string;
  tokenId: string;
  authVersion: number;
}

export interface RevokeAuthSessionInput {
  /**
   * JWT access token.
   */
  accessToken?: string;

  /**
   * JWT refresh token.
   */
  refreshToken?: string;

  /**
   * Redis session ID для AUTH_DRIVER=session.
   */
  sessionId?: string;
}

export interface IAuthTokenService {
  createAuthSession(user: CurrentUser): Promise<AuthTokens>;

  parseRefreshToken(refreshToken: string): Promise<ParsedRefreshToken>;

  rotateAuthSession(parsed: ParsedRefreshToken, freshUser: CurrentUser): Promise<AuthTokens>;

  refreshAuthSession(refreshToken: string): Promise<AuthTokens>;

  verifyAccessToken(tokenOrSessionId: string): Promise<CurrentUser | null>;

  revoke(input: RevokeAuthSessionInput): Promise<void>;
}
