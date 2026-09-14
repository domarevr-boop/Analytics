import { readV4BackupProfitability } from './inspect-v4-backup.mjs';
import { auditV4Profitability } from './v5-profitability-audit-core.mjs';

const sourcePath = process.argv[2];
if (!sourcePath) {
  console.error('Usage: node scripts/inspect-v4-profitability.mjs <v4-backup.json>');
  process.exitCode = 1;
} else {
  try {
    const source = await readV4BackupProfitability(sourcePath);
    console.log(JSON.stringify({
      version: source.version,
      exportedAt: source.exportedAt,
      sizeBytes: source.sizeBytes,
      audit: auditV4Profitability(source.profitability, source.metrics, source.products, source.importLogs),
    }, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
