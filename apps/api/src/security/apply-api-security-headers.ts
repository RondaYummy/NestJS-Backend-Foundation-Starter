import helmet from 'helmet';
import type { RequestHandler } from 'express';

/**
 * Swagger-safe Helmet profile: FR-01 headers on; CSP / COEP off so /docs stays usable.
 * CORP uses cross-origin so credentialed CORS clients are not blocked by same-origin CORP.
 */
export const API_SECURITY_HEADERS_HELMET_OPTIONS = {
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' as const },
};

export type ApplyApiSecurityHeadersApp = {
  disable(setting: string): unknown;
  use(handler: RequestHandler): unknown;
};

export type ApplyApiSecurityHeadersOptions = {
  enabled: boolean;
};

/**
 * Conditionally registers Helmet security headers on the API Express app.
 * When disabled, this is a no-op (operators whose edge already sets headers).
 */
export function applyApiSecurityHeaders(
  app: ApplyApiSecurityHeadersApp,
  options: ApplyApiSecurityHeadersOptions,
): void {
  if (!options.enabled) {
    return;
  }

  app.disable('x-powered-by');
  app.use(helmet(API_SECURITY_HEADERS_HELMET_OPTIONS));
}
