import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
  DeleteObjectCommand,
  PutObjectCommandInput,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Inject, Injectable } from '@nestjs/common';
import type { IStorageGateway } from '@contracts/storage/storage-gateway';

import {
  STORAGE_MODULE_OPTIONS,
  isS3StorageOptions,
  type StorageModuleOptions,
} from './storage.module-options';

@Injectable()
export class S3StorageAdapter implements IStorageGateway {
  private readonly client: S3Client;
  private readonly bucketName: string;

  constructor(@Inject(STORAGE_MODULE_OPTIONS) options: StorageModuleOptions) {
    if (!isS3StorageOptions(options)) {
      throw new Error('S3StorageAdapter requires S3 storage options');
    }

    this.bucketName = options.s3.bucket ?? '';
    this.client = new S3Client({
      region: options.s3.region,
      endpoint: options.s3.endpoint || undefined,
      credentials: {
        accessKeyId: options.s3.accessKeyId ?? '',
        secretAccessKey: options.s3.secretAccessKey ?? '',
      },
    });
  }

  async putObject(input: {
    key: string;
    body: Buffer | NodeJS.ReadableStream;
    contentType?: string;
  }): Promise<{ key: string; url?: string }> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucketName,
        Key: input.key,
        Body: input.body as PutObjectCommandInput['Body'],
        ContentType: input.contentType,
      }),
    );
    return { key: input.key };
  }

  async getObject(key: string): Promise<Buffer> {
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucketName, Key: key }),
    );
    const chunks: Uint8Array[] = [];
    for await (const chunk of response.Body as AsyncIterable<Uint8Array>) chunks.push(chunk);
    return Buffer.concat(chunks);
  }

  async deleteObject(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucketName, Key: key }));
  }

  async getSignedUrl(key: string, expiresInSeconds: number): Promise<string> {
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucketName, Key: key }), {
      expiresIn: expiresInSeconds,
    });
  }
}
