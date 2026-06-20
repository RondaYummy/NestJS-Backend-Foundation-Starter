/// <reference types="jest" />

import { Test } from '@nestjs/testing';

import { DRIZZLE_DB, PG_POOL } from './drizzle.tokens';
import { DrizzleModule } from './drizzle.module';

describe('DrizzleModule', () => {
  it('boots with typed options without InfrastructureConfigModule', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        DrizzleModule.forRoot({
          connectionString: 'postgresql://localhost:5432/test',
        }),
      ],
    }).compile();

    expect(moduleRef.get(PG_POOL)).toBeDefined();
    expect(moduleRef.get(DRIZZLE_DB)).toBeDefined();

    await moduleRef.close();
  });
});
