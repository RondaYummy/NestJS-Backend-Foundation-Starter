import { Body, Controller, Get, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { LoginDto } from '../dto/auth/login.dto';
import { RegisterUseCase } from '@application/use-cases/auth/register.usecase';
import { LoginUseCase } from '@application/use-cases/auth/login.usecase';
import { GetCurrentUserUseCase } from '@application/use-cases/auth/get-current-user.usecase';
import { CurrentUser } from '../decorators/current-user.decorator';
import { RequestUser } from '../types/request-user.type';
import { AuthGuard } from '../guards/auth.guard';
import { RegisterDto } from '../dto/auth/register.dto';
import { RateLimit } from '@infrastructure/rate-limiter/rate-limit.decorator';
import { RateLimiterGuard } from '@infrastructure/rate-limiter/rate-limiter.guard';
import { LogoutUseCase } from '@application/use-cases/auth/logout.usecase';
import { RefreshAuthSessionUseCase } from '@application/use-cases/auth/refresh-auth-session.usecase';
import { RefreshTokenDto } from '../dto/auth/refresh-token.dto';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly registerUseCase: RegisterUseCase,
    private readonly loginUseCase: LoginUseCase,
    private readonly logoutUseCase: LogoutUseCase,
    private readonly getCurrentUserUseCase: GetCurrentUserUseCase,
    private readonly refreshAuthSessionUseCase: RefreshAuthSessionUseCase,
  ) {}

  @UseGuards(RateLimiterGuard)
  @RateLimit({ keyPrefix: 'auth:register' })
  @Post('register')
  async register(@Body() dto: RegisterDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.registerUseCase.execute(dto);

    this.attachSessionCookieIfNeeded(res, result.auth);

    return {
      success: true,
      data: result,
    };
  }

  @UseGuards(RateLimiterGuard)
  @RateLimit({ keyPrefix: 'auth:login' })
  @Post('login')
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.loginUseCase.execute(dto);

    this.attachSessionCookieIfNeeded(res, result.auth);

    return {
      success: true,
      data: result,
    };
  }

  @UseGuards(AuthGuard)
  @Post('logout')
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ success: true }> {
    const token = this.extractAuthToken(req);

    if (token) {
      await this.logoutUseCase.execute(token);
    }

    res.clearCookie('sid', {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
    });

    return {
      success: true,
    };
  }

  @Post('refresh')
  async refresh(@Body() dto: RefreshTokenDto): Promise<{
    success: true;
    data: Awaited<ReturnType<RefreshAuthSessionUseCase['execute']>>;
  }> {
    const result = await this.refreshAuthSessionUseCase.execute(dto.refreshToken);

    return {
      success: true,
      data: result,
    };
  }

  @UseGuards(RateLimiterGuard)
  @RateLimit({ keyPrefix: 'auth:me', limit: 3, ttlSeconds: 300 })
  @UseGuards(AuthGuard)
  @Get('me')
  async me(@CurrentUser() user: RequestUser) {
    const result = await this.getCurrentUserUseCase.execute(user.id);

    return {
      success: true,
      data: result,
    };
  }

  private attachSessionCookieIfNeeded(
    res: Response,
    auth: {
      accessToken?: string;
      refreshToken?: string;
      sessionId?: string;
      expiresAt?: Date;
    },
  ): void {
    if (!auth.sessionId) {
      return;
    }

    res.cookie('sid', auth.sessionId, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      expires: auth.expiresAt,
    });
  }

  private extractAuthToken(req: Request): string | null {
    const sessionId = (req as Request & { cookies?: { sid?: string } }).cookies?.sid;

    if (sessionId) {
      return sessionId;
    }

    const authorization = (req as Request & { headers?: { authorization?: string } }).headers
      ?.authorization;

    if (!authorization?.startsWith('Bearer ')) {
      return null;
    }

    return authorization.slice('Bearer '.length);
  }
}
