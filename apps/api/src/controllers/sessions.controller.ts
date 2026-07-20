import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCookieAuth,
  ApiInternalServerErrorResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';

import { ListSessionsUseCase } from '@application/use-cases/auth/list-sessions.usecase';
import { RevokeAllSessionsUseCase } from '@application/use-cases/auth/revoke-all-sessions.usecase';
import { RevokeOtherSessionsUseCase } from '@application/use-cases/auth/revoke-other-sessions.usecase';
import { RevokeSessionUseCase } from '@application/use-cases/auth/revoke-session.usecase';
import { AppLogger } from '@infrastructure/logger/app-logger.service';
import { RateLimit } from '@infrastructure/rate-limiter/rate-limit.decorator';
import { RateLimiterGuard } from '@infrastructure/rate-limiter/rate-limiter.guard';

import { SessionCookieService } from '../auth/session-cookie.service';
import { CurrentUser } from '../decorators/current-user.decorator';
import { SessionIdParamDto } from '../dto/sessions/session-id-param.dto';
import {
  RevokeOthersResponseDto,
  SessionMutationResponseDto,
  SessionsListResponseDto,
} from '../dto/sessions/sessions-response.dto';
import { ErrorEnvelopeDto } from '../dto/common/error-envelope.dto';
import { AuthGuard } from '../guards/auth.guard';
import type { RequestUser } from '../types/request-user.type';

const SESSION_DRIVER_ONLY =
  'Only available when AUTH_DRIVER=session. Under AUTH_DRIVER=jwt these routes remain registered and reject with SESSION_DRIVER_REQUIRED.';

@ApiTags('Sessions')
@Controller('sessions')
export class SessionsController {
  constructor(
    private readonly listSessionsUseCase: ListSessionsUseCase,
    private readonly revokeSessionUseCase: RevokeSessionUseCase,
    private readonly revokeOtherSessionsUseCase: RevokeOtherSessionsUseCase,
    private readonly revokeAllSessionsUseCase: RevokeAllSessionsUseCase,
    private readonly sessionCookieService: SessionCookieService,
    private readonly logger: AppLogger,
  ) {}

  @UseGuards(AuthGuard, RateLimiterGuard)
  @RateLimit({
    keyPrefix: 'sessions:list',
    limit: 30,
    ttlSeconds: 60,
  })
  @ApiCookieAuth('sessionCookie')
  @ApiOperation({
    summary: 'List the current user’s sessions (session driver only)',
    description: SESSION_DRIVER_ONLY,
  })
  @ApiOkResponse({
    description: 'Active sessions for the authenticated user.',
    type: SessionsListResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'AUTH_DRIVER is not session (SESSION_DRIVER_REQUIRED).',
    type: ErrorEnvelopeDto,
  })
  @ApiUnauthorizedResponse({
    description: 'Missing or invalid session cookie.',
    type: ErrorEnvelopeDto,
  })
  @ApiTooManyRequestsResponse({
    description: 'Session list rate limit exceeded.',
    type: ErrorEnvelopeDto,
  })
  @ApiInternalServerErrorResponse({
    description: 'Unexpected server error.',
    type: ErrorEnvelopeDto,
  })
  @Get()
  async list(
    @CurrentUser() user: RequestUser,
    @Req() req: Request,
  ): Promise<SessionsListResponseDto> {
    const currentSessionId = this.requireSessionCookie(req);
    const sessions = await this.listSessionsUseCase.execute(user.id, currentSessionId);

    this.logger.info('Sessions listed', {
      userId: user.id,
      count: sessions.length,
    });

    return {
      success: true,
      data: { sessions },
    };
  }

  @UseGuards(AuthGuard, RateLimiterGuard)
  @RateLimit({
    keyPrefix: 'sessions:delete',
    limit: 10,
    ttlSeconds: 60,
  })
  @ApiCookieAuth('sessionCookie')
  @ApiOperation({
    summary: 'Revoke all other sessions (session driver only)',
    description: `${SESSION_DRIVER_ONLY} Leaves the current session cookie valid.`,
  })
  @ApiOkResponse({
    description: 'Non-current sessions revoked.',
    type: RevokeOthersResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'AUTH_DRIVER is not session (SESSION_DRIVER_REQUIRED).',
    type: ErrorEnvelopeDto,
  })
  @ApiUnauthorizedResponse({
    description: 'Missing or invalid session cookie.',
    type: ErrorEnvelopeDto,
  })
  @ApiTooManyRequestsResponse({
    description: 'Session delete rate limit exceeded.',
    type: ErrorEnvelopeDto,
  })
  @ApiInternalServerErrorResponse({
    description: 'Unexpected server error.',
    type: ErrorEnvelopeDto,
  })
  @Delete('others')
  @HttpCode(HttpStatus.OK)
  async revokeOthers(
    @CurrentUser() user: RequestUser,
    @Req() req: Request,
  ): Promise<RevokeOthersResponseDto> {
    const currentSessionId = this.requireSessionCookie(req);
    const result = await this.revokeOtherSessionsUseCase.execute(user.id, currentSessionId);

    this.logger.info('Other sessions revoked', {
      userId: user.id,
      revokedCount: result.revokedCount,
    });

    return {
      success: true,
      data: { revokedCount: result.revokedCount },
    };
  }

