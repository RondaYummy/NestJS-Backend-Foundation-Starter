import type { Config } from 'jest';

import baseConfig from './jest.config.base.ts';

const config: Config = {
  ...baseConfig,
  testMatch: ['**/*.module.spec.ts'],
  testTimeout: 30_000,
};

export default config;
