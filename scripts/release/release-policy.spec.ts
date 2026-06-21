/// <reference types="jest" />

import {
  findMissingRequiredFiles,
  isForbiddenArchivePath,
  normalizeArchivePath,
  scanTextForSecrets,
  validateDockerignorePolicy,
} from './release-policy';

describe('release-policy', () => {
  describe('normalizeArchivePath', () => {
    it('normalizes Windows separators and leading slashes', () => {
      expect(normalizeArchivePath('\\foo\\bar')).toBe('foo/bar');
      expect(normalizeArchivePath('/package.json')).toBe('package.json');
    });
  });

  describe('isForbiddenArchivePath', () => {
    it('rejects env files, git metadata, dependencies, and dump artifacts', () => {
      expect(isForbiddenArchivePath('.env')).toBe(true);
      expect(isForbiddenArchivePath('.env.local')).toBe(true);
      expect(isForbiddenArchivePath('apps/api/.env')).toBe(true);
      expect(isForbiddenArchivePath('.git/config')).toBe(true);
      expect(isForbiddenArchivePath('node_modules/lodash/index.js')).toBe(true);
      expect(isForbiddenArchivePath('dist/apps/api/main.js')).toBe(true);
      expect(isForbiddenArchivePath('backup/database.dump')).toBe(true);
      expect(isForbiddenArchivePath('backup/database.sql.gz')).toBe(true);
      expect(isForbiddenArchivePath('certs/server.pem')).toBe(true);
    });

    it('allows required starter files and tracked migrations', () => {
      expect(isForbiddenArchivePath('.env.example')).toBe(false);
      expect(isForbiddenArchivePath('package.json')).toBe(false);
      expect(isForbiddenArchivePath('libs/infrastructure/src/database/migrations/0001.sql')).toBe(
        false,
      );
    });

    it('rejects path traversal in member names', () => {
      expect(isForbiddenArchivePath('../.env')).toBe(true);
      expect(isForbiddenArchivePath('foo/../../.env')).toBe(true);
    });
  });

  describe('findMissingRequiredFiles', () => {
    it('reports absent required entries', () => {
      const missing = findMissingRequiredFiles(['package.json', '.env.example']);
      expect(missing).toEqual(expect.arrayContaining(['Dockerfile', '.dockerignore']));
    });
  });

  describe('validateDockerignorePolicy', () => {
    it('passes when required deny patterns are present', () => {
      const sample = ['.git', '.env', '.env.*', '!.env.example', 'node_modules', 'dist'].join('\n');
      expect(validateDockerignorePolicy(sample).ok).toBe(true);
    });

    it('fails when a required deny pattern is missing', () => {
      const sample = ['.git', '.env', 'node_modules', 'dist'].join('\n');
      const result = validateDockerignorePolicy(sample);
      expect(result.ok).toBe(false);
      expect(result.missing.some((item) => item.line === '.env.*')).toBe(true);
    });
  });

  describe('scanTextForSecrets', () => {
    it('detects high-confidence secret patterns', () => {
      const findings = scanTextForSecrets(
        'AWS_KEY=AKIAIOSFODNN7EXAMPLE\n-----BEGIN PRIVATE KEY-----\n',
        'secrets.txt',
      );
      expect(findings.some((finding) => finding.id === 'aws-access-key')).toBe(true);
      expect(findings.some((finding) => finding.id === 'private-key-block')).toBe(true);
    });

    it('allows documented dev placeholders in .env.example', () => {
      const findings = scanTextForSecrets(
        'JWT_SECRET=dev-secret\nJWT_REFRESH_SECRET=dev-refresh-secret\n',
        '.env.example',
      );
      expect(findings).toHaveLength(0);
    });
  });
});
