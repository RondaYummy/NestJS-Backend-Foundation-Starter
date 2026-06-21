import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import ms, { type StringValue } from 'ms';

import type {
  AuthTokens,
  IAuthTokenService,
  ParsedRefreshToken,
  RevokeAuthSessionInput,
} from '@contracts/auth/auth-token.service';
import type { CurrentUser } from '@contracts/auth/current-user';
import type { IJwtTokenStore } from '@contracts/auth/jwt-token-store.service';
import { TOKENS } from '@contracts/tokens';

import { AuthenticationError, InvalidAuthRequestError } from '@domain/errors/domain-errors';

import {
  AUTH_MODULE_OPTIONS,
  isJwtAuthOptions,
  type AuthModuleOptions,
} from './auth.module-options';

type AccessTokenPayload = CurrentUser & {
  type: 'access';
  jti: string;
  iat: number;
  exp: number;
};

type RefreshTokenPayload = CurrentUser & {
  type: 'refresh';
  jti: string;
  familyId: string;
  iat: number;
  exp: number;
};

type TokenPair = {
  accessToken: string;
  refreshToken: string;
  accessTokenId: string;
  refreshTokenId: string;
  refreshTokenTtlSeconds: number;
};

@Injectable()
export class JwtAuthTokenService implements IAuthTokenService {
  constructor(
    private readonly jwtService: JwtService,
    @Inject(AUTH_MODULE_OPTIONS)
    private readonly options: AuthModuleOptions,

    @Inject(TOKENS.JwtTokenStore)
    private readonly tokenStore: IJwtTokenStore,
  ) {}

  private jwtConfig() {
    if (!isJwtAuthOptions(this.options)) {
      throw new Error('JwtAuthTokenService requires JWT auth options');
    }

    return this.options.jwt;
  }

  async createAuthSession(user: CurrentUser): Promise<AuthTokens> {
    const familyId = randomUUID();

    const pair = await this.issueTokenPair(user, familyId);

    await this.tokenStore.saveRefreshToken({
      tokenId: pair.refreshTokenId,
      familyId,
      record: {
        userId: user.id,
        familyId,
      },
      ttlSeconds: pair.refreshTokenTtlSeconds,
    });

    return {
      accessToken: pair.accessToken,
      refreshToken: pair.refreshToken,
    };
  }

  async verifyAccessToken(token: string): Promise<CurrentUser | null> {
    try {
      const payload = await this.jwtService.verifyAsync<AccessTokenPayload>(token, {
        secret: this.jwtConfig().secret,
      });

      if (payload.type !== 'access' || !payload.jti) {
        return null;
      }

      const revoked = await this.tokenStore.isAccessTokenRevoked(payload.jti);

      if (revoked) {
        return null;
      }

      const user = this.toCurrentUser(payload);

      if (isJwtAuthOptions(this.options) && this.options.resolveAccessUser) {
        const freshUser = await this.options.resolveAccessUser(user.id);

        if (!freshUser || freshUser.authVersion !== user.authVersion) {
          return null;
        }

        return freshUser;
      }

      return user;
    } catch {
      return null;
    }
  }

  async parseRefreshToken(refreshToken: string): Promise<ParsedRefreshToken> {
    const payload = await this.verifyRefreshTokenPayload(refreshToken);

    return {
      userId: payload.id,
      familyId: payload.familyId,
      tokenId: payload.jti,
      authVersion: payload.authVersion ?? 0,
    };
  }

  async rotateAuthSession(parsed: ParsedRefreshToken, freshUser: CurrentUser): Promise<AuthTokens> {
    const nextPair = await this.issueTokenPair(freshUser, parsed.familyId);

    const rotated = await this.tokenStore.rotateRefreshToken({
      currentTokenId: parsed.tokenId,
      nextTokenId: nextPair.refreshTokenId,
      familyId: parsed.familyId,
      nextRecord: {
        userId: parsed.userId,
        familyId: parsed.familyId,
      },
      ttlSeconds: nextPair.refreshTokenTtlSeconds,
    });

    if (!rotated) {
      /**
       * Старий refresh token уже був використаний
       * або відкликаний.
       *
       * Це може означати replay attack.
       * Відкликаємо поточний token family.
       */
      await this.tokenStore.revokeRefreshTokenFamily(parsed.familyId);

      throw new AuthenticationError(
        'REFRESH_TOKEN_USED_OR_REVOKED',
        'Refresh token has already been used or revoked',
      );
    }

    return {
      accessToken: nextPair.accessToken,
      refreshToken: nextPair.refreshToken,
    };
  }

