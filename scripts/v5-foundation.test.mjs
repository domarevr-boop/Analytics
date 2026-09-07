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
    '20260906002000_v5_market_pilot.sql',
    '20260906003000_v5_market_pilot_lint_fixes.sql',
    '20260906004000_v5_market_version_order.sql',
    '20260906005000_v5_market_batch_summary.sql',
    '20260907000000_v5_market_retry_reset.sql',
    '20260907001000_v5_market_retry_reset_lint_fix.sql',
    '20260907002000_v5_market_retry_upload_timestamp.sql',
    '20260907003000_v5_access_directory.sql',
    '20260907004000_v5_market_batch_history.sql',
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

test('V5 user directory exposes Auth identities only through an admin RPC', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20260907003000_v5_access_directory.sql', import.meta.url), 'utf8');
  assert.match(sql, /public\.v5_admin_user_directory\(\)/iu);
  assert.match(sql, /if not app\.is_admin\(\)/iu);
  assert.match(sql, /from auth\.users users/iu);
  assert.match(sql, /revoke all on function public\.v5_admin_user_directory\(\) from public, anon/iu);
  assert.match(sql, /grant execute on function public\.v5_admin_user_directory\(\) to authenticated/iu);
  assert.match(sql, /'schema_version',\s*'20260907003000'/iu);
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

test('viewer and importer smoke checks roll back role, cabinet and batch fixtures', () => {
  const sql = readFileSync(new URL('../supabase/tests/role_access_smoke.sql', import.meta.url), 'utf8');
  assert.equal((sql.match(/^begin;/gimu) ?? []).length, 2);
  assert.equal((sql.match(/^rollback;/gimu) ?? []).length, 2);
  assert.match(sql, /set access_role = 'viewer'/iu);
  assert.match(sql, /set access_role = 'importer'/iu);
  assert.match(sql, /insert into ingest\.import_batches/iu);
  assert.match(sql, /denied_cabinet_hidden/iu);
  assert.doesNotMatch(sql, /[\w.+-]+@[\w.-]+/iu);
});

test('market pilot keeps raw lineage, validates server-side and reads through bounded RPC', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20260906002000_v5_market_pilot.sql', import.meta.url), 'utf8');
  const fixes = readFileSync(new URL('../supabase/migrations/20260906003000_v5_market_pilot_lint_fixes.sql', import.meta.url), 'utf8');
  const ordering = readFileSync(new URL('../supabase/migrations/20260906004000_v5_market_version_order.sql', import.meta.url), 'utf8');
  const summary = readFileSync(new URL('../supabase/migrations/20260906005000_v5_market_batch_summary.sql', import.meta.url), 'utf8');
  const retryReset = readFileSync(new URL('../supabase/migrations/20260907000000_v5_market_retry_reset.sql', import.meta.url), 'utf8');
  const retryResetFix = readFileSync(new URL('../supabase/migrations/20260907001000_v5_market_retry_reset_lint_fix.sql', import.meta.url), 'utf8');
  const retryUploadTimestamp = readFileSync(new URL('../supabase/migrations/20260907002000_v5_market_retry_upload_timestamp.sql', import.meta.url), 'utf8');
  for (const fragment of [
    'create table analytics.market_daily_versions',
    'create or replace view analytics.market_daily_current',
    'public.v5_market_create_batch',
    'public.v5_market_stage_rows',
    'public.v5_market_publish_batch',
    'public.v5_market_rollback_batch',
    'public.v5_market_series',
    'duplicate_date',
    "batch.status = 'published'",
    "'schema_version', '20260906002000'",
  ]) {
    assert.ok(sql.toLowerCase().includes(fragment.toLowerCase()), `missing market pilot contract: ${fragment}`);
  }
  assert.match(sql, /jsonb_array_length\(p_rows\)\s*>\s*500/iu);
  assert.match(sql, /v_total_rows\s*>\s*50000/iu);
  assert.match(sql, /p_size_bytes\s*>\s*10485760/iu);
  assert.doesNotMatch(sql, /service_role\s*=/iu);
  assert.match(fixes, /extensions\.digest/iu);
  assert.match(fixes, /alter function ingest\.is_iso_date\(text\) stable/iu);
  assert.match(fixes, /'schema_version',\s*'20260906003000'/iu);
  assert.match(ordering, /version_order bigint generated always as identity/iu);
  assert.match(ordering, /order by row_data\.version_order desc/iu);
  assert.match(ordering, /'schema_version',\s*'20260906004000'/iu);
  assert.match(summary, /public\.v5_market_batch_summary/iu);
  assert.match(summary, /not app\.can_import\(\)/iu);
  assert.match(summary, /'source_file_retained'/iu);
  assert.match(summary, /'schema_version',\s*'20260906005000'/iu);
  assert.match(retryReset, /public\.v5_market_reset_staging/iu);
  assert.match(retryReset, /v_batch\.status not in \('created', 'uploaded', 'validating', 'failed'\)/iu);
  assert.match(retryReset, /delete from ingest\.import_rows where batch_id = p_batch_id/iu);
  assert.match(retryReset, /'schema_version',\s*'20260907000000'/iu);
  assert.match(retryResetFix, /'uploaded'::ingest\.batch_status/iu);
  assert.match(retryResetFix, /'created'::ingest\.batch_status/iu);
  assert.match(retryResetFix, /'schema_version',\s*'20260907001000'/iu);
  assert.match(retryUploadTimestamp, /when v_source_exists then coalesce\(uploaded_at, timezone\('utc', now\(\)\)\)/iu);
  assert.match(retryUploadTimestamp, /'schema_version',\s*'20260907002000'/iu);
});

