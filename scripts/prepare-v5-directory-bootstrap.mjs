import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { readV4BackupCatalog } from './inspect-v4-backup.mjs';
import { buildDirectoryBootstrap, validateDirectoryBootstrap } from './v5-directory-bootstrap-core.mjs';

async function sha256(filePath) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

const sourcePath = process.argv[2];
const outputPath = resolve(process.argv[3] || '.v5-local/directory-bootstrap.json');
if (!sourcePath) {
  console.error('Usage: node scripts/prepare-v5-directory-bootstrap.mjs <v4-backup.json> [output.json]');
  process.exitCode = 1;
} else {
  try {
    const source = await readV4BackupCatalog(sourcePath);
    const bootstrap = buildDirectoryBootstrap(source.catalog);
    const validationErrors = validateDirectoryBootstrap(bootstrap);
    if (validationErrors.length > 0) {
      throw new Error(`Directory bootstrap validation failed: ${JSON.stringify(validationErrors)}`);
    }
    const artifact = {
      schemaVersion: bootstrap.schemaVersion,
      source: {
        version: source.version,
        exportedAt: source.exportedAt,
        sizeBytes: source.sizeBytes,
        sha256: await sha256(sourcePath),
      },
      generatedAt: new Date().toISOString(),
      ...bootstrap,
    };
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, { flag: 'wx' });
    console.log(JSON.stringify({ outputPath, source: artifact.source, summary: artifact.summary }, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