  refreshAuthSession(_refreshToken: string): Promise<AuthTokens> {
    return Promise.reject(
      new InvalidAuthRequestError(
        'REFRESH_ORCHESTRATION_REQUIRED',
        'Use RefreshAuthSessionUseCase to refresh with fresh user authorization data',
      ),
    );
  }

  private async tryVerifyAccessTokenForRevocation(
    token: string,
  ): Promise<AccessTokenPayload | null> {
    try {
      const payload = await this.jwtService.verifyAsync<AccessTokenPayload>(token, {
        secret: this.jwtConfig().secret,
        ignoreExpiration: true,
      });

      if (payload.type !== 'access' || !payload.jti) {
        return null;
      }

      return payload;
    } catch {
      return null;
    }
  }

  async revoke(input: RevokeAuthSessionInput): Promise<void> {
    if (!input.refreshToken) {
      throw new InvalidAuthRequestError(
        'REFRESH_TOKEN_REQUIRED',
        'Refresh token is required for JWT logout',
      );
    }

    const refreshPayload = await this.verifyRefreshTokenForRevocation(input.refreshToken);

    let accessPayload: AccessTokenPayload | null = null;

    if (input.accessToken) {
      accessPayload = await this.tryVerifyAccessTokenForRevocation(input.accessToken);

      if (accessPayload && accessPayload.id !== refreshPayload.id) {
        throw new AuthenticationError(
          'ACCESS_TOKEN_AND_REFRESH_TOKEN_DO_NOT_BELONG_TO_THE_SAME_USER',
          'Access token and refresh token do not belong to the same user',
        );
      }
    }

    await this.tokenStore.revokeRefreshTokenFamily(refreshPayload.familyId);

    if (!accessPayload) {
      return;
    }

    const ttlSeconds = this.getRemainingTtlSeconds(accessPayload.exp);

    await this.tokenStore.revokeAccessToken(accessPayload.jti, ttlSeconds);
  }

  private async issueTokenPair(user: CurrentUser, familyId: string): Promise<TokenPair> {
    const accessTokenId = randomUUID();
    const refreshTokenId = randomUUID();

    const jwtConfig = this.jwtConfig();
    const accessExpiresIn = jwtConfig.expiresIn;
    const refreshExpiresIn = jwtConfig.refreshExpiresIn;

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(
        {
          id: user.id,
          email: user.email,
          roles: user.roles,
          authVersion: user.authVersion,
          type: 'access',
          jti: accessTokenId,
        },
        {
          expiresIn: accessExpiresIn as StringValue,
          secret: this.jwtConfig().secret,
        },
      ),

      this.jwtService.signAsync(
        {
          id: user.id,
          email: user.email,
          roles: user.roles,
          authVersion: user.authVersion,
          type: 'refresh',
          jti: refreshTokenId,
          familyId,
        },
        {
          expiresIn: refreshExpiresIn as StringValue,
          secret: this.jwtConfig().refreshSecret,
        },
      ),
    ]);

    return {
      accessToken,
      refreshToken,
      accessTokenId,
      refreshTokenId,
      refreshTokenTtlSeconds: this.parseDurationToSeconds(refreshExpiresIn),
    };
  }

  private async verifyRefreshTokenPayload(refreshToken: string): Promise<RefreshTokenPayload> {
    try {
      const payload = await this.jwtService.verifyAsync<RefreshTokenPayload>(refreshToken, {
        secret: this.jwtConfig().refreshSecret,
      });

      if (payload.type !== 'refresh' || !payload.jti || !payload.familyId) {
        throw new AuthenticationError('INVALID_REFRESH_TOKEN', 'Invalid refresh token');
      }

      return payload;
    } catch (error) {
      if (error instanceof AuthenticationError) {
        throw error;
      }

      throw new AuthenticationError('INVALID_REFRESH_TOKEN', 'Invalid or expired refresh token');
    }
  }

  private async verifyRefreshTokenForRevocation(token: string): Promise<RefreshTokenPayload> {
    return this.verifyRefreshTokenPayload(token);
  }

  private getRemainingTtlSeconds(expiresAt: number): number {
    const currentTimestamp = Math.floor(Date.now() / 1000);

    return Math.max(expiresAt - currentTimestamp, 0);
  }

  private parseDurationToSeconds(value: string): number {
    const durationMilliseconds = ms(value as StringValue);

    if (typeof durationMilliseconds !== 'number' || durationMilliseconds <= 0) {
      throw new Error(`Invalid JWT duration: ${value}`);
    }

    return Math.ceil(durationMilliseconds / 1000);
  }

  private toCurrentUser(payload: CurrentUser & { authVersion?: number }): CurrentUser {
    return {
      id: payload.id,
      email: payload.email,
      roles: payload.roles,
      authVersion: payload.authVersion ?? 0,
    };
  }
}
