import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { BcryptPasswordHasher } from './bcrypt-password-hasher.service';
import { JwtAuthTokenService } from './jwt-auth-token.service';
import { SessionAuthTokenService } from './session-auth-token.service';
import { RedisSessionStore } from './redis-session-store.service';
import { AppConfigService } from '../config/app-config.service';
import { RedisModule } from '../redis/redis.module';
import { TOKENS } from '@contracts/tokens';
import { InfrastructureConfigModule } from '@infrastructure/config/infrastructure-config.module';

@Global()
@Module({
  imports: [InfrastructureConfigModule, RedisModule, JwtModule.register({})],
  providers: [
    BcryptPasswordHasher,
    RedisSessionStore,

    {
      provide: TOKENS.PasswordHasher,
      useExisting: BcryptPasswordHasher,
    },
    {
      provide: TOKENS.SessionStore,
      useExisting: RedisSessionStore,
    },
    {
      provide: TOKENS.AuthTokenService,
      inject: [AppConfigService, JwtAuthTokenService, SessionAuthTokenService],
      useFactory: (
        config: AppConfigService,
        jwtAuthTokenService: JwtAuthTokenService,
        sessionAuthTokenService: SessionAuthTokenService,
      ) => {
        const driver = config.getString('auth.driver');

        if (driver === 'session') {
          return sessionAuthTokenService;
        }

        return jwtAuthTokenService;
      },
    },

    JwtAuthTokenService,
    SessionAuthTokenService,
  ],
  exports: [TOKENS.PasswordHasher, TOKENS.AuthTokenService, TOKENS.SessionStore],
})
export class AuthModule {}
