import type { Config } from 'jest';

import baseConfig from './jest.config.base.ts';

const config: Config = {
  ...baseConfig,
  testMatch: ['**/*.int-spec.ts'],
};

export default config;
