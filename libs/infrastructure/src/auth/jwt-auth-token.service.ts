import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { StringValue } from 'ms';

import { AppConfigService } from '../config/app-config.service';
import { CurrentUser } from '@contracts/auth/current-user';
import { AuthTokens, IAuthTokenService } from '@contracts/auth/auth-token.service';

@Injectable()
export class JwtAuthTokenService implements IAuthTokenService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly config: AppConfigService,
  ) {}

  async createAuthSession(user: CurrentUser): Promise<AuthTokens> {
    const accessToken = await this.jwtService.signAsync(
      {
        id: user.id,
        email: user.email,
        roles: user.roles,
      },
      {
        expiresIn: this.config.getString('jwt.expiresIn') as StringValue,
        secret: this.config.getString('jwt.secret'),
      },
    );

    const refreshToken = await this.jwtService.signAsync(
      {
        id: user.id,
        email: user.email,
        roles: user.roles,
        type: 'refresh',
      },
      {
        expiresIn: this.config.getString('jwt.refreshExpiresIn') as StringValue,
        secret: this.config.getString('jwt.refreshSecret'),
      },
    );

    return {
      accessToken,
      refreshToken,
    };
  }

  async verifyAccessToken(token: string): Promise<CurrentUser | null> {
    try {
      return await this.jwtService.verifyAsync<CurrentUser>(token, {
        secret: this.config.getString('jwt.secret'),
      });
    } catch {
      return null;
    }
  }
}