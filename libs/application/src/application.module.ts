import { Module } from '@nestjs/common';
import { TOKENS } from '@contracts/tokens';
import { InMemoryEventBus } from './events/in-memory-event-bus';
import { GetCurrentUserUseCase } from './use-cases/auth/get-current-user.usecase';
import { RegisterUseCase } from './use-cases/auth/register.usecase';
import { LoginUseCase } from './use-cases/auth/login.usecase';

@Module({
  providers: [
    RegisterUseCase,
    LoginUseCase,
    GetCurrentUserUseCase,
    { provide: TOKENS.EventBus, useClass: InMemoryEventBus },
  ],
  exports: [RegisterUseCase, LoginUseCase, GetCurrentUserUseCase, TOKENS.EventBus],
})
export class ApplicationModule {}
