import { Module } from '@nestjs/common';

import { RegisterUseCase } from '@application/use-cases/auth/register.usecase';
import { LoginUseCase } from '@application/use-cases/auth/login.usecase';
import { LogoutUseCase } from '@application/use-cases/auth/logout.usecase';
import { RefreshAuthSessionUseCase } from '@application/use-cases/auth/refresh-auth-session.usecase';
import { GetCurrentUserUseCase } from '@application/use-cases/auth/get-current-user.usecase';

import { AuthModule } from '@infrastructure/auth/auth.module';
import { InfrastructureConfigModule } from '@infrastructure/config/infrastructure-config.module';
import { AppConfigService } from '@infrastructure/config/app-config.service';
import {
  mapAppConfigToAuthOptions,
  mapAppConfigToDrizzleOptions,
  mapAppConfigToRedisOptions,
} from '@infrastructure/config/create-starter-kit-module-options';
import { DrizzleModule } from '@infrastructure/database/drizzle/drizzle.module';
import { OutboxWriterModule } from '@infrastructure/outbox/outbox-writer.module';
import { RedisModule } from '@infrastructure/redis/redis.module';
import { RepositoriesModule } from '@infrastructure/repositories/repositories.module';
import { TransactionsModule } from '@infrastructure/transactions/transactions.module';

import { SessionCookieService } from '../auth/session-cookie.service';

const redisModule = RedisModule.forRootAsync({
  imports: [InfrastructureConfigModule],
  inject: [AppConfigService],
  useFactory: (config: AppConfigService) => mapAppConfigToRedisOptions(config),
});

const drizzleModule = DrizzleModule.forRootAsync({
  imports: [InfrastructureConfigModule],
  inject: [AppConfigService],
  useFactory: (config: AppConfigService) => mapAppConfigToDrizzleOptions(config),
});

const authModule = AuthModule.forRootAsync({
  imports: [InfrastructureConfigModule, redisModule],
  inject: [AppConfigService],
  useFactory: (config: AppConfigService) => mapAppConfigToAuthOptions(config),
});

@Module({
  imports: [
    InfrastructureConfigModule,
    redisModule,
    drizzleModule,
    authModule,
    RepositoriesModule.register({ imports: [drizzleModule] }),
    TransactionsModule.register({ imports: [drizzleModule] }),
    OutboxWriterModule.register({ imports: [drizzleModule] }),
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
    authModule,
    SessionCookieService,
    RegisterUseCase,
    LoginUseCase,
    LogoutUseCase,
    RefreshAuthSessionUseCase,
    GetCurrentUserUseCase,
  ],
})
export class AuthApplicationCompositionModule {}
