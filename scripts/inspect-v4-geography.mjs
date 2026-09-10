import { readV4BackupGeography } from './inspect-v4-backup.mjs';
import { auditV4Geography } from './v5-geography-audit-core.mjs';

const sourcePath = process.argv[2];
if (!sourcePath) {
  console.error('Usage: node scripts/inspect-v4-geography.mjs <v4-backup.json>');
  process.exitCode = 1;
} else {
  try {
    const source = await readV4BackupGeography(sourcePath);
    console.log(JSON.stringify({
      version: source.version,
      exportedAt: source.exportedAt,
      sizeBytes: source.sizeBytes,
      audit: auditV4Geography(source.geography, source.products),
    }, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
