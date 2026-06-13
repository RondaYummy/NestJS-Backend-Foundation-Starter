import { randomUUID } from 'node:crypto';

import { BadRequestException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import ms, { type StringValue } from 'ms';

import type {
  AuthTokens,
  IAuthTokenService,
  RevokeAuthSessionInput,
} from '@contracts/auth/auth-token.service';
import type { CurrentUser } from '@contracts/auth/current-user';
import type { IJwtTokenStore } from '@contracts/auth/jwt-token-store.service';
import { TOKENS } from '@contracts/tokens';

import { AppConfigService } from '../config/app-config.service';

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
    private readonly config: AppConfigService,

    @Inject(TOKENS.JwtTokenStore)
    private readonly tokenStore: IJwtTokenStore,
  ) {}

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
        secret: this.config.jwt().secret,
      });

      if (payload.type !== 'access' || !payload.jti) {
        return null;
      }

      const revoked = await this.tokenStore.isAccessTokenRevoked(payload.jti);

      if (revoked) {
        return null;
      }

      return this.toCurrentUser(payload);
    } catch {
      return null;
    }
  }

  async refreshAuthSession(refreshToken: string): Promise<AuthTokens> {
    let payload: RefreshTokenPayload;

    try {
      payload = await this.jwtService.verifyAsync<RefreshTokenPayload>(refreshToken, {
        secret: this.config.jwt().refreshSecret,
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    if (payload.type !== 'refresh' || !payload.jti || !payload.familyId) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const user = this.toCurrentUser(payload);

    const nextPair = await this.issueTokenPair(user, payload.familyId);

    const rotated = await this.tokenStore.rotateRefreshToken({
      currentTokenId: payload.jti,
      nextTokenId: nextPair.refreshTokenId,
      familyId: payload.familyId,
      nextRecord: {
        userId: payload.id,
        familyId: payload.familyId,
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
      await this.tokenStore.revokeRefreshTokenFamily(payload.familyId);

      throw new UnauthorizedException('Refresh token has already been used or revoked');
    }

    return {
      accessToken: nextPair.accessToken,
      refreshToken: nextPair.refreshToken,
    };
  }

  private async tryVerifyAccessTokenForRevocation(
    token: string,
  ): Promise<AccessTokenPayload | null> {
    try {
      const payload = await this.jwtService.verifyAsync<AccessTokenPayload>(token, {
        secret: this.config.jwt().secret,
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
      throw new BadRequestException('Refresh token is required for JWT logout');
    }

    const refreshPayload = await this.verifyRefreshTokenForRevocation(input.refreshToken);

    let accessPayload: AccessTokenPayload | null = null;

    if (input.accessToken) {
      accessPayload = await this.tryVerifyAccessTokenForRevocation(input.accessToken);

      if (accessPayload && accessPayload.id !== refreshPayload.id) {
        throw new UnauthorizedException(
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

    const accessExpiresIn = this.config.jwt().expiresIn;

    const refreshExpiresIn = this.config.jwt().refreshExpiresIn;

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(
        {
          id: user.id,
          email: user.email,
          roles: user.roles,
          type: 'access',
          jti: accessTokenId,
        },
        {
          expiresIn: accessExpiresIn as StringValue,
          secret: this.config.jwt().secret,
        },
      ),

      this.jwtService.signAsync(
        {
          id: user.id,
          email: user.email,
          roles: user.roles,
          type: 'refresh',
          jti: refreshTokenId,
          familyId,
        },
        {
          expiresIn: refreshExpiresIn as StringValue,
          secret: this.config.jwt().refreshSecret,
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

  private async verifyRefreshTokenForRevocation(token: string): Promise<RefreshTokenPayload> {
    try {
      const payload = await this.jwtService.verifyAsync<RefreshTokenPayload>(token, {
        secret: this.config.jwt().refreshSecret,
      });

      if (payload.type !== 'refresh' || !payload.jti || !payload.familyId) {
        throw new UnauthorizedException('Invalid refresh token');
      }

      return payload;
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }

      throw new UnauthorizedException('Invalid or expired refresh token');
    }
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

  private toCurrentUser(payload: CurrentUser): CurrentUser {
    return {
      id: payload.id,
      email: payload.email,
      roles: payload.roles,
    };
  }
}
