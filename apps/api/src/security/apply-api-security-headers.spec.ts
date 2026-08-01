import express from 'express';
import request from 'supertest';

import { applyApiSecurityHeaders } from './apply-api-security-headers';

describe('applyApiSecurityHeaders', () => {
  it('sets FR-01 security headers when enabled', async () => {
    const app = express();
    applyApiSecurityHeaders(app, { enabled: true });
    app.get('/health', (_req, res) => {
      res.status(200).send('ok');
    });

    const response = await request(app).get('/health').expect(200);

    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(response.headers['referrer-policy']).toBeDefined();
    expect(response.headers['x-powered-by']).toBeUndefined();
  });

  it('does not inject FR-01 headers when disabled', async () => {
    const app = express();
    applyApiSecurityHeaders(app, { enabled: false });
    app.get('/health', (_req, res) => {
      res.status(200).send('ok');
    });

    const response = await request(app).get('/health').expect(200);

    expect(response.headers['x-content-type-options']).toBeUndefined();
    expect(response.headers['x-frame-options']).toBeUndefined();
    expect(response.headers['referrer-policy']).toBeUndefined();
  });
});
