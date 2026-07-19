import { Body, Controller, Get, Post, Req, Res, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiHeader,
  ApiInternalServerErrorResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
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
import { LogoutDto } from '../dto/auth/logout.dto';
import { AppLogger } from '@infrastructure/logger/app-logger.service';
import { SessionCookieService } from '../auth/session-cookie.service';
import {
  CurrentUserResponseDto,
  LoginResponseDto,
  LogoutResponseDto,
  RefreshResponseDto,
  RegisterResponseDto,
} from '../dto/auth/auth-response.dto';
import { ErrorEnvelopeDto } from '../dto/common/error-envelope.dto';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly registerUseCase: RegisterUseCase,
    private readonly loginUseCase: LoginUseCase,
    private readonly logoutUseCase: LogoutUseCase,
    private readonly getCurrentUserUseCase: GetCurrentUserUseCase,
    private readonly refreshAuthSessionUseCase: RefreshAuthSessionUseCase,
    private readonly sessionCookieService: SessionCookieService,
    private readonly logger: AppLogger,
  ) {}

  @UseGuards(RateLimiterGuard)
  @RateLimit({ keyPrefix: 'auth:register' })
  @ApiOperation({
    summary: 'Register a user account',
    description:
      'Creates an account but does not authenticate it. Call POST /v1/auth/login afterwards to receive JWT tokens or a session cookie.',
  })
  @ApiCreatedResponse({
    description: 'Account created. No auth tokens or session cookie are issued.',
    type: RegisterResponseDto,
  })
  @ApiBadRequestResponse({ description: 'Request validation failed.', type: ErrorEnvelopeDto })
  @ApiConflictResponse({ description: 'The email is already registered.', type: ErrorEnvelopeDto })
  @ApiTooManyRequestsResponse({
    description: 'Registration rate limit exceeded.',
    type: ErrorEnvelopeDto,
  })
  @ApiInternalServerErrorResponse({
    description: 'Unexpected server error.',
    type: ErrorEnvelopeDto,
  })
  @Post('register')
  async register(@Body() dto: RegisterDto) {
    const result = await this.registerUseCase.execute(dto);

    return {
      success: true,
      data: result,
    };
  }

  @UseGuards(RateLimiterGuard)
  @RateLimit({ keyPrefix: 'auth:login' })
  @ApiOperation({
    summary: 'Authenticate with email and password',
    description:
      'With AUTH_DRIVER=jwt, data.auth contains accessToken and refreshToken. With AUTH_DRIVER=session, data.auth contains session metadata and the response sets the configured httpOnly session cookie.',
  })
  @ApiCreatedResponse({
    description: 'Authenticated using the configured auth driver.',
    type: LoginResponseDto,
    headers: {
      'Set-Cookie': {
        description:
          'Set only when AUTH_DRIVER=session. Cookie name follows AUTH_SESSION_COOKIE_NAME (default sid).',
        schema: { type: 'string', example: 'sid=<session-id>; Path=/; HttpOnly; SameSite=Lax' },
      },
    },
  })
  @ApiBadRequestResponse({
    description: 'Request validation failed or credentials are invalid.',
    type: ErrorEnvelopeDto,
  })
  @ApiTooManyRequestsResponse({ description: 'Login rate limit exceeded.', type: ErrorEnvelopeDto })
  @ApiInternalServerErrorResponse({
    description: 'Unexpected server error.',
    type: ErrorEnvelopeDto,
  })
  @Post('login')
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.loginUseCase.execute(dto);

    this.sessionCookieService.attachIfNeeded(res, result.auth);

    return {
      success: true,
      data: result,
    };
  }

  @ApiOperation({
    summary: 'Revoke an auth session',
    description:
      'Does not require a valid access token. JWT mode requires the refreshToken body to revoke its token family and optionally accepts a Bearer token for access-token blacklisting. Session mode uses and clears the configured session cookie.',
  })
  @ApiHeader({
    name: 'Authorization',
    required: false,
    description: 'Optional Bearer access token to blacklist in JWT mode.',
  })
  @ApiCreatedResponse({
    description: 'Auth session revoked; session mode also clears its cookie.',
    type: LogoutResponseDto,
    headers: {
      'Set-Cookie': {
        description: 'Session cookie expiration header when AUTH_DRIVER=session.',
        schema: { type: 'string', example: 'sid=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax' },
      },
    },
  })
  @ApiBadRequestResponse({
    description: 'JWT mode requires refreshToken when no session cookie is used.',
    type: ErrorEnvelopeDto,
  })
  @ApiUnauthorizedResponse({
    description: 'Provided auth credential is invalid.',
    type: ErrorEnvelopeDto,
  })
  @ApiInternalServerErrorResponse({
    description: 'Unexpected server error.',
    type: ErrorEnvelopeDto,
  })
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

    this.sessionCookieService.clear(res);

    return {
      success: true,
    };
  }

  @UseGuards(RateLimiterGuard)
  @RateLimit({
    keyPrefix: 'auth:refresh',
    limit: 10,
    ttlSeconds: 60,
  })
  @ApiOperation({
    summary: 'Rotate JWT access and refresh tokens',
    description:
      'JWT-only endpoint. A successful call invalidates the previous refresh token and returns a new pair. AUTH_DRIVER=session rejects this operation with REFRESH_TOKEN_NOT_SUPPORTED.',
  })
  @ApiCreatedResponse({
    description: 'JWT token pair rotated.',
    type: RefreshResponseDto,
  })
  @ApiBadRequestResponse({ description: 'Request validation failed.', type: ErrorEnvelopeDto })
  @ApiUnauthorizedResponse({
    description:
      'Refresh is unsupported in session mode, or the token is invalid, stale, or replayed.',
    type: ErrorEnvelopeDto,
  })
  @ApiTooManyRequestsResponse({
    description: 'Refresh rate limit exceeded.',
    type: ErrorEnvelopeDto,
  })
  @ApiInternalServerErrorResponse({
    description: 'Unexpected server error.',
    type: ErrorEnvelopeDto,
  })
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

  @UseGuards(AuthGuard, RateLimiterGuard)
  @RateLimit({
    keyPrefix: 'auth:me',
    limit: 3,
    ttlSeconds: 300,
  })
  @ApiOperation({
    summary: 'Get the current user',
    description:
      'Requires either a Bearer JWT access token (AUTH_DRIVER=jwt) or the configured session cookie (AUTH_DRIVER=session).',
  })
  @ApiBearerAuth('bearerAuth')
  @ApiCookieAuth('sessionCookie')
  @ApiResponse({ status: 200, description: 'Current user profile.', type: CurrentUserResponseDto })
  @ApiUnauthorizedResponse({
    description: 'Authentication is missing or invalid.',
    type: ErrorEnvelopeDto,
  })
  @ApiNotFoundResponse({
    description: 'The authenticated user no longer exists.',
    type: ErrorEnvelopeDto,
  })
  @ApiTooManyRequestsResponse({
    description: 'Current-user rate limit exceeded.',
    type: ErrorEnvelopeDto,
  })
  @ApiInternalServerErrorResponse({
    description: 'Unexpected server error.',
    type: ErrorEnvelopeDto,
  })
  @Get('me')
  async me(@CurrentUser() user: RequestUser) {
    const result = await this.getCurrentUserUseCase.execute(user.id);

    this.logger.info('Auth me request', {
      userId: user.id,
    });

    return {
      success: true,
      data: result,
    };
  }

  private extractSessionId(req: Request): string | null {
    const request = req as Request & {
      cookies?: Record<string, unknown>;
    };

    return this.sessionCookieService.getSessionIdFromCookies(request.cookies);
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
