/// <reference types="jest" />

import * as fs from 'node:fs';
import * as path from 'node:path';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { AuthController } from '../controllers/auth.controller';
import { GoogleAuthController } from '../controllers/google-auth.controller';
import { SessionsController } from '../controllers/sessions.controller';
import { HealthController } from '@infrastructure/health/health.controller';
import { createOpenApiDocument } from './create-openapi-document';

const POSTMAN_SCHEMA_V21 =
  'https://schema.getpostman.com/json/collection/v2.1.0/collection.json';

const COLLECTION_RELATIVE_PATH = path.join(
  'docs',
  'postman',
  'NestJS-Backend-Foundation-Starter.postman_collection.json',
);

type PostmanUrl = string | { raw?: string; path?: string[] };

type PostmanItem = {
  name?: string;
  request?: {
    method?: string;
    url?: PostmanUrl;
  };
  item?: PostmanItem[];
};

type PostmanCollection = {
  info?: { schema?: string; name?: string };
  item?: PostmanItem[];
  variable?: Array<{ key?: string; value?: string }>;
};

function findRepoRoot(startDir: string): string {
  let dir = startDir;
  for (;;) {
    if (fs.existsSync(path.join(dir, 'package.json')) && fs.existsSync(path.join(dir, 'docs'))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error(`Could not locate repository root from ${startDir}`);
    }
    dir = parent;
  }
}

/**
 * Normalize OpenAPI `{id}` and Postman `{{sessionId}}` (and other `{{var}}`) to `{id}`-style
 * for path+method coverage matching.
 */
function normalizePathTemplate(rawPath: string): string {
  let normalized = rawPath.split('?')[0] ?? rawPath;
  // Postman path variables: {{sessionId}} -> {id} for the sessions param convention.
  normalized = normalized.replace(/\{\{sessionId\}\}/g, '{id}');
  // Any remaining {{var}} -> {var} (generic).
  normalized = normalized.replace(/\{\{([A-Za-z0-9_]+)\}\}/g, '{$1}');
  // Collapse accidental double slashes (except leading).
  normalized = normalized.replace(/([^:]\/)\/+/g, '$1');
  if (!normalized.startsWith('/')) {
    normalized = `/${normalized}`;
  }
  // Strip trailing slash except root.
  if (normalized.length > 1 && normalized.endsWith('/')) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
}

function extractPathFromPostmanUrl(url: PostmanUrl | undefined): string | null {
  if (url == null) {
    return null;
  }

  if (typeof url === 'string') {
    const withoutHost = url.replace(/\{\{baseUrl\}\}/g, '').replace(/^https?:\/\/[^/]+/i, '');
    return normalizePathTemplate(withoutHost || '/');
  }

  if (url.raw) {
    const withoutHost = url.raw.replace(/\{\{baseUrl\}\}/g, '').replace(/^https?:\/\/[^/]+/i, '');
    return normalizePathTemplate(withoutHost || '/');
  }

  if (url.path && url.path.length > 0) {
    return normalizePathTemplate(`/${url.path.join('/')}`);
  }

  return null;
}

function walkPostmanItems(
  items: PostmanItem[] | undefined,
  acc: Set<string>,
): void {
  if (!items) {
    return;
  }

  for (const entry of items) {
    if (entry.item) {
      walkPostmanItems(entry.item, acc);
    }
    if (entry.request?.method) {
      const method = entry.request.method.toLowerCase();
      const requestPath = extractPathFromPostmanUrl(entry.request.url);
      if (requestPath) {
        acc.add(`${method} ${requestPath}`);
      }
    }
  }
}

async function createTestApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    controllers: [AuthController, GoogleAuthController, SessionsController, HealthController],
  })
    .useMocker(() => ({}))
    .compile();
  const app = moduleRef.createNestApplication();

  app.setGlobalPrefix('v1', {
    exclude: ['health', 'health/live', 'health/ready'],
  });

  await app.init();
  return app;
}

describe('Postman coverage', () => {
  it('is Collection v2.1 and covers every OpenAPI path+method', async () => {
    const repoRoot = findRepoRoot(__dirname);
    const collectionPath = path.join(repoRoot, COLLECTION_RELATIVE_PATH);
    expect(fs.existsSync(collectionPath)).toBe(true);

    const collection = JSON.parse(fs.readFileSync(collectionPath, 'utf8')) as PostmanCollection;

    expect(collection.info?.schema).toBe(POSTMAN_SCHEMA_V21);

    const postmanRoutes = new Set<string>();
    walkPostmanItems(collection.item, postmanRoutes);

    // Token/cookie placeholders must stay empty or clearly non-secret defaults.
    const secretKeys = new Set([
      'accessToken',
      'refreshToken',
      'sessionCookieValue',
      'resetToken',
      'googleAuthCode',
      'googleAuthState',
    ]);
    for (const variable of collection.variable ?? []) {
      if (variable.key && secretKeys.has(variable.key)) {
        expect(variable.value ?? '').toBe('');
      }
    }

    const app = await createTestApp();

    try {
      const document = createOpenApiDocument(app);
      const openApiRoutes: string[] = [];

      for (const [openapiPath, pathItem] of Object.entries(document.paths ?? {})) {
        if (!pathItem || typeof pathItem !== 'object') {
          continue;
        }
        for (const method of ['get', 'post', 'put', 'patch', 'delete', 'options', 'head'] as const) {
          if (pathItem[method]) {
            openApiRoutes.push(`${method} ${normalizePathTemplate(openapiPath)}`);
          }
        }
      }

      expect(openApiRoutes.length).toBeGreaterThan(0);

      const missing = openApiRoutes.filter((route) => !postmanRoutes.has(route));
      expect(missing).toEqual([]);
    } finally {
      await app.close();
    }
  });
});
