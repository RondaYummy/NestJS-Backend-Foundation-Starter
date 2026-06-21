import type { Provider } from '@nestjs/common';

import type { IOutboxProcessor } from '@contracts/outbox/outbox-processor';
import type { OutboxProcessorOptions } from '@contracts/outbox/outbox-processor.options';
import { TOKENS } from '@contracts/tokens';

import { createOutboxProcessorClass } from './create-outbox-processor';

export const OUTBOX_WORKER_PROCESSOR = Symbol('OUTBOX_WORKER_PROCESSOR');

export const outboxProcessorProvider: Provider = {
  provide: OUTBOX_WORKER_PROCESSOR,
  useFactory: (options: OutboxProcessorOptions, outbox: IOutboxProcessor) => {
    const ProcessorClass = createOutboxProcessorClass(options.concurrency);

    return new ProcessorClass(outbox);
  },
  inject: [TOKENS.OutboxProcessorOptions, TOKENS.OutboxProcessor],
};
