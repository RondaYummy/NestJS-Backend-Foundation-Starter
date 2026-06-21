/// <reference types="jest" />

import type { QueueName } from './queue-gateway';
import { QUEUES } from './queue-names';

/** Mirrors `QueueJobRegistry` queue keys — keep in sync when extending the registry. */
const REGISTRY_QUEUE_NAMES: readonly QueueName[] = ['email', 'outbox'];

describe('QueueJobRegistry / QUEUES parity', () => {
  it('every QUEUES value is a QueueJobRegistry queue key', () => {
    for (const queueValue of Object.values(QUEUES)) {
      expect(REGISTRY_QUEUE_NAMES).toContain(queueValue);
    }
  });

  it('every QueueJobRegistry queue key has a matching QUEUES constant value', () => {
    const queueConstantValues = new Set(Object.values(QUEUES));

    for (const registryQueueName of REGISTRY_QUEUE_NAMES) {
      expect(queueConstantValues.has(registryQueueName)).toBe(true);
    }
  });

  it('QUEUES and QueueJobRegistry define the same queue set', () => {
    expect(Object.values(QUEUES).sort()).toEqual([...REGISTRY_QUEUE_NAMES].sort());
    expect(Object.keys(QUEUES)).toHaveLength(REGISTRY_QUEUE_NAMES.length);
  });
});
