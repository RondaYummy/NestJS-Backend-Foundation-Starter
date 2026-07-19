import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';

import {
  AuthTokensDto,
  AuthUserDto,
  CurrentUserResponseDto,
  LoginDataDto,
  LoginResponseDto,
  LogoutResponseDto,
  RefreshResponseDto,
  RegisterDataDto,
  RegisterResponseDto,
} from '../dto/auth/auth-response.dto';
import { ErrorDto, ErrorEnvelopeDto } from '../dto/common/error-envelope.dto';
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
      'Canonical HTTP contract for the starter kit. Business routes are URI-versioned under /v1; health endpoints stay version-neutral. Authentication uses either Bearer JWT or an httpOnly session cookie according to AUTH_DRIVER.',
    )
    .setVersion('1.0.0')
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
      HealthServicesDto,
      HealthResponseDto,
      LivenessResponseDto,
    ],
  });
}
