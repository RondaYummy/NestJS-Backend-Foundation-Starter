import { Global, Module, OnApplicationShutdown } from '@nestjs/common';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { InfrastructureConfigModule } from '../../config/infrastructure-config.module';
import { AppConfigService } from '../../config/app-config.service';
import { DRIZZLE_DB, PG_POOL } from './drizzle.tokens';

@Global()
@Module({
  imports: [InfrastructureConfigModule],
  providers: [
    {
      provide: PG_POOL,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) =>
        new Pool({ connectionString: config.getString('database.url') }),
    },
    { provide: DRIZZLE_DB, inject: [PG_POOL], useFactory: (pool: Pool) => drizzle(pool) },
    {
      provide: 'PG_SHUTDOWN',
      inject: [PG_POOL],
      useFactory: (pool: Pool) => new DrizzleShutdown(pool),
    },
  ],
  exports: [DRIZZLE_DB, PG_POOL],
})
export class DrizzleModule {}
class DrizzleShutdown implements OnApplicationShutdown {
  constructor(private readonly pool: Pool) {}
  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
