import { Module } from '@nestjs/common';

import { RegisterUseCase } from '@application/use-cases/auth/register.usecase';
import { LoginUseCase } from '@application/use-cases/auth/login.usecase';
import { LogoutUseCase } from '@application/use-cases/auth/logout.usecase';
import { RefreshAuthSessionUseCase } from '@application/use-cases/auth/refresh-auth-session.usecase';
import { GetCurrentUserUseCase } from '@application/use-cases/auth/get-current-user.usecase';

import { AuthModule } from '@infrastructure/auth/auth.module';
import { InfrastructureConfigModule } from '@infrastructure/config/infrastructure-config.module';
import { OutboxWriterModule } from '@infrastructure/outbox/outbox-writer.module';
import { RepositoriesModule } from '@infrastructure/repositories/repositories.module';
import { TransactionsModule } from '@infrastructure/transactions/transactions.module';

import { SessionCookieService } from '../auth/session-cookie.service';

@Module({
  imports: [
    InfrastructureConfigModule,
    AuthModule,
    RepositoriesModule,
    TransactionsModule,
    OutboxWriterModule,
  ],
  providers: [
    SessionCookieService,
    RegisterUseCase,
    LoginUseCase,
    LogoutUseCase,
    RefreshAuthSessionUseCase,
    GetCurrentUserUseCase,
  ],
  exports: [
    SessionCookieService,
    RegisterUseCase,
    LoginUseCase,
    LogoutUseCase,
    RefreshAuthSessionUseCase,
    GetCurrentUserUseCase,
  ],
})
export class AuthApplicationCompositionModule {}
