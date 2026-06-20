/// <reference types="jest" />

import { access, mkdtemp, readdir, rm } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { LocalStorageAdapter } from './local-storage.adapter';
import type { AppConfigService } from '../config/app-config.service';

describe('LocalStorageAdapter', () => {
  let tempRoot: string;
  let adapter: LocalStorageAdapter;

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'local-storage-'));
    const config = {
      storage: () => ({ localPath: tempRoot }),
    } as unknown as AppConfigService;
    adapter = new LocalStorageAdapter(config);
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  describe('valid keys', () => {
    it('writes, reads, and deletes nested key under root', async () => {
      const key = 'users/123/avatar.png';
      const body = Buffer.from('avatar-data');

      const putResult = await adapter.putObject({ key, body });
      expect(putResult).toEqual({ key });
      expect(putResult.url).toBeUndefined();

      const storedPath = resolve(tempRoot, key);
      expect(relative(tempRoot, storedPath).replaceAll('\\', '/')).toBe(key);

      const content = await adapter.getObject(key);
      expect(content).toEqual(body);

      await adapter.deleteObject(key);
      await expect(access(storedPath)).rejects.toThrow();
    });

    it('getSignedUrl returns storage key and ignores expiresInSeconds', async () => {
      const key = 'users/123/avatar.png';
      await adapter.putObject({ key, body: Buffer.from('x') });

      const url = await adapter.getSignedUrl(key, 3600);
      expect(url).toBe(key);
    });
  });

  describe('V-03 negative traversal matrix', () => {
    const maliciousKeys = [
      '../outside.txt',
      '..\\outside.txt',
      '/tmp/outside.txt',
      'C:\\outside.txt',
      'users/../../outside.txt',
      'users/../..',
      '',
      'key\0suffix',
    ];

    it.each(maliciousKeys)('rejects malicious key %j before filesystem access', async (key) => {
      await expect(adapter.putObject({ key, body: Buffer.from('x') })).rejects.toThrow();
      await expect(async () => {
        await adapter.getObject(key);
      }).rejects.toThrow();
      await expect(async () => {
        await adapter.deleteObject(key);
      }).rejects.toThrow();
      await expect(adapter.getSignedUrl(key, 60)).rejects.toThrow();
    });

    it('does not create files outside temp root for rejected keys', async () => {
      const outsideDir = await mkdtemp(join(tmpdir(), 'local-storage-outside-'));
      const outsideFile = join(outsideDir, 'escaped.txt');

      try {
        await expect(
          adapter.putObject({ key: '../escaped.txt', body: Buffer.from('x') }),
        ).rejects.toThrow();

        await expect(access(outsideFile)).rejects.toThrow();

        const rootEntries = await readdir(tempRoot, { recursive: true });
        expect(rootEntries).toEqual([]);
      } finally {
        await rm(outsideDir, { recursive: true, force: true });
      }
    });

    it('stores valid nested keys only under the configured root', async () => {
      const key = 'users/123/avatar.png';
      await adapter.putObject({ key, body: Buffer.from('avatar-data') });

      const storedPath = resolve(tempRoot, 'users', '123', 'avatar.png');
      await expect(access(storedPath)).resolves.toBeUndefined();
      expect(relative(tempRoot, storedPath).replaceAll('\\', '/')).toBe('users/123/avatar.png');
    });
  });
});
