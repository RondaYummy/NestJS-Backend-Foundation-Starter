import { DynamicModule, Module, type ModuleMetadata } from '@nestjs/common';

import type { IDomainEventHandler } from '@contracts/events/domain-event-handler';
import { TOKENS } from '@contracts/tokens';

import { DomainEventRouter } from './domain-event.router';
import { UserRegisteredEventHandler } from './handlers/user-registered.handler';

type EventsModuleRegisterOptions = {
  imports?: ModuleMetadata['imports'];
};

@Module({})
export class EventsModule {
  static register(options: EventsModuleRegisterOptions = {}): DynamicModule {
    return {
      module: EventsModule,
      imports: options.imports ?? [],
      providers: [
        DomainEventRouter,
        UserRegisteredEventHandler,

        {
          provide: TOKENS.DomainEventHandlers,
          inject: [UserRegisteredEventHandler],
          useFactory: (userRegistered: UserRegisteredEventHandler): IDomainEventHandler[] => [
            userRegistered,
          ],
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
