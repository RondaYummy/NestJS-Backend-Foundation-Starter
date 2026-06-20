/// <reference types="jest" />

import { envSchema } from './env.schema';

const VALID_ACCESS_SECRET = 'VALID_ACCESS_SECRET_FOR_UNIT_TESTS_BASE64XXX';
const VALID_REFRESH_SECRET = 'VALID_REFRESH_SECRET_FOR_UNIT_TESTS_BASE64XXX';

function minimalProductionEnv(overrides: Record<string, string> = {}) {
  return {
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/app',
    JWT_SECRET: VALID_ACCESS_SECRET,
    JWT_REFRESH_SECRET: VALID_REFRESH_SECRET,
    ...overrides,
  };
}

function collectErrorText(parsed: {
  success: false;
  error: { message: string; issues: { message: string }[] };
}) {
  return [parsed.error.message, ...parsed.error.issues.map((issue) => issue.message)].join('\n');
}

describe('envSchema production JWT secret policy', () => {
  it('accepts distinct secrets with at least 43 trimmed characters', () => {
    const parsed = envSchema.safeParse(minimalProductionEnv());

    expect(parsed.success).toBe(true);
  });

  it('accepts distinct 64-character hex-style secrets', () => {
    const parsed = envSchema.safeParse(
      minimalProductionEnv({
        JWT_SECRET: 'a'.repeat(64),
        JWT_REFRESH_SECRET: 'b'.repeat(64),
      }),
    );

    expect(parsed.success).toBe(true);
  });

  it.each([
    ['JWT_SECRET', { JWT_SECRET: 'x' }],
    ['JWT_REFRESH_SECRET', { JWT_REFRESH_SECRET: 'y' }],
  ])('rejects single-character %s in production', (_field, overrides) => {
    const parsed = envSchema.safeParse(minimalProductionEnv(overrides));

    expect(parsed.success).toBe(false);
  });

  it('rejects secrets shorter than 43 trimmed characters in production', () => {
    const parsed = envSchema.safeParse(
      minimalProductionEnv({
        JWT_SECRET: 'a'.repeat(42),
      }),
    );

    expect(parsed.success).toBe(false);
  });

  it.each([
    'secret',
    'changeme',
    'development',
    'dev-secret',
    'dev-refresh-secret',
    'dev-access-secret-change-me',
    'dev-refresh-secret-change-me',
  ])('rejects placeholder value %s in production', (placeholder) => {
    const parsed = envSchema.safeParse(
      minimalProductionEnv({
        JWT_SECRET: placeholder,
      }),
    );

    expect(parsed.success).toBe(false);
  });

  it('rejects identical access and refresh secrets in production even when long enough', () => {
    const parsed = envSchema.safeParse(
      minimalProductionEnv({
        JWT_SECRET: VALID_ACCESS_SECRET,
        JWT_REFRESH_SECRET: VALID_ACCESS_SECRET,
      }),
    );

    expect(parsed.success).toBe(false);

    if (!parsed.success) {
      expect(
        parsed.error.issues.some(
          (issue) => issue.message === 'JWT access and refresh secrets must be different',
        ),
      ).toBe(true);
    }
  });

  it('does not include submitted secret values in validation error messages', () => {
    const leakedSecret = 'MY_SUPER_SECRET_VALUE_THAT_SHOULD_NOT_LEAK';
    const parsed = envSchema.safeParse(
      minimalProductionEnv({
        JWT_SECRET: leakedSecret,
      }),
    );

    expect(parsed.success).toBe(false);

    if (!parsed.success) {
      expect(collectErrorText(parsed)).not.toContain(leakedSecret);
    }
  });
});

describe('envSchema development and test JWT permissiveness', () => {
  it('accepts .env.example-style placeholders in development', () => {
    const parsed = envSchema.safeParse({
      NODE_ENV: 'development',
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/app',
      JWT_SECRET: 'dev-secret',
      JWT_REFRESH_SECRET: 'dev-refresh-secret',
    });

    expect(parsed.success).toBe(true);
  });

  it('accepts short distinct secrets in test', () => {
    const parsed = envSchema.safeParse({
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/app',
      JWT_SECRET: 'short-access',
      JWT_REFRESH_SECRET: 'short-refresh',
    });

    expect(parsed.success).toBe(true);
  });
});
