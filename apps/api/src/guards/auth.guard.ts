import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import type { RequestUser } from '../types/request-user.type';
import { IAuthTokenService } from '@contracts/auth/auth-token.service';
import { TOKENS } from '@contracts/tokens';
import { RequestContextService } from '@infrastructure/logger/request-context.service';
import { AppConfigService } from '@infrastructure/config/app-config.service';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(TOKENS.AuthTokenService)
    private readonly authTokenService: IAuthTokenService,

    private readonly requestContext: RequestContextService,

    private readonly config: AppConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & { user?: RequestUser }>();

    const tokenOrSessionId = this.extractTokenOrSessionId(request);

    if (!tokenOrSessionId) {
      throw new UnauthorizedException('Unauthorized');
    }

    const user = await this.authTokenService.verifyAccessToken(tokenOrSessionId);

    if (!user) {
      throw new UnauthorizedException('Unauthorized');
    }

    request.user = user;

    this.requestContext.setUserId(user.id);

    return true;
  }

  private extractTokenOrSessionId(request: Request): string | null {
    const authorization = request.headers.authorization;

    if (authorization?.startsWith('Bearer ')) {
      const token = authorization.slice('Bearer '.length).trim();

      return token || null;
    }

    const requestWithCookies = request as Request & {
      cookies?: Record<string, unknown>;
    };

    const cookieName = this.config.auth().sessionCookieName;
    const sessionId = requestWithCookies.cookies?.[cookieName];

    return typeof sessionId === 'string' && sessionId.length > 0 ? sessionId : null;
  }
}