test('market pilot smoke covers publish, replacement, rollback and invalid rows transactionally', () => {
  const sql = readFileSync(new URL('../supabase/tests/market_pilot_smoke.sql', import.meta.url), 'utf8');
  for (const fragment of [
    'public.v5_market_create_batch',
    'public.v5_market_stage_rows',
    'public.v5_market_publish_batch',
    'public.v5_market_rollback_batch',
    'Monthly market aggregation assertion failed',
    'Invalid market row assertion failed',
    'rollback;',
  ]) {
    assert.ok(sql.includes(fragment), `missing market smoke contract: ${fragment}`);
  }
  assert.doesNotMatch(sql, /commit;/iu);
  assert.doesNotMatch(sql, /[\w.+-]+@[\w.-]+/iu);
});

test('market batch history is bounded and respects batch visibility', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20260907004000_v5_market_batch_history.sql', import.meta.url), 'utf8');
  assert.match(sql, /public\.v5_market_batch_history\(p_limit integer default 20\)/iu);
  assert.match(sql, /p_limit > 50/iu);
  assert.match(sql, /app\.can_read_batch\(batch\.id\)/iu);
  assert.match(sql, /source_file_retained/iu);
  assert.match(sql, /revoke all on function public\.v5_market_batch_history\(integer\) from public, anon/iu);
  assert.match(sql, /'schema_version',\s*'20260907004000'/iu);
});

test('market client clears stale retry staging before sending normalized chunks', () => {
  const source = readFileSync(new URL('../src/features/market/marketImport.ts', import.meta.url), 'utf8');
  const resetIndex = source.indexOf("supabase.rpc('v5_market_reset_staging'");
  const stageIndex = source.indexOf("supabase.rpc('v5_market_stage_rows'");
  assert.ok(resetIndex >= 0, 'market retry-reset RPC is missing');
  assert.ok(stageIndex > resetIndex, 'market rows must be staged only after retry-reset');
});

test('market import UI requests bounded server batch history', () => {
  const source = readFileSync(new URL('../src/features/market/marketImport.ts', import.meta.url), 'utf8');
  assert.match(source, /export async function getMarketImportHistory\(limit = 20\)/iu);
  assert.match(source, /supabase\.rpc\('v5_market_batch_history', \{ p_limit: safeLimit \}\)/iu);
  assert.match(source, /Math\.max\(1, Math\.min\(50, Math\.trunc\(limit\)\)\)/iu);
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
