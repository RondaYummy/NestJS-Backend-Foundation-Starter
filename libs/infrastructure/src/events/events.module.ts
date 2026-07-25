import { DynamicModule, Module, type ModuleMetadata, type Type } from '@nestjs/common';

import type { IDomainEventHandler } from '@contracts/events/domain-event-handler';
import { TOKENS } from '@contracts/tokens';

import { DomainEventRouter } from './domain-event.router';

type EventsModuleRegisterOptions = {
  imports?: ModuleMetadata['imports'];
  handlers?: Type<IDomainEventHandler>[];
};

@Module({})
export class EventsModule {
  static register(options: EventsModuleRegisterOptions = {}): DynamicModule {
    const handlers = options.handlers ?? [];

    return {
      module: EventsModule,
      imports: options.imports ?? [],
      providers: [
        DomainEventRouter,
        ...handlers,

        {
          provide: TOKENS.DomainEventHandlers,
          inject: handlers,
          useFactory: (...instances: IDomainEventHandler[]): IDomainEventHandler[] => instances,
        },

        {
          provide: TOKENS.DomainEventRouter,
          useExisting: DomainEventRouter,
        },
      ],
      exports: [TOKENS.DomainEventRouter],
    };
  }
}
