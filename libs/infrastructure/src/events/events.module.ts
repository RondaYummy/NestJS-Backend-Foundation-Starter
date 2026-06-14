import { Module } from '@nestjs/common';

import type { IDomainEventHandler } from '@contracts/events/domain-event-handler';
import { TOKENS } from '@contracts/tokens';

import { InfrastructureBullMqModule } from '../bullmq/bullmq.module';
import { DrizzleModule } from '../database/drizzle/drizzle.module';
import { DomainEventRouter } from './domain-event.router';
import { UserRegisteredEventHandler } from './handlers/user-registered.handler';

@Module({
  imports: [InfrastructureBullMqModule, DrizzleModule],
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
})
export class EventsModule {}
