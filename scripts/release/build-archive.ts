import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const repositoryRoot = join(__dirname, '..', '..');
const packageJson = JSON.parse(readFileSync(join(repositoryRoot, 'package.json'), 'utf8')) as {
  version: string;
};
const gitRef = process.env.RELEASE_GIT_REF ?? 'HEAD';
const outputDirectory = join(repositoryRoot, 'dist', 'release');
const archiveName = `nestjs-backend-foundation-starter-${packageJson.version}.zip`;
const outputPath = join(outputDirectory, archiveName);

mkdirSync(outputDirectory, { recursive: true });

const result = spawnSync('git', ['archive', '--format=zip', `--output=${outputPath}`, gitRef], {
  cwd: repositoryRoot,
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
});

if (result.status !== 0) {
  process.stderr.write(result.stderr ?? '');
  process.stderr.write(
    `\nrelease:archive failed for git ref "${gitRef}". Ensure git is installed and the ref exists.\n`,
  );
  process.exit(result.status ?? 1);
}

process.stdout.write(`Created release archive: ${outputPath}\n`);
