import { Module } from '@nestjs/common';
import { TOKENS } from '@contracts/tokens';
import { InfrastructureConfigModule } from '../config/infrastructure-config.module';
import { AppConfigService } from '../config/app-config.service';
import { LocalStorageAdapter } from './local-storage.adapter';
import { S3StorageAdapter } from './s3-storage.adapter';

@Module({
  imports: [InfrastructureConfigModule],
  providers: [
    LocalStorageAdapter,
    S3StorageAdapter,
    {
      provide: TOKENS.StorageGateway,
      inject: [AppConfigService, LocalStorageAdapter, S3StorageAdapter],
      useFactory: (config: AppConfigService, local: LocalStorageAdapter, s3: S3StorageAdapter) =>
        config.storage().driver === 's3' ? s3 : local,
    },
  ],
  exports: [TOKENS.StorageGateway],
})
export class StorageModule {}
