/// <reference types="jest" />

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { SwaggerModule } from '@nestjs/swagger';
import request from 'supertest';

import { AuthController } from '../controllers/auth.controller';
import { HealthController } from '@infrastructure/health/health.controller';
import { API_DOCS_PATH, createOpenApiDocument } from './create-openapi-document';

async function createTestApp(init = true): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    controllers: [AuthController, HealthController],
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
        ['get', '/health'],
        ['get', '/health/live'],
        ['get', '/health/ready'],
      ] as const;

      for (const [method, path] of expectedRoutes) {
        const operation = document.paths[path]?.[method];

        expect(operation).toBeDefined();
        expect(operation?.summary).toEqual(expect.any(String));
        expect(operation?.description).toEqual(expect.any(String));
        expect(Object.keys(operation?.responses ?? {})).toEqual(
          expect.arrayContaining([
            expect.stringMatching(/^2\d\d$/),
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
