/// <reference types="jest" />

import { Test } from '@nestjs/testing';

import { TOKENS } from '@contracts/tokens';

import { OUTBOX_PROCESSOR_DEFAULT_OPTIONS } from './outbox-processor.defaults';
import { OutboxProcessorOptionsModule } from './outbox-processor-options.module';

describe('OutboxProcessorOptionsModule', () => {
  it('resolves TOKENS.OutboxProcessorOptions without InfrastructureConfigModule or Drizzle', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [OutboxProcessorOptionsModule.forRoot(OUTBOX_PROCESSOR_DEFAULT_OPTIONS)],
    }).compile();

    const options = moduleRef.get(TOKENS.OutboxProcessorOptions);

    expect(options.pollIntervalMs).toBe(OUTBOX_PROCESSOR_DEFAULT_OPTIONS.pollIntervalMs);
    expect(options.cronLockTtlMs).toBe(OUTBOX_PROCESSOR_DEFAULT_OPTIONS.cronLockTtlMs);

    await moduleRef.close();
  });
});
