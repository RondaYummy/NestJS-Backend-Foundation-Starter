import type { Config } from 'jest';

import baseConfig from './jest.config.base.ts';

/**
 * Integration gate (`npm run test:int`): fail-closed when PostgreSQL/Redis are
 * unavailable. Suites import `test/integration/infra-availability.ts` and must
 * not soft-pass without live infra. Relative imports resolve from each suite.
 */
const config: Config = {
  ...baseConfig,
  testMatch: ['**/*.int-spec.ts'],
};

export default config;
