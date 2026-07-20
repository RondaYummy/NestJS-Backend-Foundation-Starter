/// <reference types="jest" />

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { SwaggerModule } from '@nestjs/swagger';
import request from 'supertest';

import { AuthController } from '../controllers/auth.controller';
import { GoogleAuthController } from '../controllers/google-auth.controller';
import { SessionsController } from '../controllers/sessions.controller';
import { HealthController } from '@infrastructure/health/health.controller';
import { API_DOCS_PATH, createOpenApiDocument } from './create-openapi-document';

async function createTestApp(init = true): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    controllers: [AuthController, GoogleAuthController, SessionsController, HealthController],
  })
    .useMocker(() => ({}))
    .compile();
  const app = moduleRef.createNestApplication();

  // Mirror production bootstrap (apps/api/src/main.ts): /v1 prefix with version-neutral health.
  app.setGlobalPrefix('v1', {
    exclude: ['health', 'health/live', 'health/ready'],
  });

  if (init) {
    await app.init();
  }

  return app;
}

describe('OpenAPI contract', () => {
  it('documents every current route, key schema, and auth scheme', async () => {
    const app = await createTestApp();

    try {
      const document = createOpenApiDocument(app);
      const expectedRoutes = [
        ['post', '/v1/auth/register'],
        ['post', '/v1/auth/login'],
        ['post', '/v1/auth/logout'],
        ['post', '/v1/auth/refresh'],
        ['get', '/v1/auth/me'],
        ['post', '/v1/auth/change-password'],
        ['post', '/v1/auth/forgot-password'],
        ['post', '/v1/auth/reset-password'],
        ['get', '/v1/auth/google'],
        ['get', '/v1/auth/google/callback'],
        ['get', '/v1/sessions'],
        ['delete', '/v1/sessions'],
        ['delete', '/v1/sessions/others'],
        ['delete', '/v1/sessions/{id}'],
        ['get', '/health'],
        ['get', '/health/live'],
        ['get', '/health/ready'],
      ] as const;

      for (const [method, path] of expectedRoutes) {
        const operation = document.paths[path]?.[method];

        expect(operation).toBeDefined();
        expect(operation?.summary).toEqual(expect.any(String));
        expect(operation?.description).toEqual(expect.any(String));
        // TASK-004: redirect-flow endpoints (Google SSO start) succeed with 3xx.
        expect(Object.keys(operation?.responses ?? {})).toEqual(
          expect.arrayContaining([
            expect.stringMatching(/^[23]\d\d$/),
            expect.stringMatching(/^[45]\d\d$/),
          ]),
        );
      }

      expect(document.components?.securitySchemes).toEqual(
        expect.objectContaining({
          bearerAuth: expect.objectContaining({ type: 'http', scheme: 'bearer' }),
          sessionCookie: expect.objectContaining({ type: 'apiKey', in: 'cookie', name: 'sid' }),
        }),
      );

      expect(document.paths['/v1/auth/me']?.get?.security).toEqual(
        expect.arrayContaining([{ bearerAuth: [] }, { sessionCookie: [] }]),
      );

      // TASK-003: change-password requires Bearer or session-cookie auth.
      expect(document.paths['/v1/auth/change-password']?.post?.security).toEqual(
        expect.arrayContaining([{ bearerAuth: [] }, { sessionCookie: [] }]),
      );

      // TASK-003: forgot/reset are public.
      expect(document.paths['/v1/auth/forgot-password']?.post?.security).toBeUndefined();
      expect(document.paths['/v1/auth/reset-password']?.post?.security).toBeUndefined();

      // TASK-004: Google SSO start/callback are public redirect-flow endpoints.
      expect(document.paths['/v1/auth/google']?.get?.security).toBeUndefined();
      expect(document.paths['/v1/auth/google/callback']?.get?.security).toBeUndefined();

      // TASK-005: session-management routes advertise cookie auth only and
      // document session-driver-only availability (strategy B).
      const sessionOnlyWording = /AUTH_DRIVER=session/i;
      for (const [method, path] of [
        ['get', '/v1/sessions'],
        ['delete', '/v1/sessions'],
        ['delete', '/v1/sessions/others'],
        ['delete', '/v1/sessions/{id}'],
      ] as const) {
        const operation = document.paths[path]?.[method];
        expect(operation?.description).toEqual(expect.stringMatching(sessionOnlyWording));
        expect(operation?.security).toEqual([{ sessionCookie: [] }]);
        expect(operation?.responses?.['400']).toBeDefined();
        expect(operation?.responses?.['401']).toBeDefined();
      }

      expect(document.paths['/v1/sessions']?.get?.responses?.['200']).toEqual(
        expect.objectContaining({
          content: expect.objectContaining({
            'application/json': expect.objectContaining({
              schema: { $ref: '#/components/schemas/SessionsListResponseDto' },
            }),
          }),
        }),
      );
      expect(document.paths['/v1/sessions/others']?.delete?.responses?.['200']).toEqual(
        expect.objectContaining({
          content: expect.objectContaining({
            'application/json': expect.objectContaining({
              schema: { $ref: '#/components/schemas/RevokeOthersResponseDto' },
            }),
          }),
        }),
      );
      expect(document.tags).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: 'Sessions',
            description: expect.stringMatching(sessionOnlyWording),
          }),
        ]),
      );

      // TASK-004: start documents the 302 to Google and the disabled 503.
      const googleStart = document.paths['/v1/auth/google']?.get;
      expect(googleStart?.responses?.['302']).toBeDefined();
      expect(googleStart?.responses?.['503']).toBeDefined();

      // TASK-004: callback succeeds with the login-equivalent JSON envelope
      // and documents the session-driver 302 and the disabled 503.
      const googleCallback = document.paths['/v1/auth/google/callback']?.get;
      expect(googleCallback?.responses?.['200']).toEqual(
        expect.objectContaining({
          content: expect.objectContaining({
            'application/json': expect.objectContaining({
              schema: { $ref: '#/components/schemas/LoginResponseDto' },
            }),
          }),
        }),
      );
      expect(googleCallback?.responses?.['302']).toBeDefined();
      expect(googleCallback?.responses?.['401']).toBeDefined();
      expect(googleCallback?.responses?.['503']).toBeDefined();

      // TASK-004: query parameters are documented for both Google routes.
      expect(googleStart?.parameters).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'returnUrl', in: 'query', required: false }),
        ]),
      );
      expect(googleCallback?.parameters).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'code', in: 'query' }),
          expect.objectContaining({ name: 'state', in: 'query' }),
        ]),
      );

      expect(document.components?.schemas).toEqual(
        expect.objectContaining({
          ErrorEnvelopeDto: expect.any(Object),
          RegisterDto: expect.any(Object),
          LoginDto: expect.any(Object),
          RefreshTokenDto: expect.any(Object),
          LogoutDto: expect.any(Object),
          RegisterResponseDto: expect.any(Object),
          LoginResponseDto: expect.any(Object),
          RefreshResponseDto: expect.any(Object),
          CurrentUserResponseDto: expect.any(Object),
          LogoutResponseDto: expect.any(Object),
          ChangePasswordDto: expect.any(Object),
          ForgotPasswordDto: expect.any(Object),
          ResetPasswordDto: expect.any(Object),
          ForgotPasswordResponseDto: expect.any(Object),
          SessionsListResponseDto: expect.any(Object),
          RevokeOthersResponseDto: expect.any(Object),
          SessionMutationResponseDto: expect.any(Object),
          SessionListItemDto: expect.any(Object),
          HealthResponseDto: expect.any(Object),
          LivenessResponseDto: expect.any(Object),
        }),
      );

      expect(document.paths['/v1/auth/register']?.post?.requestBody).toEqual(
        expect.objectContaining({
          content: expect.objectContaining({
            'application/json': expect.objectContaining({
              schema: { $ref: '#/components/schemas/RegisterDto' },
            }),
          }),
        }),
      );
      expect(document.paths['/v1/auth/login']?.post?.responses?.['201']).toEqual(
        expect.objectContaining({
          content: expect.objectContaining({
            'application/json': expect.objectContaining({
              schema: { $ref: '#/components/schemas/LoginResponseDto' },
            }),
          }),
        }),
      );

      // TASK-003: request bodies reference the typed DTO schemas.
      const passwordRouteBodies = [
        ['/v1/auth/change-password', 'ChangePasswordDto'],
        ['/v1/auth/forgot-password', 'ForgotPasswordDto'],
        ['/v1/auth/reset-password', 'ResetPasswordDto'],
      ] as const;

      for (const [path, schemaName] of passwordRouteBodies) {
        expect(document.paths[path]?.post?.requestBody).toEqual(
          expect.objectContaining({
            content: expect.objectContaining({
              'application/json': expect.objectContaining({
                schema: { $ref: `#/components/schemas/${schemaName}` },
              }),
            }),
          }),
        );
      }

      // TASK-003: change/reset succeed with 200 and the login-equivalent envelope.
      for (const path of ['/v1/auth/change-password', '/v1/auth/reset-password'] as const) {
        expect(document.paths[path]?.post?.responses?.['200']).toEqual(
          expect.objectContaining({
            content: expect.objectContaining({
              'application/json': expect.objectContaining({
                schema: { $ref: '#/components/schemas/LoginResponseDto' },
              }),
            }),
          }),
        );
      }

      expect(document.paths['/v1/auth/forgot-password']?.post?.responses?.['200']).toEqual(
        expect.objectContaining({
          content: expect.objectContaining({
            'application/json': expect.objectContaining({
              schema: { $ref: '#/components/schemas/ForgotPasswordResponseDto' },
            }),
          }),
        }),
      );
    } finally {
      await app.close();
    }
  });

  it('serves Swagger UI and JSON only when setup is enabled', async () => {
    const enabledApp = await createTestApp(false);
    const document = createOpenApiDocument(enabledApp);

    SwaggerModule.setup(API_DOCS_PATH, enabledApp, document);
    await enabledApp.init();

    await request(enabledApp.getHttpServer()).get('/v1/docs').expect(200);
    await request(enabledApp.getHttpServer())
      .get('/v1/docs-json')
      .expect(200)
      .expect(({ body }) => {
        expect(body.openapi).toMatch(/^3\./);
        expect(body.paths).toHaveProperty('/v1/auth/register');
      });

    // Hard cutover (TASK-002 Q3): unversioned docs and auth paths no longer exist.
    await request(enabledApp.getHttpServer()).get('/docs').expect(404);
    await request(enabledApp.getHttpServer()).get('/docs-json').expect(404);
    await enabledApp.close();

    const disabledApp = await createTestApp();

    await request(disabledApp.getHttpServer()).get('/v1/docs').expect(404);
    await request(disabledApp.getHttpServer()).get('/v1/docs-json').expect(404);
    await disabledApp.close();
  });

  it('routes auth only under /v1 and keeps health version-neutral', async () => {
    const app = await createTestApp();

    try {
      const server = app.getHttpServer();

      // Hard cutover (TASK-002 Q3): unversioned auth routes return 404.
      await request(server).post('/auth/register').expect(404);
      await request(server).post('/auth/login').expect(404);

      // Versioned auth routes are mounted (any non-404 status proves routing).
      const versionedRegister = await request(server).post('/v1/auth/register');
      expect(versionedRegister.status).not.toBe(404);

      // Health stays version-neutral: /v1/health is not routed.
      await request(server).get('/v1/health').expect(404);
      await request(server).get('/v1/health/live').expect(404);

      // Version-neutral health routes exist (mocked HealthService may yield 500, never 404).
      const live = await request(server).get('/health/live');
      expect(live.status).not.toBe(404);
      const health = await request(server).get('/health');
      expect(health.status).not.toBe(404);
      const ready = await request(server).get('/health/ready');
      expect(ready.status).not.toBe(404);
    } finally {
      await app.close();
    }
  });
});
