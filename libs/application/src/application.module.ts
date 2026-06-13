import { Module } from '@nestjs/common';
import { GetCurrentUserUseCase } from './use-cases/auth/get-current-user.usecase';
import { RegisterUseCase } from './use-cases/auth/register.usecase';
import { LoginUseCase } from './use-cases/auth/login.usecase';
import { LogoutUseCase } from './use-cases/auth/logout.usecase';
import { RefreshAuthSessionUseCase } from './use-cases/auth/refresh-auth-session.usecase';
import { HandleUserRegisteredUseCase } from './use-cases/users/emails/handle-user-registered.usecase';

@Module({
  providers: [
    RegisterUseCase,
    HandleUserRegisteredUseCase,
    LoginUseCase,
    LogoutUseCase,
    GetCurrentUserUseCase,
    RefreshAuthSessionUseCase,
  ],
  exports: [
    RegisterUseCase,
    HandleUserRegisteredUseCase,
    LoginUseCase,
    LogoutUseCase,
    GetCurrentUserUseCase,
    RefreshAuthSessionUseCase,
  ],
})
export class ApplicationModule {}
