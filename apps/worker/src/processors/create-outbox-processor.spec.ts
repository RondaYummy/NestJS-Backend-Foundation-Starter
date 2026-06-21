/// <reference types="jest" />

import 'reflect-metadata';

import { WORKER_METADATA } from '@nestjs/bullmq/dist/bull.constants';

import { createOutboxProcessorClass } from './create-outbox-processor';

describe('createOutboxProcessorClass', () => {
  it('sets WORKER_METADATA concurrency from factory input', () => {
    const ProcessorClass = createOutboxProcessorClass(3);

    expect(Reflect.getMetadata(WORKER_METADATA, ProcessorClass)).toEqual({ concurrency: 3 });
  });

  it('derives concurrency only from the factory argument', () => {
    const ProcessorClass = createOutboxProcessorClass(5);

    expect(Reflect.getMetadata(WORKER_METADATA, ProcessorClass)).toEqual({ concurrency: 5 });
  });
});
