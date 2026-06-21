/// <reference types="jest" />

import type { ModuleRef } from '@nestjs/core';

import { QUEUES } from './queues';
import { BullQueueGateway } from './queue.gateway';

describe('BullQueueGateway', () => {
  let mockQueue: { add: jest.Mock; addBulk: jest.Mock };
  let moduleRef: { get: jest.Mock };

  beforeEach(() => {
    mockQueue = {
      add: jest.fn().mockResolvedValue({ id: 'job-1' }),
      addBulk: jest.fn().mockResolvedValue([{ id: 'job-1' }, { id: 'job-2' }]),
    };
    moduleRef = {
      get: jest.fn().mockReturnValue(mockQueue),
    };
  });

  function createGateway(registeredQueues: readonly string[]): BullQueueGateway {
    return new BullQueueGateway(moduleRef as unknown as ModuleRef, registeredQueues, {
      connection: {
        host: '127.0.0.1',
        port: 6379,
        db: 0,
        connectTimeoutMs: 5000,
      },
      defaultJobOptions: { attempts: 3, backoffDelay: 1000 },
    });
  }

  it('add delegates to the underlying BullMQ Queue.add with typed job name', async () => {
    const gateway = createGateway([QUEUES.EMAIL, QUEUES.OUTBOX]);
    const payload = {
      to: 'user@example.com',
      subject: 'Welcome',
      html: '<p>Welcome</p>',
    };

    const jobId = await gateway.add(QUEUES.EMAIL, 'send-welcome-email', payload);

    expect(mockQueue.add).toHaveBeenCalledWith('send-welcome-email', payload, expect.any(Object));
    expect(jobId).toBe('job-1');
  });

  it('addBulk delegates to the underlying BullMQ Queue.addBulk', async () => {
    const gateway = createGateway([QUEUES.OUTBOX]);
    const jobs = [{ name: 'process-pending-outbox-events' as const, payload: {} }];

    const jobIds = await gateway.addBulk(QUEUES.OUTBOX, jobs);

    expect(mockQueue.addBulk).toHaveBeenCalledWith([
      {
        name: 'process-pending-outbox-events',
        data: {},
        opts: expect.any(Object),
      },
    ]);
    expect(jobIds).toEqual(['job-1', 'job-2']);
  });

  it('throws when enqueue targets a queue that was not registered', async () => {
    const gateway = createGateway([QUEUES.OUTBOX]);

    await expect(
      gateway.add(QUEUES.EMAIL, 'send-welcome-email', {
        to: 'user@example.com',
        subject: 'Welcome',
        html: '<p>Welcome</p>',
      }),
    ).rejects.toThrow('Unknown queue: email');
  });
});
