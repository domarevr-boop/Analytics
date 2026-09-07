import assert from 'node:assert/strict';
import test from 'node:test';

import { summarizeBackupPrerequisites } from './v5-backup-prerequisites.mjs';

test('Supabase CLI backup path requires Docker', () => {
  const result = summarizeBackupPrerequisites({
    hasSupabaseCli: true,
    hasDocker: false,
    hasPgDump: false,
    hasPgRestore: false,
    hasPsql: false,
  });

  assert.equal(result.storageExportReady, true);
  assert.equal(result.supabaseDatabaseDumpReady, false);
  assert.equal(result.databaseToolingReady, false);
  assert.equal(result.restoreProven, false);
});

test('direct PostgreSQL path requires the complete tool set', () => {
  const incomplete = summarizeBackupPrerequisites({
    hasSupabaseCli: true,
    hasDocker: false,
    hasPgDump: true,
    hasPgRestore: true,
    hasPsql: false,
  });
  const complete = summarizeBackupPrerequisites({
    hasSupabaseCli: true,
    hasDocker: false,
    hasPgDump: true,
    hasPgRestore: true,
    hasPsql: true,
  });

  assert.equal(incomplete.directPostgresToolsReady, false);
  assert.equal(incomplete.databaseToolingReady, false);
  assert.equal(complete.directPostgresToolsReady, true);
  assert.equal(complete.databaseToolingReady, true);
});
