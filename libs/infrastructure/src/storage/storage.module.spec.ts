/// <reference types="jest" />

import { Test } from '@nestjs/testing';

import { TOKENS } from '@contracts/tokens';
import { StorageModule } from './storage.module';
import { LocalStorageAdapter } from './local-storage.adapter';
import { S3StorageAdapter } from './s3-storage.adapter';

describe('StorageModule', () => {
  it('registers only LocalStorageAdapter for local driver', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        StorageModule.forRoot({
          driver: 'local',
          localPath: './tmp/storage-test',
        }),
      ],
    }).compile();

    expect(moduleRef.get(TOKENS.StorageGateway)).toBeInstanceOf(LocalStorageAdapter);
    expect(() => moduleRef.get(S3StorageAdapter)).toThrow();

    await moduleRef.close();
  });

  it('registers only S3StorageAdapter for s3 driver', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        StorageModule.forRoot({
          driver: 's3',
          s3: {
            region: 'us-east-1',
            bucket: 'test-bucket',
          },
        }),
      ],
    }).compile();

    expect(moduleRef.get(TOKENS.StorageGateway)).toBeInstanceOf(S3StorageAdapter);
    expect(() => moduleRef.get(LocalStorageAdapter)).toThrow();

    await moduleRef.close();
  });
});
