import { Controller, Get, Query, Req, Res, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiInternalServerErrorResponse,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { CookieOptions, Request, Response } from 'express';

import { CompleteGoogleSignInUseCase } from '@application/use-cases/auth/complete-google-sign-in.usecase';
import { AppConfigService } from '@infrastructure/config/app-config.service';
import { AppLogger } from '@infrastructure/logger/app-logger.service';
import { RateLimit } from '@infrastructure/rate-limiter/rate-limit.decorator';
import { RateLimiterGuard } from '@infrastructure/rate-limiter/rate-limiter.guard';

import { GoogleSsoFlowService } from '../auth/google-sso-flow.service';
import { SessionCookieService } from '../auth/session-cookie.service';
import { LoginResponseDto } from '../dto/auth/auth-response.dto';
import {
  GoogleSsoCallbackQueryDto,
  GoogleSsoStartQueryDto,
} from '../dto/auth/google-sso-query.dto';
import { ErrorEnvelopeDto } from '../dto/common/error-envelope.dto';

export const GOOGLE_OAUTH_STATE_COOKIE = 'g_oauth_state';

@ApiTags('Auth')
@Controller('auth/google')
export class GoogleAuthController {
  constructor(
    private readonly googleSsoFlowService: GoogleSsoFlowService,
    private readonly completeGoogleSignInUseCase: CompleteGoogleSignInUseCase,
    private readonly sessionCookieService: SessionCookieService,
    private readonly config: AppConfigService,
    private readonly logger: AppLogger,
  ) {}

  @UseGuards(RateLimiterGuard)
  @RateLimit({ keyPrefix: 'auth:google' })
  @ApiOperation({
    summary: 'Start Google SSO (authorization-code redirect)',
    description:
      'Public endpoint. Issues a one-time CSRF state (httpOnly cookie g_oauth_state plus a server-side record) and redirects (302) to the Google authorization endpoint. Optional returnUrl query must be an absolute URL whose origin is listed in CORS_ORIGINS; it is honored after the callback only when AUTH_DRIVER=session. Returns 503 with code GOOGLE_SSO_DISABLED when GOOGLE_SSO_ENABLED=false (Google is never contacted). Error codes: INVALID_RETURN_URL, GOOGLE_SSO_DISABLED.',
  })
  @ApiResponse({
    status: 302,
    description: 'Redirect to the Google OAuth 2.0 authorization endpoint.',
    headers: {
      Location: {
        description: 'Google authorization URL (response_type=code, scope=openid email profile).',
        schema: { type: 'string' },
      },
      'Set-Cookie': {
        description: 'One-time CSRF state cookie g_oauth_state (httpOnly, SameSite=Lax).',
        schema: {
          type: 'string',
          example: 'g_oauth_state=<state>; Path=/; HttpOnly; SameSite=Lax',
        },
      },
    },
  })
  @ApiBadRequestResponse({
    description:
      'returnUrl is not an absolute URL with an origin allowlisted in CORS_ORIGINS (INVALID_RETURN_URL).',
    type: ErrorEnvelopeDto,
  })
  @ApiTooManyRequestsResponse({
    description: 'Google SSO rate limit exceeded.',
    type: ErrorEnvelopeDto,
  })
  @ApiServiceUnavailableResponse({
    description: 'Google SSO is disabled (GOOGLE_SSO_DISABLED).',
    type: ErrorEnvelopeDto,
  })
  @ApiInternalServerErrorResponse({
    description: 'Unexpected server error.',
    type: ErrorEnvelopeDto,
  })
  @Get()
  async start(@Query() query: GoogleSsoStartQueryDto, @Res() res: Response): Promise<void> {
    const flow = await this.googleSsoFlowService.start(query.returnUrl);

    res.cookie(GOOGLE_OAUTH_STATE_COOKIE, flow.state, this.stateCookieOptions(flow.stateTtlSeconds));

    this.logger.info('Google SSO flow started');

    res.redirect(302, flow.authorizationUrl);
  }

  @UseGuards(RateLimiterGuard)
  @RateLimit({ keyPrefix: 'auth:google-callback' })
  @ApiOperation({
    summary: 'Complete Google SSO callback',
    description:
      'Public endpoint called by Google with code and state. The state must match the g_oauth_state cookie and the one-time server-side record. On success the response matches POST /v1/auth/login for the active AUTH_DRIVER: JSON 200 with the login envelope, plus the httpOnly session cookie when AUTH_DRIVER=session. When AUTH_DRIVER=session and the flow started with an allowlisted returnUrl, the response is a 302 redirect to that URL after setting the session cookie (tokens are never placed in URLs). Error codes: GOOGLE_SSO_DISABLED (503), GOOGLE_SSO_INVALID_STATE (400), GOOGLE_SSO_TOKEN_EXCHANGE_FAILED (401), GOOGLE_SSO_EMAIL_UNVERIFIED (401), GOOGLE_SSO_HOSTED_DOMAIN_MISMATCH (401).',
  })
  @ApiOkResponse({
    description:
      'Signed in with Google using the configured auth driver; same envelope as POST /v1/auth/login.',
    type: LoginResponseDto,
    headers: {
      'Set-Cookie': {
        description:
          'Set only when AUTH_DRIVER=session. Cookie name follows AUTH_SESSION_COOKIE_NAME (default sid).',
        schema: { type: 'string', example: 'sid=<session-id>; Path=/; HttpOnly; SameSite=Lax' },
      },
    },
  })
  @ApiResponse({
    status: 302,
    description:
      'Only when AUTH_DRIVER=session and the flow started with an allowlisted returnUrl: redirect to that URL after setting the session cookie.',
    headers: {
      Location: {
        description: 'The allowlisted returnUrl captured at flow start.',
        schema: { type: 'string' },
      },
      'Set-Cookie': {
        description: 'Session cookie (AUTH_SESSION_COOKIE_NAME).',
        schema: { type: 'string', example: 'sid=<session-id>; Path=/; HttpOnly; SameSite=Lax' },
      },
    },
  })
  @ApiBadRequestResponse({
    description:
      'The OAuth state is missing, mismatched, expired, or already used, or the authorization code is missing (GOOGLE_SSO_INVALID_STATE).',
    type: ErrorEnvelopeDto,
  })
  @ApiUnauthorizedResponse({
    description:
      'Google reported an authorization error, the code exchange failed (GOOGLE_SSO_TOKEN_EXCHANGE_FAILED), the Google email is unverified (GOOGLE_SSO_EMAIL_UNVERIFIED), or the account is outside the allowed hosted domain (GOOGLE_SSO_HOSTED_DOMAIN_MISMATCH).',
    type: ErrorEnvelopeDto,
  })
  @ApiTooManyRequestsResponse({
    description: 'Google SSO callback rate limit exceeded.',
    type: ErrorEnvelopeDto,
  })
  @ApiServiceUnavailableResponse({
    description: 'Google SSO is disabled (GOOGLE_SSO_DISABLED).',
    type: ErrorEnvelopeDto,
  })
  @ApiInternalServerErrorResponse({
    description: 'Unexpected server error.',
    type: ErrorEnvelopeDto,
  })
  @Get('callback')
  async callback(
    @Query() query: GoogleSsoCallbackQueryDto,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const request = req as Request & { cookies?: Record<string, unknown> };

    // The one-time state cookie is cleared regardless of the outcome.
    res.clearCookie(GOOGLE_OAUTH_STATE_COOKIE, this.stateCookieOptions());

    let validated;

    try {
      validated = await this.googleSsoFlowService.validateCallback({
        state: query.state,
        stateFromCookie: request.cookies?.[GOOGLE_OAUTH_STATE_COOKIE],
        error: query.error,
        code: query.code,
      });
    } catch (error) {
      if (query.error) {
        this.logger.warn('Google SSO callback returned a provider error', {
          errorCode: query.error,
        });
      }

      throw error;
    }

    const profile = await this.googleSsoFlowService.exchangeCode(validated.code);
    const result = await this.completeGoogleSignInUseCase.execute(profile);

    this.sessionCookieService.attachIfNeeded(res, result.auth);

    this.logger.info('Google SSO sign-in completed', {
      userId: result.user.id,
    });

    // OQ-04 hybrid UX: 302 only for the session driver with an allowlisted
    // returnUrl; JWT artifacts stay in the JSON body and never enter URLs.
    if (validated.payload.returnUrl && this.config.auth().driver === 'session') {
      res.redirect(302, validated.payload.returnUrl);
      return;
    }

    res.status(200).json({
      success: true,
      data: result,
    });
  }

  private stateCookieOptions(ttlSeconds?: number): CookieOptions {
    return {
      httpOnly: true,
      secure: this.config.app().env === 'production',
      // Lax is sufficient: the Google callback is a top-level GET navigation.
      sameSite: 'lax',
      path: '/',
      ...(ttlSeconds !== undefined ? { maxAge: ttlSeconds * 1000 } : {}),
    };
  }
}
