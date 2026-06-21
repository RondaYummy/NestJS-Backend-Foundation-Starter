import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { validateDockerignorePolicy } from './release-policy';

const repositoryRoot = join(__dirname, '..', '..');
const dockerignorePath = join(repositoryRoot, '.dockerignore');
const dockerignoreContent = readFileSync(dockerignorePath, 'utf8');
const result = validateDockerignorePolicy(dockerignoreContent);

if (!result.ok) {
  process.stderr.write('.dockerignore is missing required deny patterns:\n');
  for (const missing of result.missing) {
    process.stderr.write(`  - ${missing.line} (${missing.description})\n`);
  }
  process.exit(1);
}

process.stdout.write('.dockerignore release policy check passed.\n');
