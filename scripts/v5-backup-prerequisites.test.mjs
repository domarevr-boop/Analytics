import assert from 'node:assert/strict';
import test from 'node:test';

import { portableCommandAvailable, summarizeBackupPrerequisites } from './v5-backup-prerequisites.mjs';

test('portable command lookup resolves the platform executable inside the supplied bundle', () => {
  let resolvedPath = '';
  const available = portableCommandAvailable('pg_dump', 'win32', 'C:\\portable-pg', candidate => {
    resolvedPath = candidate;
    return true;
  });

  assert.equal(available, true);
  assert.match(resolvedPath, /portable-pg[\\/]pg_dump\.exe$/u);
  assert.equal(portableCommandAvailable('__missing_v5_backup_tool__'), false);
});

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
