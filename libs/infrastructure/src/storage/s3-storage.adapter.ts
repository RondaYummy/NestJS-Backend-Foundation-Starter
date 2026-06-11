import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
  DeleteObjectCommand,
  PutObjectCommandInput,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable } from '@nestjs/common';
import type { IStorageGateway } from '@contracts/storage/storage-gateway';
import { AppConfigService } from '../config/app-config.service';

@Injectable()
export class S3StorageAdapter implements IStorageGateway {
  private readonly client: S3Client;
  constructor(private readonly config: AppConfigService) {
    this.client = new S3Client({
      region: config.getString('storage.s3.region'),
      endpoint: config.getString('storage.s3.endpoint') || undefined,
      credentials: {
        accessKeyId: config.getString('storage.s3.accessKeyId'),
        secretAccessKey: config.getString('storage.s3.secretAccessKey'),
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
        Bucket: this.bucket(),
        Key: input.key,
        Body: input.body as PutObjectCommandInput['Body'],
        ContentType: input.contentType,
      }),
    );
    return { key: input.key };
  }
  async getObject(key: string): Promise<Buffer> {
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket(), Key: key }),
    );
    const chunks: Uint8Array[] = [];
    for await (const chunk of response.Body as AsyncIterable<Uint8Array>) chunks.push(chunk);
    return Buffer.concat(chunks);
  }
  async deleteObject(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket(), Key: key }));
  }
  async getSignedUrl(key: string, expiresInSeconds: number): Promise<string> {
    return await getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket(), Key: key }),
      {
        expiresIn: expiresInSeconds,
      },
    );
  }
  private bucket(): string {
    return this.config.getString('storage.s3.bucket');
  }
}
