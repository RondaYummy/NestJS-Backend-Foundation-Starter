import { Module } from '@nestjs/common';
import { TOKENS } from '@contracts/tokens';
import { InMemoryEventBus } from './events/in-memory-event-bus';
import { GetCurrentUserUseCase } from './use-cases/auth/get-current-user.usecase';
import { RegisterUseCase } from './use-cases/auth/register.usecase';
import { LoginUseCase } from './use-cases/auth/login.usecase';
import { LogoutUseCase } from './use-cases/auth/logout.usecase';
import { RefreshAuthSessionUseCase } from './use-cases/auth/refresh-auth-session.usecase';

@Module({
  providers: [
    RegisterUseCase,
    LoginUseCase,
    LogoutUseCase,
    GetCurrentUserUseCase,
    RefreshAuthSessionUseCase,
    { provide: TOKENS.EventBus, useClass: InMemoryEventBus },
  ],
  exports: [
    RegisterUseCase,
    LoginUseCase,
    LogoutUseCase,
    GetCurrentUserUseCase,
    TOKENS.EventBus,
    RefreshAuthSessionUseCase,
  ],
})
export class ApplicationModule {}
