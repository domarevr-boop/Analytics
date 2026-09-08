import { readV4BackupCompetitors } from './inspect-v4-backup.mjs';
import { auditV4Competitors } from './v5-competitor-audit-core.mjs';

const sourcePath = process.argv[2];
if (!sourcePath) {
  console.error('Usage: node scripts/inspect-v4-competitors.mjs <v4-backup.json>');
  process.exitCode = 1;
} else {
  try {
    const source = await readV4BackupCompetitors(sourcePath);
    console.log(JSON.stringify({
      version: source.version,
      exportedAt: source.exportedAt,
      sizeBytes: source.sizeBytes,
      audit: auditV4Competitors(source.competitors),
    }, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
