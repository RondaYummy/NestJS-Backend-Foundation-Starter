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
  
  @Injectable()
  export class AuthGuard implements CanActivate {
    constructor(
      @Inject(TOKENS.AuthTokenService)
      private readonly authTokenService: IAuthTokenService,
    ) {}
  
    async canActivate(context: ExecutionContext): Promise<boolean> {
      const request = context.switchToHttp().getRequest<
        Request & { user?: RequestUser }
      >();
  
      const tokenOrSessionId = this.extractTokenOrSessionId(request);
  
      if (!tokenOrSessionId) {
        throw new UnauthorizedException('Unauthorized');
      }
  
      const user = await this.authTokenService.verifyAccessToken(tokenOrSessionId);
  
      if (!user) {
        throw new UnauthorizedException('Unauthorized');
      }
  
      request.user = user;
  
      return true;
    }
  
    private extractTokenOrSessionId(request: Request): string | null {
      const authorization = request.headers.authorization;
  
      if (authorization?.startsWith('Bearer ')) {
        return authorization.replace('Bearer ', '').trim();
      }
  
      const cookieHeader = request.headers.cookie;
  
      if (!cookieHeader) {
        return null;
      }
  
      const cookies = Object.fromEntries(
        cookieHeader.split(';').map((cookie) => {
          const [key, ...value] = cookie.trim().split('=');
          return [key, decodeURIComponent(value.join('='))];
        }),
      );
  
      return cookies.sid ?? null;
    }
  }