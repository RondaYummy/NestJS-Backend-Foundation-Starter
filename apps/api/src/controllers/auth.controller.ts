import { Body, Controller, Get, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
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
import { ConfigService } from '@nestjs/config';
import { LogoutDto } from '../dto/auth/logout.dto';
import { AppLogger } from '@infrastructure/logger/app-logger.service';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly registerUseCase: RegisterUseCase,
    private readonly loginUseCase: LoginUseCase,
    private readonly logoutUseCase: LogoutUseCase,
    private readonly getCurrentUserUseCase: GetCurrentUserUseCase,
    private readonly refreshAuthSessionUseCase: RefreshAuthSessionUseCase,
    private readonly config: ConfigService,
    private readonly logger: AppLogger,
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
    @Body() dto: LogoutDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ success: true }> {
    const sessionId = this.extractSessionId(req);

    const accessToken = this.extractBearerToken(req);

    await this.logoutUseCase.execute({
      sessionId: sessionId ?? undefined,
      accessToken: accessToken ?? undefined,
      refreshToken: dto.refreshToken,
    });

    res.clearCookie('sid', {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.config.get<string>('app.env') === 'production',
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
  async me( @Req() req: Request, @CurrentUser() user: RequestUser) {
    const result = await this.getCurrentUserUseCase.execute(user.id);

    this.logger.log({
      message: 'Auth me request',
      requestId: req.requestId,
    });

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
      secure: this.config.get<string>('app.env') === 'production',
      expires: auth.expiresAt,
    });
  }

  private extractSessionId(req: Request): string | null {
    const request = req as Request & {
      cookies?: {
        sid?: string;
      };
    };

    return request.cookies?.sid ?? null;
  }

  private extractBearerToken(req: Request): string | null {
    const authorization = req.get('authorization');

    if (!authorization?.startsWith('Bearer ')) {
      return null;
    }

    const token = authorization.slice('Bearer '.length).trim();

    return token || null;
  }
}
