import {
  ConfigurableModuleBuilder,
  DynamicModule,
  Module,
  OnApplicationShutdown,
} from '@nestjs/common';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import { InfrastructureConfigModule } from '../../config/infrastructure-config.module';
import { AppConfigService } from '../../config/app-config.service';
import { DRIZZLE_DB, PG_POOL } from './drizzle.tokens';
import type { DrizzleModuleOptions } from './drizzle.module-options';

export const {
  ConfigurableModuleClass,
  MODULE_OPTIONS_TOKEN,
  OPTIONS_TYPE,
  ASYNC_OPTIONS_TYPE,
} = new ConfigurableModuleBuilder<DrizzleModuleOptions>({
  optionsInjectionToken: 'DRIZZLE_MODULE_OPTIONS',
})
  .setClassMethodName('forRoot')
  .setFactoryMethodName('forRootAsync')
  .build();

@Module({
  providers: [
    {
      provide: PG_POOL,
      inject: [MODULE_OPTIONS_TOKEN],
      useFactory: (options: DrizzleModuleOptions) =>
        new Pool({
          connectionString: options.connectionString,
          max: options.max,
          idleTimeoutMillis: options.idleTimeoutMillis,
        }),
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
export class DrizzleModule extends ConfigurableModuleClass {
  static forRoot(options: typeof OPTIONS_TYPE): DynamicModule {
    return {
      ...super.forRoot(options),
      global: false,
    };
  }

  static forRootAsync(options: typeof ASYNC_OPTIONS_TYPE): DynamicModule {
    return {
      ...super.forRootAsync(options),
      global: false,
    };
  }

  /**
   * @deprecated Use `forRootAsync` at the composition root with typed options instead.
   */
  static forRootFromAppConfig(): DynamicModule {
    return DrizzleModule.forRootAsync({
      imports: [InfrastructureConfigModule],
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({
        connectionString: config.database().url,
      }),
    });
  }
}

export { MODULE_OPTIONS_TOKEN as DRIZZLE_MODULE_OPTIONS_TOKEN };

class DrizzleShutdown implements OnApplicationShutdown {
  constructor(private readonly pool: Pool) {}

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
