import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Injectable } from '@nestjs/common';
import type { IStorageGateway } from '@contracts/storage/storage-gateway';
import { AppConfigService } from '../config/app-config.service';

@Injectable()
export class LocalStorageAdapter implements IStorageGateway {
  constructor(private readonly config: AppConfigService) {}

  async putObject(input: {
    key: string;
    body: Buffer | NodeJS.ReadableStream;
    contentType?: string;
  }): Promise<{ key: string; url?: string }> {
    if (!Buffer.isBuffer(input.body))
      throw new Error('LocalStorageAdapter supports Buffer in this starter');
    const path = this.path(input.key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, input.body);
    return { key: input.key, url: path };
  }
  getObject(key: string): Promise<Buffer> {
    return readFile(this.path(key));
  }
  async deleteObject(key: string): Promise<void> {
    await rm(this.path(key), { force: true });
  }
  async getSignedUrl(key: string): Promise<string> {
    return Promise.resolve(this.path(key));
  }
  private path(key: string): string {
    return join(this.config.storage().localPath, key);
  }
}
