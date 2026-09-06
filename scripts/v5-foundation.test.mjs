import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';

const activeDirectory = new URL('../supabase/migrations/', import.meta.url);
const legacyDirectory = new URL('../supabase/legacy-v4/migrations/', import.meta.url);

test('active V5 migration chain is isolated from the V4 and CX history', () => {
  const active = readdirSync(activeDirectory).filter(name => name.endsWith('.sql'));
  const legacy = readdirSync(legacyDirectory).filter(name => name.endsWith('.sql'));

  assert.deepEqual(active, [
    '20260906000000_v5_foundation.sql',
    '20260906001000_v5_access_management.sql',
  ]);
  assert.equal(legacy.length, 21);
  assert.ok(legacy.some(name => name.includes('client_experience')));
});

test('access management requires an existing administrator and keeps bootstrap private', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20260906001000_v5_access_management.sql', import.meta.url), 'utf8');
  for (const fragment of [
    'create table app.access_audit',
    'app.bootstrap_first_admin',
    'public.v5_admin_set_user_access',
    'public.v5_admin_set_cabinet_access',
    'if not app.is_admin()',
    'cannot demote or disable their own account',
    "'schema_version', '20260906001000'",
  ]) {
    assert.ok(sql.toLowerCase().includes(fragment.toLowerCase()), `missing access contract: ${fragment}`);
  }
  assert.match(
    sql,
    /revoke all on function app\.bootstrap_first_admin\(uuid\) from public, anon, authenticated, service_role/iu,
  );
  assert.doesNotMatch(sql, /insert\s+into\s+auth\.users/iu);
});

test('first-admin command refuses ambiguous Auth state', () => {
  const sql = readFileSync(new URL('../supabase/scripts/bootstrap_only_auth_user.sql', import.meta.url), 'utf8');
  assert.match(sql, /v_user_count\s*<>\s*1/iu);
  assert.match(sql, /app\.bootstrap_first_admin\(v_user_id\)/iu);
  assert.doesNotMatch(sql, /[\w.+-]+@[\w.-]+/iu);
});

test('admin smoke check is transactional and does not expose identity', () => {
  const sql = readFileSync(new URL('../supabase/tests/admin_access_smoke.sql', import.meta.url), 'utf8');
  assert.match(sql, /^begin;/iu);
  assert.match(sql, /set local role authenticated/iu);
  assert.match(sql, /public\.v5_admin_set_user_access/iu);
  assert.match(sql, /rollback;/iu);
  assert.doesNotMatch(sql, /[\w.+-]+@[\w.-]+/iu);
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
