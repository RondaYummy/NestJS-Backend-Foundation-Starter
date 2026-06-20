/// <reference types="jest" />

import { BULLMQ_REGISTERED_QUEUES } from './bullmq.module-options';
import { QUEUES } from './queues';
import { InfrastructureBullMqModule } from './bullmq.module';

describe('InfrastructureBullMqModule', () => {
  it('registerQueues declares only the requested queue names', () => {
    const dynamicModule = InfrastructureBullMqModule.registerQueues([QUEUES.OUTBOX]);

    const registeredQueuesProvider = dynamicModule.providers?.find(
      (provider) =>
        typeof provider === 'object' &&
        provider !== null &&
        'provide' in provider &&
        provider.provide === BULLMQ_REGISTERED_QUEUES,
    );

    expect(registeredQueuesProvider).toMatchObject({
      useValue: [QUEUES.OUTBOX],
    });
    expect(dynamicModule.imports).toHaveLength(1);
  });
});
