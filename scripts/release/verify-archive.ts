import { createReadStream, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';

import {
  CONTENT_SCAN_MAX_BYTES,
  findMissingRequiredFiles,
  isForbiddenArchivePath,
  normalizeArchivePath,
  scanTextForSecrets,
} from './release-policy';

const repositoryRoot = join(__dirname, '..', '..');
const defaultReleaseDirectory = join(repositoryRoot, 'dist', 'release');

type ZipEntry = {
  path: string;
  compressionMethod: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
};

async function readZipEntries(zipPath: string): Promise<{ entries: ZipEntry[]; buffer: Buffer }> {
  const buffer = await readFileBuffer(zipPath);
  const eocdOffset = findEndOfCentralDirectoryOffset(buffer);

  if (eocdOffset < 0) {
    throw new Error(`Invalid ZIP archive: end of central directory not found (${zipPath})`);
  }

  const centralDirectorySize = buffer.readUInt32LE(eocdOffset + 12);
  const centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16);
  const entries: ZipEntry[] = [];
  let offset = centralDirectoryOffset;
  const end = centralDirectoryOffset + centralDirectorySize;

  while (offset < end) {
    const signature = buffer.readUInt32LE(offset);
    if (signature !== 0x02014b50) {
      throw new Error(`Invalid ZIP central directory entry at offset ${offset}`);
    }

    const compressionMethod = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraFieldLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const fileName = buffer.toString('utf8', offset + 46, offset + 46 + fileNameLength);

    entries.push({
      path: fileName,
      compressionMethod,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
    });

    offset += 46 + fileNameLength + extraFieldLength + commentLength;
  }

  return { entries, buffer };
}

function readFileBuffer(zipPath: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    createReadStream(zipPath)
      .on('data', (chunk: Buffer) => chunks.push(chunk))
      .on('error', reject)
      .on('end', () => resolve(Buffer.concat(chunks)));
  });
}

function findEndOfCentralDirectoryOffset(buffer: Buffer): number {
  const minimumOffset = Math.max(0, buffer.length - 65557);
  for (let offset = buffer.length - 22; offset >= minimumOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) {
      return offset;
    }
  }
  return -1;
}

function extractEntryBuffer(buffer: Buffer, entry: ZipEntry): Buffer {
  const localOffset = entry.localHeaderOffset;
  const localSignature = buffer.readUInt32LE(localOffset);
  if (localSignature !== 0x04034b50) {
    throw new Error(`Invalid ZIP local header for ${entry.path}`);
  }

  const fileNameLength = buffer.readUInt16LE(localOffset + 26);
  const extraFieldLength = buffer.readUInt16LE(localOffset + 28);
  const dataOffset = localOffset + 30 + fileNameLength + extraFieldLength;
  const compressedData = buffer.subarray(dataOffset, dataOffset + entry.compressedSize);

  if (entry.compressionMethod === 0) {
    return compressedData;
  }

  if (entry.compressionMethod === 8) {
    return inflateRawSync(compressedData);
  }

  throw new Error(
    `Unsupported ZIP compression method ${entry.compressionMethod} for ${entry.path}`,
  );
}

function resolveLatestArchivePath(releaseDirectory: string): string {
  const archives = readdirSync(releaseDirectory)
    .filter((name) => name.endsWith('.zip'))
    .map((name) => join(releaseDirectory, name))
    .filter((path) => statSync(path).isFile())
    .sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs);

  if (archives.length === 0) {
    throw new Error(`No release archives found in ${releaseDirectory}`);
  }

  return archives[0] as string;
}

async function verifyArchive(zipPath: string): Promise<number> {
  const { entries, buffer } = await readZipEntries(zipPath);
  const normalizedPaths = entries.map((entry) => normalizeArchivePath(entry.path));
  const forbidden = normalizedPaths.filter((entryPath) => isForbiddenArchivePath(entryPath));
  const missingRequired = findMissingRequiredFiles(normalizedPaths);
  const secretFindings = [];

  for (const entry of entries) {
    if (entry.uncompressedSize === 0 || entry.uncompressedSize > CONTENT_SCAN_MAX_BYTES) {
      continue;
    }

    const normalizedPath = normalizeArchivePath(entry.path);
    if (
      !/\.(env|example|md|txt|json|ya?ml|toml|js|mjs|cjs|ts|tsx|sh|properties)$/i.test(
        normalizedPath,
      )
    ) {
      continue;
    }

    const contentBuffer = extractEntryBuffer(buffer, entry);
    const content = contentBuffer.toString('utf8');
    secretFindings.push(...scanTextForSecrets(content, normalizedPath));
  }

  process.stdout.write(`Archive: ${zipPath}\n`);
  process.stdout.write(`Entries: ${entries.length}\n`);
  process.stdout.write(`Required files present: ${missingRequired.length === 0 ? 'yes' : 'no'}\n`);

  if (forbidden.length > 0) {
    process.stderr.write('Forbidden paths detected:\n');
    for (const entryPath of forbidden) {
      process.stderr.write(`  - ${entryPath}\n`);
    }
  }

  if (missingRequired.length > 0) {
    process.stderr.write('Missing required files:\n');
    for (const entryPath of missingRequired) {
      process.stderr.write(`  - ${entryPath}\n`);
    }
  }

  if (secretFindings.length > 0) {
    process.stderr.write('Potential secret patterns detected:\n');
    for (const finding of secretFindings) {
      process.stderr.write(`  - [${finding.id}] ${finding.message}\n`);
    }
  }

  if (forbidden.length > 0 || missingRequired.length > 0 || secretFindings.length > 0) {
    return 1;
  }

  process.stdout.write('Release archive verification passed.\n');
  return 0;
}

const zipPathArg = process.argv[2];
const zipPath = zipPathArg ?? resolveLatestArchivePath(defaultReleaseDirectory);

verifyArchive(zipPath)
  .then((exitCode) => process.exit(exitCode))
  .catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
