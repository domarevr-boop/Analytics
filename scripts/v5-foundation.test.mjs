import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';

const activeDirectory = new URL('../supabase/migrations/', import.meta.url);
const legacyDirectory = new URL('../supabase/legacy-v4/migrations/', import.meta.url);

test('active V5 migration chain is isolated from the V4 and CX history', () => {
  const active = readdirSync(activeDirectory).filter(name => name.endsWith('.sql'));
  const legacy = readdirSync(legacyDirectory).filter(name => name.endsWith('.sql'));

  assert.deepEqual(active, ['20260906000000_v5_foundation.sql']);
  assert.equal(legacy.length, 21);
  assert.ok(legacy.some(name => name.includes('client_experience')));
});

test('foundation migration contains the required isolation and ingestion contracts', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20260906000000_v5_foundation.sql', import.meta.url), 'utf8');
  for (const fragment of [
    'create schema if not exists app',
    'create schema if not exists ingest',
    'create schema if not exists core',
    'create schema if not exists analytics',
    'create table ingest.import_batches',
    'create table ingest.import_files',
    'create table ingest.import_rows',
    'create table ingest.import_errors',
    'create table analytics.metric_definitions',
    "'v5-import-sources'",
    'enable row level security',
  ]) {
    assert.ok(sql.toLowerCase().includes(fragment), `missing SQL contract: ${fragment}`);
  }
  assert.doesNotMatch(sql, /service_role\s*=/iu);
  assert.doesNotMatch(sql, /https:\/\/[a-z0-9]+\.supabase\.co/iu);
});
