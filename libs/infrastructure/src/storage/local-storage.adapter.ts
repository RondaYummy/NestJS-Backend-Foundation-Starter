import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import type { IStorageGateway } from '@contracts/storage/storage-gateway';

import {
  STORAGE_MODULE_OPTIONS,
  isS3StorageOptions,
  type StorageModuleOptions,
} from './storage.module-options';

@Injectable()
export class LocalStorageAdapter implements IStorageGateway {
  private readonly storageRoot: string;

  constructor(@Inject(STORAGE_MODULE_OPTIONS) options: StorageModuleOptions) {
    if (isS3StorageOptions(options)) {
      throw new Error('LocalStorageAdapter requires local storage options');
    }

    this.storageRoot = resolve(options.localPath);
  }

  async putObject(input: {
    key: string;
    body: Buffer | NodeJS.ReadableStream;
    contentType?: string;
  }): Promise<{ key: string; url?: string }> {
    if (!Buffer.isBuffer(input.body))
      throw new Error('LocalStorageAdapter supports Buffer in this starter');
    const filePath = this.path(input.key);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, input.body);
    return { key: input.key };
  }

  getObject(key: string): Promise<Buffer> {
    return readFile(this.path(key));
  }

  async deleteObject(key: string): Promise<void> {
    await rm(this.path(key), { force: true });
  }

  async getSignedUrl(key: string, _expiresInSeconds: number): Promise<string> {
    this.path(key);
    return Promise.resolve(key);
  }

  private path(key: string): string {
    if (!key || key.trim() === '') {
      throw new Error('Invalid storage key');
    }
    if (key.includes('\0')) {
      throw new Error('Invalid storage key');
    }
    if (isAbsolute(key)) {
      throw new Error('Invalid storage key');
    }

    const normalizedKey = key.replaceAll('\\', '/');
    const candidate = resolve(this.storageRoot, normalizedKey);
    const rel = relative(this.storageRoot, candidate);

    if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
      throw new Error('Storage key escapes configured root');
    }

    return candidate;
  }
}
