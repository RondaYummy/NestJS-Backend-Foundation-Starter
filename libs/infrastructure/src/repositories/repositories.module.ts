import { Global, Module } from '@nestjs/common';
import { TOKENS } from '@contracts/tokens';
import { DrizzleModule } from '../database/drizzle/drizzle.module';
import { UserDrizzleRepository } from './user-drizzle.repository';
@Global()
@Module({
  imports: [DrizzleModule],
  providers: [
    UserDrizzleRepository,
    { provide: TOKENS.UserRepository, useExisting: UserDrizzleRepository },
  ],
  exports: [TOKENS.UserRepository],
})
export class RepositoriesModule {}
