import type { Config } from 'jest';

import baseConfig from './jest.config.base.ts';

const config: Config = {
  ...baseConfig,
  testMatch: ['<rootDir>/scripts/release/**/*.spec.ts'],
};

export default config;
