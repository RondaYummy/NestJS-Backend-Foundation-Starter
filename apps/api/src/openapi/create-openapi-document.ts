import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';

import {
  AuthTokensDto,
  AuthUserDto,
  CurrentUserResponseDto,
  ForgotPasswordResponseDto,
  LoginDataDto,
  LoginResponseDto,
  LogoutResponseDto,
  RefreshResponseDto,
  RegisterDataDto,
  RegisterResponseDto,
} from '../dto/auth/auth-response.dto';
import { ChangePasswordDto } from '../dto/auth/change-password.dto';
import { ForgotPasswordDto } from '../dto/auth/forgot-password.dto';
import {
  GoogleSsoCallbackQueryDto,
  GoogleSsoStartQueryDto,
} from '../dto/auth/google-sso-query.dto';
import { ResetPasswordDto } from '../dto/auth/reset-password.dto';
import { ErrorDto, ErrorEnvelopeDto } from '../dto/common/error-envelope.dto';
import { SessionIdParamDto } from '../dto/sessions/session-id-param.dto';
import {
  RevokeOthersDataDto,
  RevokeOthersResponseDto,
  SessionListItemDto,
  SessionMutationResponseDto,
  SessionsListDataDto,
  SessionsListResponseDto,
} from '../dto/sessions/sessions-response.dto';
import {
  HealthResponseDto,
  HealthServicesDto,
  LivenessResponseDto,
} from '@infrastructure/health/health-response.dto';

export const API_DOCS_PATH = 'v1/docs';
export const API_DOCS_JSON_PATH = 'v1/docs-json';

export function createOpenApiDocument(
  app: INestApplication,
  sessionCookieName = 'sid',
): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('NestJS Backend Foundation API')
    .setDescription(
      'Canonical HTTP contract for the starter kit. Business routes are URI-versioned under /v1; health endpoints stay version-neutral. Authentication uses either Bearer JWT or an httpOnly session cookie according to AUTH_DRIVER. Optional Google SSO (GOOGLE_SSO_ENABLED) adds GET /v1/auth/google and GET /v1/auth/google/callback; while disabled these routes stay documented and return 503 with code GOOGLE_SSO_DISABLED. Session-management endpoints under /v1/sessions are only available when AUTH_DRIVER=session; under jwt they remain registered and reject with SESSION_DRIVER_REQUIRED.',
    )
    .setVersion('1.0.0')
    .addTag(
      'Sessions',
      'Manage the authenticated user’s Redis sessions. Only available when AUTH_DRIVER=session.',
    )
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'JWT access token used when AUTH_DRIVER=jwt.',
      },
      'bearerAuth',
    )
    .addCookieAuth(
      sessionCookieName,
      {
        type: 'apiKey',
        in: 'cookie',
        description: `Session cookie used when AUTH_DRIVER=session. The configured cookie name is "${sessionCookieName}".`,
      },
      'sessionCookie',
    )
    .build();

  return SwaggerModule.createDocument(app, config, {
    extraModels: [
      ErrorDto,
      ErrorEnvelopeDto,
      AuthUserDto,
      AuthTokensDto,
      RegisterDataDto,
      RegisterResponseDto,
      LoginDataDto,
      LoginResponseDto,
      RefreshResponseDto,
      CurrentUserResponseDto,
      LogoutResponseDto,
      ChangePasswordDto,
      ForgotPasswordDto,
      ResetPasswordDto,
      ForgotPasswordResponseDto,
      GoogleSsoStartQueryDto,
      GoogleSsoCallbackQueryDto,
      SessionIdParamDto,
      SessionListItemDto,
      SessionsListDataDto,
      SessionsListResponseDto,
      RevokeOthersDataDto,
      RevokeOthersResponseDto,
      SessionMutationResponseDto,
      HealthServicesDto,
      HealthResponseDto,
      LivenessResponseDto,
    ],
  });
}
