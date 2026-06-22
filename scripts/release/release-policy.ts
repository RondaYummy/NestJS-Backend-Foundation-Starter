/**
 * Shared release archive deny/require policy and matching helpers.
 * Used by verify-archive, dockerignore-policy, and unit tests.
 */

export const FORBIDDEN_DIRECTORY_PREFIXES = [
  'node_modules/',
  'dist/',
  'coverage/',
  'storage/',
] as const;

export const FORBIDDEN_EXACT_PATHS = ['.env', '.env.local'] as const;

export const FORBIDDEN_EXTENSIONS = ['.pem', '.key', '.p12', '.pfx', '.dump', '.sql.gz'] as const;

export const REQUIRED_ARCHIVE_ENTRIES = [
  '.env.example',
  'package.json',
  'Dockerfile',
  '.dockerignore',
] as const;

export const DOCKERIGNORE_REQUIRED_PATTERNS = [
  { line: '.git', description: 'exclude git metadata from Docker build context' },
  { line: '.env', description: 'exclude local env file from Docker build context' },
  { line: '.env.*', description: 'exclude env variants from Docker build context' },
  { line: '!.env.example', description: 'keep env template in Docker build context' },
  { line: 'node_modules', description: 'exclude dependencies from Docker build context' },
  { line: 'dist', description: 'exclude build output from Docker build context' },
] as const;

export const SECRET_CONTENT_PATTERNS = [
  {
    id: 'aws-access-key',
    regex: /\bAKIA[0-9A-Z]{16}\b/,
    message: 'Possible AWS access key id',
  },
  {
    id: 'private-key-block',
    regex: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
    message: 'Private key block',
  },
] as const;

export const PLACEHOLDER_SECRET_VALUES = new Set([
  '',
  'dev-secret',
  'dev-refresh-secret',
  'CHANGE_ME',
  'changeme',
  'your-secret-here',
  'replace-me',
]);

export const PLACEHOLDER_SECRET_PREFIXES = ['CHANGE_ME_', 'YOUR_', 'REPLACE_'] as const;

export const CONTENT_SCAN_MAX_BYTES = 256 * 1024;

export type SecretFinding = {
  id: string;
  message: string;
  line: number;
};

export function normalizeArchivePath(entryPath: string): string {
  return entryPath.replace(/\\/g, '/').replace(/^\/+/, '');
}

export function hasForbiddenTraversal(entryPath: string): boolean {
  const normalized = normalizeArchivePath(entryPath);
  return (
    normalized.includes('../') ||
    normalized.startsWith('..') ||
    normalized.includes('/..') ||
    normalized.endsWith('/..')
  );
}

export function isForbiddenArchivePath(entryPath: string): boolean {
  const normalized = normalizeArchivePath(entryPath);

  if (hasForbiddenTraversal(normalized)) {
    return true;
  }

  if ((FORBIDDEN_EXACT_PATHS as readonly string[]).includes(normalized)) {
    return true;
  }

  if (normalized.endsWith('/.env') || normalized === '.env') {
    return true;
  }

  const fileName = normalized.split('/').pop() ?? normalized;
  if (fileName.startsWith('.env.') && fileName !== '.env.example') {
    return true;
  }

  if (normalized === '.git' || normalized.startsWith('.git/')) {
    return true;
  }

  for (const prefix of FORBIDDEN_DIRECTORY_PREFIXES) {
    const dirName = prefix.slice(0, -1);
    if (normalized === dirName || normalized.startsWith(prefix)) {
      return true;
    }
  }

  for (const extension of FORBIDDEN_EXTENSIONS) {
    if (normalized.endsWith(extension)) {
      return true;
    }
  }

  return false;
}

export function findMissingRequiredFiles(entries: string[]): string[] {
  const normalizedEntries = new Set(entries.map((entry) => normalizeArchivePath(entry)));
  return REQUIRED_ARCHIVE_ENTRIES.filter((required) => !normalizedEntries.has(required));
}

export function validateDockerignorePolicy(dockerignoreContent: string): {
  ok: boolean;
  missing: { line: string; description: string }[];
} {
  const lines = dockerignoreContent
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));

  const missing = DOCKERIGNORE_REQUIRED_PATTERNS.filter(
    ({ line }) => !lines.some((candidate) => candidate === line),
  );

  return { ok: missing.length === 0, missing: [...missing] };
}

export function shouldScanEntryForSecrets(entryPath: string): boolean {
  const normalized = normalizeArchivePath(entryPath);
  const fileName = normalized.split('/').pop() ?? normalized;
  return !/\.(spec|int-spec|test)\.ts$/i.test(fileName);
}

export function isLikelyPlaceholderSecret(value: string): boolean {
  const trimmed = value.trim();
  if (PLACEHOLDER_SECRET_VALUES.has(trimmed)) {
    return true;
  }

  return PLACEHOLDER_SECRET_PREFIXES.some((prefix) => trimmed.startsWith(prefix));
}

export function scanTextForSecrets(content: string, entryPath: string): SecretFinding[] {
  const normalizedPath = normalizeArchivePath(entryPath);
  const findings: SecretFinding[] = [];

  for (const pattern of SECRET_CONTENT_PATTERNS) {
    if (pattern.regex.test(content)) {
      findings.push({
        id: pattern.id,
        message: `${pattern.message} in ${normalizedPath}`,
        line: 0,
      });
    }
  }

  const lines = content.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    const assignment = line.match(/^([A-Z0-9_]+)\s*=\s*(.+)$/);
    if (!assignment) {
      continue;
    }

    const key = assignment[1];
    const rawValue = assignment[2];
    if (!key || !rawValue) {
      continue;
    }

    const value = rawValue.trim().replace(/^['"]|['"]$/g, '');

    if (!key.includes('SECRET') && !key.includes('PASSWORD') && !key.includes('TOKEN')) {
      continue;
    }

    if (isLikelyPlaceholderSecret(value)) {
      continue;
    }

    if (normalizedPath.endsWith('.env.example') && value.length <= 64) {
      continue;
    }

    if (value.length >= 32 && /[A-Za-z0-9+/=_-]{32,}/.test(value)) {
      findings.push({
        id: 'high-entropy-assignment',
        message: `High-entropy ${key} assignment in ${normalizedPath}`,
        line: index + 1,
      });
    }
  }

  return findings;
}
