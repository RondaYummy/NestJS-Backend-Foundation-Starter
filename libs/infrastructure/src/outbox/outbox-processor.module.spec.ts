/// <reference types="jest" />

import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import type {
  IDomainEventRouter,
  RoutableDomainEvent,
} from '@contracts/events/domain-event-router';
import type { IQueueGateway } from '@contracts/queues/queue-gateway';
import { QUEUES } from '@contracts/queues/queue-names';
import { TOKENS } from '@contracts/tokens';

import { DRIZZLE_DB } from '../database/drizzle/drizzle.tokens';
import { UserRegisteredEventHandler } from '../events/examples/user-registered.handler';
import { LoggerModule } from '../logger/logger.module';
import { OUTBOX_PROCESSOR_DEFAULT_OPTIONS } from './outbox-processor.defaults';
import { OutboxProcessorModule } from './outbox-processor.module';

@Global()
@Module({
  providers: [
    {
      provide: DRIZZLE_DB,
      useValue: {
        transaction: jest.fn(),
        update: jest.fn(),
        insert: jest.fn(),
      },
    },
    {
      provide: TOKENS.QueueGateway,
      useValue: {
        add: jest.fn(),
      },
    },
  ],
  exports: [DRIZZLE_DB, TOKENS.QueueGateway],
})
class MockConnectionModule {}

const TEST_ENV: Record<string, string> = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/test',
  REDIS_HOST: '127.0.0.1',
  JWT_SECRET: 'test-jwt-secret-for-unit-tests-only-ok',
  JWT_REFRESH_SECRET: 'test-jwt-refresh-secret-for-unit-tests',
  AUTH_DRIVER: 'jwt',
};

function withTestEnv<T>(run: () => Promise<T>): Promise<T> {
  const previous = new Map<string, string | undefined>();

  for (const [key, value] of Object.entries(TEST_ENV)) {
    previous.set(key, process.env[key]);
    process.env[key] = value;
  }

  return run().finally(() => {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });
}

describe('OutboxProcessorModule', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('forRootAsync compiles without UnknownExportException and exposes both tokens (P1-08)', async () => {
    await withTestEnv(async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [
          LoggerModule.forRoot({ level: 'error', pretty: false }),
          OutboxProcessorModule.forRootAsync({
            imports: [MockConnectionModule],
            useFactory: () => OUTBOX_PROCESSOR_DEFAULT_OPTIONS,
          }),
        ],
      }).compile();

      expect(moduleRef.get(TOKENS.OutboxProcessor)).toBeDefined();
      expect(moduleRef.get(TOKENS.OutboxProcessorOptions)).toBeDefined();

      await moduleRef.close();
    });
  });

  it('forRootAsync options resolved at importer scope match the factory output', async () => {
    await withTestEnv(async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [
          LoggerModule.forRoot({ level: 'error', pretty: false }),
          OutboxProcessorModule.forRootAsync({
            imports: [MockConnectionModule],
            useFactory: () => OUTBOX_PROCESSOR_DEFAULT_OPTIONS,
          }),
        ],
      }).compile();

      const options = moduleRef.get(TOKENS.OutboxProcessorOptions);

      expect(options.pollIntervalMs).toBe(OUTBOX_PROCESSOR_DEFAULT_OPTIONS.pollIntervalMs);
      expect(options.batchSize).toBe(OUTBOX_PROCESSOR_DEFAULT_OPTIONS.batchSize);

      await moduleRef.close();
    });
  });

  it('routes user.registered to the supplied handler and enqueues the welcome email (AC-04)', async () => {
    await withTestEnv(async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [
          LoggerModule.forRoot({ level: 'error', pretty: false }),
          MockConnectionModule,
          OutboxProcessorModule.forRoot(OUTBOX_PROCESSOR_DEFAULT_OPTIONS, {
            eventHandlers: [UserRegisteredEventHandler],
          }),
        ],
      }).compile();

      const router = moduleRef.get<IDomainEventRouter>(TOKENS.DomainEventRouter, { strict: false });
      const queueGateway = moduleRef.get<IQueueGateway>(TOKENS.QueueGateway, { strict: false });

      const event: RoutableDomainEvent = {
        id: 'evt-1',
        name: 'user.registered',
        payload: { userId: 'user-1', email: 'user@example.com' },
        occurredAt: new Date().toISOString(),
      };

      await router.route(event);

      expect(queueGateway.add).toHaveBeenCalledTimes(1);
      expect(queueGateway.add).toHaveBeenCalledWith(
        QUEUES.EMAIL,
        'send-welcome-email',
        expect.objectContaining({ template: 'welcome' }),
        { jobId: 'welcome-email:evt-1' },
      );

      await moduleRef.close();
    });
  });

  it('defaults to zero handlers (no features) and routes without enqueueing (AC-05)', async () => {
    await withTestEnv(async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [
          LoggerModule.forRoot({ level: 'error', pretty: false }),
          MockConnectionModule,
          OutboxProcessorModule.forRoot(OUTBOX_PROCESSOR_DEFAULT_OPTIONS),
        ],
      }).compile();

      expect(moduleRef.get(TOKENS.OutboxProcessor)).toBeDefined();

      const router = moduleRef.get<IDomainEventRouter>(TOKENS.DomainEventRouter, { strict: false });
      const queueGateway = moduleRef.get<IQueueGateway>(TOKENS.QueueGateway, { strict: false });

      await expect(
        router.route({
          id: 'evt-2',
          name: 'user.registered',
          payload: { userId: 'user-1', email: 'user@example.com' },
          occurredAt: new Date().toISOString(),
        }),
      ).resolves.toBeUndefined();

      expect(queueGateway.add).not.toHaveBeenCalled();

      await moduleRef.close();
    });
  });
});