  @UseGuards(AuthGuard, RateLimiterGuard)
  @RateLimit({
    keyPrefix: 'sessions:delete',
    limit: 10,
    ttlSeconds: 60,
  })
  @ApiCookieAuth('sessionCookie')
  @ApiOperation({
    summary: 'Revoke all sessions including current (session driver only)',
    description: `${SESSION_DRIVER_ONLY} Clears the session cookie (sign out everywhere).`,
  })
  @ApiOkResponse({
    description: 'All sessions revoked; session cookie cleared.',
    type: SessionMutationResponseDto,
    headers: {
      'Set-Cookie': {
        description: 'Session cookie expiration header when AUTH_DRIVER=session.',
        schema: { type: 'string', example: 'sid=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax' },
      },
    },
  })
  @ApiBadRequestResponse({
    description: 'AUTH_DRIVER is not session (SESSION_DRIVER_REQUIRED).',
    type: ErrorEnvelopeDto,
  })
  @ApiUnauthorizedResponse({
    description: 'Missing or invalid session cookie.',
    type: ErrorEnvelopeDto,
  })
  @ApiTooManyRequestsResponse({
    description: 'Session delete rate limit exceeded.',
    type: ErrorEnvelopeDto,
  })
  @ApiInternalServerErrorResponse({
    description: 'Unexpected server error.',
    type: ErrorEnvelopeDto,
  })
  @Delete()
  @HttpCode(HttpStatus.OK)
  async revokeAll(
    @CurrentUser() user: RequestUser,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SessionMutationResponseDto> {
    this.requireSessionCookie(req);
    await this.revokeAllSessionsUseCase.execute(user.id);
    this.sessionCookieService.clear(res);

    this.logger.info('All sessions revoked', {
      userId: user.id,
      clearedCurrent: true,
    });

    return { success: true };
  }

  @UseGuards(AuthGuard, RateLimiterGuard)
  @RateLimit({
    keyPrefix: 'sessions:delete',
    limit: 10,
    ttlSeconds: 60,
  })
  @ApiCookieAuth('sessionCookie')
  @ApiOperation({
    summary: 'Revoke one session by id (session driver only)',
    description: `${SESSION_DRIVER_ONLY} Revoking the current session clears the cookie.`,
  })
  @ApiOkResponse({
    description: 'Session revoked. Cookie cleared when the revoked id was current.',
    type: SessionMutationResponseDto,
    headers: {
      'Set-Cookie': {
        description: 'Present when the revoked session was the current cookie session.',
        schema: { type: 'string', example: 'sid=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax' },
      },
    },
  })
  @ApiBadRequestResponse({
    description:
      'Invalid path param, or AUTH_DRIVER is not session (SESSION_DRIVER_REQUIRED).',
    type: ErrorEnvelopeDto,
  })
  @ApiUnauthorizedResponse({
    description: 'Missing or invalid session cookie.',
    type: ErrorEnvelopeDto,
  })
  @ApiNotFoundResponse({
    description: 'Session id not found for this user (SESSION_NOT_FOUND).',
    type: ErrorEnvelopeDto,
  })
  @ApiTooManyRequestsResponse({
    description: 'Session delete rate limit exceeded.',
    type: ErrorEnvelopeDto,
  })
  @ApiInternalServerErrorResponse({
    description: 'Unexpected server error.',
    type: ErrorEnvelopeDto,
  })
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  async revokeOne(
    @CurrentUser() user: RequestUser,
    @Param() params: SessionIdParamDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SessionMutationResponseDto> {
    const currentSessionId = this.requireSessionCookie(req);
    const result = await this.revokeSessionUseCase.execute(
      user.id,
      params.id,
      currentSessionId,
    );

    if (result.clearedCurrent) {
      this.sessionCookieService.clear(res);
    }

    this.logger.info('Session revoked', {
      userId: user.id,
      clearedCurrent: result.clearedCurrent,
    });

    return { success: true };
  }

  /**
   * Session-management routes hard-require the session cookie for current-session
   * identity even if AuthGuard somehow authenticated via Bearer (OQ-10).
   */
  private requireSessionCookie(req: Request): string {
    const requestWithCookies = req as Request & {
      cookies?: Record<string, unknown>;
    };
    const sessionId = this.sessionCookieService.getSessionIdFromCookies(
      requestWithCookies.cookies,
    );

    if (!sessionId) {
      throw new UnauthorizedException('Unauthorized');
    }

    return sessionId;
  }
}
