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
    '20260907005000_v5_market_batch_errors.sql',
    '20260907006000_v5_market_source_download.sql',
    '20260907007000_v5_market_batch_events.sql',
    '20260907008000_v5_product_directory.sql',
    '20260908009000_v5_directory_bootstrap.sql',
    '20260908010000_v5_directory_read_api.sql',
    '20260908011000_v5_competitors_storage.sql',
    '20260908012000_v5_competitors_import.sql',
    '20260909013000_v5_competitors_read_api.sql',
    '20260909014000_v5_competitors_import_ui.sql',
    '20260910015000_v5_geography_storage.sql',
    '20260910016000_v5_geography_cabinet_versions.sql',
    '20260910017000_v5_geography_import.sql',
    '20260910018000_v5_geography_read_api.sql',
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

test('market batch error detail is bounded and checks importer plus batch access', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20260907005000_v5_market_batch_errors.sql', import.meta.url), 'utf8');
  assert.match(sql, /public\.v5_market_batch_errors/iu);
  assert.match(sql, /not app\.can_import\(\)/iu);
  assert.match(sql, /not app\.can_read_batch\(p_batch_id\)/iu);
  assert.match(sql, /p_limit > 200/iu);
  assert.match(sql, /from ingest\.import_errors error/iu);
  assert.match(sql, /'schema_version',\s*'20260907005000'/iu);
});

test('market history exposes a source path only after batch access is checked', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20260907006000_v5_market_source_download.sql', import.meta.url), 'utf8');
  assert.match(sql, /file\.object_path/iu);
  assert.match(sql, /app\.can_read_batch\(batch\.id\)/iu);
  assert.match(sql, /source_file_retained/iu);
  assert.match(sql, /'schema_version',\s*'20260907006000'/iu);
});

test('market batch event timeline is bounded and checks importer plus batch access', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20260907007000_v5_market_batch_events.sql', import.meta.url), 'utf8');
  assert.match(sql, /public\.v5_market_batch_events/iu);
  assert.match(sql, /not app\.can_import\(\)/iu);
  assert.match(sql, /not app\.can_read_batch\(p_batch_id\)/iu);
  assert.match(sql, /p_limit > 200/iu);
  assert.match(sql, /from ingest\.import_events event/iu);
  assert.doesNotMatch(sql, /event\.created_by/iu);
  assert.match(sql, /'schema_version',\s*'20260907007000'/iu);
});

test('V5 product directory keeps identities cabinet-scoped and group membership dated', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20260907008000_v5_product_directory.sql', import.meta.url), 'utf8');
  for (const fragment of [
    'create table core.brands',
    'create table core.categories',
    'create table core.products',
    'create table core.product_aliases',
    'create table core.product_groups',
    'create table core.group_membership_versions',
    'unique (cabinet_id, external_key)',
    'unique (cabinet_id, alias_value)',
    'unique (product_id, effective_date)',
    'public.v5_group_membership_at',
    "'schema_version', '20260907008000'",
  ]) assert.ok(sql.toLowerCase().includes(fragment.toLowerCase()), `missing directory contract: ${fragment}`);
  assert.match(sql, /app\.can_access_cabinet\(v_cabinet_id\)/iu);
  assert.match(sql, /membership\.effective_date\s*<=\s*p_date/iu);
  assert.match(sql, /order by membership\.effective_date desc/iu);
});

test('product directory smoke proves dated transitions and rolls back fixtures', () => {
  const sql = readFileSync(new URL('../supabase/tests/product_directory_smoke.sql', import.meta.url), 'utf8');
  assert.match(sql, /^begin;/iu);
  assert.match(sql, /unknown_before_first_membership/iu);
  assert.match(sql, /last_known_membership_applied/iu);
  assert.match(sql, /explicit_ungrouped_distinct/iu);
  assert.match(sql, /rollback;/iu);
  assert.doesNotMatch(sql, /commit;/iu);
});

test('directory bootstrap requires a retained manifest and publishes atomically', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20260908009000_v5_directory_bootstrap.sql', import.meta.url), 'utf8');
  for (const fragment of [
    "'product_registry'",
    'create table ingest.legacy_product_map',
    'create table ingest.directory_review_items',
    'public.v5_directory_create_batch',
    'public.v5_directory_publish_bootstrap',
    "object.bucket_id = 'v5-import-sources'",
    'Directory bootstrap source hash does not match its batch',
    'Directory bootstrap product conflicts with existing data',
    "'schema_version', '20260908009000'",
  ]) assert.ok(sql.includes(fragment), `missing directory bootstrap contract: ${fragment}`);
  assert.match(sql, /if v_user_id is null or not app\.is_admin\(\)/iu);
  assert.match(sql, /p_size_bytes > 5242880/iu);
  assert.match(sql, /jsonb_array_length\(p_manifest -> 'products'\) > 100000/iu);
  assert.doesNotMatch(sql, /service_role\s*=/iu);
});

test('directory bootstrap smoke rolls back data, lineage and review fixtures', () => {
  const sql = readFileSync(new URL('../supabase/tests/directory_bootstrap_smoke.sql', import.meta.url), 'utf8');
  assert.match(sql, /^begin;/iu);
  assert.match(sql, /public\.v5_directory_create_batch/iu);
  assert.match(sql, /public\.v5_directory_publish_bootstrap/iu);
  assert.match(sql, /legacy_mapping_retained/iu);
  assert.match(sql, /review_queue_isolated/iu);
  assert.match(sql, /rollback;/iu);
  assert.doesNotMatch(sql, /commit;/iu);
  assert.doesNotMatch(sql, /[\w.+-]+@[\w.-]+/iu);
});

test('directory bootstrap UI is V5-only and stays behind an explicit release gate', () => {
  const client = readFileSync(new URL('../src/features/directory/directoryBootstrapImport.ts', import.meta.url), 'utf8');
  const page = readFileSync(new URL('../src/components/ImportPage.tsx', import.meta.url), 'utf8');
  const exampleEnv = readFileSync(new URL('../.env.example', import.meta.url), 'utf8');
  assert.match(client, /VITE_APP_ENV === 'v5-development'/iu);
  assert.match(client, /VITE_V5_DIRECTORY_BOOTSTRAP_ENABLED === 'true'/iu);
  assert.match(client, /v5_directory_create_batch/iu);
  assert.match(client, /v5_directory_publish_bootstrap/iu);
  assert.match(client, /contentType: 'application\/json'/iu);
  assert.match(page, /isV5DirectoryBootstrapEnvironment && !serverOnly/iu);
  assert.match(page, /disabled=\{!isV5DirectoryBootstrapEnabled \|\| loading\}/iu);
  assert.match(exampleEnv, /VITE_V5_DIRECTORY_BOOTSTRAP_ENABLED=false/iu);
});

test('directory read API is bounded, cabinet-authorized and resolves groups by date', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20260908010000_v5_directory_read_api.sql', import.meta.url), 'utf8');
  assert.match(sql, /public\.v5_directory_snapshot/iu);
  assert.match(sql, /p_limit > 500/iu);
  assert.match(sql, /p_offset > 100000/iu);
  assert.match(sql, /app\.can_access_cabinet\(product\.cabinet_id\)/iu);
  assert.match(sql, /version\.effective_date <= p_as_of/iu);
  assert.match(sql, /order by version\.effective_date desc/iu);
  assert.match(sql, /public\.v5_directory_filters/iu);
  assert.match(sql, /'schema_version', '20260908010000'/iu);
});

test('directory read smoke verifies snapshot, alias search and filters with rollback', () => {
  const sql = readFileSync(new URL('../supabase/tests/directory_read_smoke.sql', import.meta.url), 'utf8');
  assert.match(sql, /^begin;/iu);
  assert.match(sql, /READ-SKU-OLD/iu);
  assert.match(sql, /public\.v5_directory_snapshot/iu);
  assert.match(sql, /public\.v5_directory_filters/iu);
  assert.match(sql, /rollback;/iu);
  assert.doesNotMatch(sql, /commit;/iu);
});

test('directory frontend adapter is V5-only and stays behind an explicit release gate', () => {
  const client = readFileSync(new URL('../src/features/directory/directoryData.ts', import.meta.url), 'utf8');
  const exampleEnv = readFileSync(new URL('../.env.example', import.meta.url), 'utf8');
  assert.match(client, /VITE_APP_ENV === 'v5-development'/u);
  assert.match(client, /VITE_V5_DIRECTORY_BACKEND_ENABLED === 'true'/u);
  assert.match(client, /v5_directory_snapshot/iu);
  assert.match(client, /v5_directory_filters/iu);
  assert.match(exampleEnv, /VITE_V5_DIRECTORY_BACKEND_ENABLED=false/iu);
});

test('competitor storage versions all four sheets as one replaceable batch', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20260908011000_v5_competitors_storage.sql', import.meta.url), 'utf8');
  for (const table of ['competitor_funnel_versions', 'competitor_search_versions', 'competitor_stock_versions', 'competitor_position_versions']) {
    assert.match(sql, new RegExp(`create table analytics\\.${table}`, 'iu'));
    assert.match(sql, new RegExp(`alter table analytics\\.${table} enable row level security`, 'iu'));
  }
  assert.match(sql, /public\.v5_competitor_snapshot_bounds/iu);
  assert.match(sql, /order by batch\.published_at desc nulls last, batch\.id desc/iu);
  assert.match(sql, /reported_order_conversion numeric\(12, 6\) not null/iu);
  assert.doesNotMatch(sql, /reported_order_conversion between 0 and 100/iu);
  assert.match(sql, /'schema_version', '20260908011000'/iu);
});

test('competitor storage smoke proves whole-batch replacement and rollback', () => {
  const sql = readFileSync(new URL('../supabase/tests/competitors_storage_smoke.sql', import.meta.url), 'utf8');
  assert.match(sql, /^begin;/iu);
  assert.match(sql, /batches were mixed instead of replaced as one snapshot/iu);
  assert.match(sql, /search_percent_above_100_preserved/iu);
  assert.match(sql, /rollback;/iu);
  assert.doesNotMatch(sql, /commit;/iu);
});

test('competitor import requires retained source and publishes four sections atomically', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20260908012000_v5_competitors_import.sql', import.meta.url), 'utf8');
  const smoke = readFileSync(new URL('../supabase/tests/competitors_import_smoke.sql', import.meta.url), 'utf8');

  assert.match(sql, /v5_competitor_create_batch/iu);
  assert.match(sql, /v5_competitor_reset_staging/iu);
  assert.match(sql, /v5_competitor_stage_rows/iu);
  assert.match(sql, /v5_competitor_publish_batch/iu);
  assert.match(sql, /v5_competitor_rollback_batch/iu);
  assert.match(sql, /v5-import-sources/iu);
  assert.match(sql, /missing_section/iu);
  assert.match(sql, /\('funnel'\), \('search'\), \('stocks'\), \('positions'\)/iu);
  assert.match(sql, /jsonb_array_length\(p_rows\) > 500/iu);
  assert.match(sql, /v_total_rows > 50000/iu);
  assert.match(sql, /'schema_version', '20260908012000'/iu);
  assert.match(smoke, /invalid_batch_did_not_replace_snapshot/iu);
  assert.match(smoke, /search_percent_above_100_preserved/iu);
  assert.match(smoke, /rollback;/iu);
});

test('competitor read API aggregates every page block behind explicit bounds', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20260909013000_v5_competitors_read_api.sql', import.meta.url), 'utf8');
  const smoke = readFileSync(new URL('../supabase/tests/competitors_read_smoke.sql', import.meta.url), 'utf8');
  for (const rpc of [
    'v5_competitor_filters',
    'v5_competitor_overview_series',
    'v5_competitor_brand_summary',
    'v5_competitor_article_page',
    'v5_competitor_query_leaders',
    'v5_competitor_stock_slice',
    'v5_competitor_top_summary',
    'v5_competitor_top_movements',
  ]) assert.match(sql, new RegExp(`public\\.${rpc}`, 'iu'));
  assert.match(sql, /p_limit > 100/iu);
  assert.match(sql, /p_offset > 100000/iu);
  assert.match(sql, /p_end - p_start > p_max_days/iu);
  assert.match(sql, /app\.can_access_cabinet\(product\.cabinet_id\)/iu);
  assert.match(sql, /max\(row_data\.requests\)/iu);
  assert.match(sql, /normalized_warehouse <> 'маркетплейс'/iu);
  assert.match(sql, /'schema_version', '20260909013000'/iu);
  assert.match(smoke, /^begin;/iu);
  assert.match(smoke, /overview_and_brand_formulas_verified/iu);
  assert.match(smoke, /stock_snapshot_precedence_verified/iu);
  assert.match(smoke, /top_summary_and_movement_verified/iu);
  assert.match(smoke, /rollback;/iu);
  assert.doesNotMatch(smoke, /commit;/iu);
});

test('competitor Import UI contracts are bounded and batch-authorized', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20260909014000_v5_competitors_import_ui.sql', import.meta.url), 'utf8');
  const smoke = readFileSync(new URL('../supabase/tests/competitors_import_ui_smoke.sql', import.meta.url), 'utf8');
  const styles = readFileSync(new URL('../src/App.css', import.meta.url), 'utf8');
  const importPage = readFileSync(new URL('../src/components/ImportPage.tsx', import.meta.url), 'utf8');
  for (const rpc of ['v5_competitor_batch_summary', 'v5_competitor_batch_history', 'v5_competitor_batch_errors', 'v5_competitor_batch_events']) {
    assert.match(sql, new RegExp(rpc, 'iu'));
  }
  assert.match(sql, /app\.can_read_batch\(batch\.id\)/iu);
  assert.match(sql, /not app\.can_read_batch\(p_batch_id\)/iu);
  assert.match(sql, /p_limit > 50/iu);
  assert.match(sql, /p_limit > 200/iu);
  assert.match(sql, /'schema_version',\s*'20260909014000'/iu);
  assert.match(smoke, /^begin;/iu);
  assert.match(smoke, /rollback;/iu);
  assert.doesNotMatch(smoke, /commit;/iu);
  assert.match(styles, /@media \(max-width: 520px\)[\s\S]*\.competitor-import-preview \.import-mapper-header-info/iu);
  assert.match(styles, /\.competitor-import-preview \.import-mapper-footer[\s\S]*flex-direction: column-reverse/iu);
  assert.match(importPage, /function formatEventValue\(value: unknown\)/iu);
  assert.match(importPage, /Object\.entries\(value as Record<string, unknown>\)/iu);
});

test('competitor control-file smoke uses actual Excel dates and always rolls back', () => {
  const smoke = readFileSync(new URL('./v5-competitor-file-smoke.mjs', import.meta.url), 'utf8');
  const comparison = readFileSync(new URL('./compare-v5-competitor-parser.mjs', import.meta.url), 'utf8');
  assert.match(smoke, /read-excel-file\/node/iu);
  assert.match(smoke, /v5_competitor_publish_batch/iu);
  assert.match(smoke, /v5_competitor_snapshot_bounds/iu);
  assert.match(smoke, /source_file_retained/iu);
  assert.match(smoke, /rollback;/iu);
  assert.doesNotMatch(smoke, /commit;/iu);
  assert.match(comparison, /--accept-excel-dates/iu);
  assert.match(comparison, /safeTime - legacyTime === 86_400_000/iu);
});

test('geography storage versions one balanced snapshot with cabinet-scoped access', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20260910015000_v5_geography_storage.sql', import.meta.url), 'utf8');
  const cabinetVersions = readFileSync(new URL('../supabase/migrations/20260910016000_v5_geography_cabinet_versions.sql', import.meta.url), 'utf8');
  const smoke = readFileSync(new URL('../supabase/tests/geography_storage_smoke.sql', import.meta.url), 'utf8');
  assert.match(sql, /create table analytics\.geography_order_versions/iu);
  assert.match(sql, /primary key \(batch_id, date, product_id, normalized_region, normalized_area, normalized_city\)/iu);
  assert.match(sql, /foreign key \(product_id, cabinet_id\) references core\.products/iu);
  assert.match(sql, /orders_total = product_local_orders \+ product_nonlocal_orders/iu);
  assert.match(sql, /orders_total = wb_local_orders \+ wb_nonlocal_orders \+ marketplace_local_orders \+ marketplace_nonlocal_orders/iu);
  assert.match(sql, /app\.can_access_cabinet\(cabinet_id\)/iu);
  assert.match(sql, /public\.v5_geography_snapshot_bounds/iu);
  assert.match(sql, /'schema_version', '20260910015000'/iu);
  assert.match(cabinetVersions, /foreign key \(batch_id, cabinet_id\) references ingest\.import_batches/iu);
  assert.match(cabinetVersions, /distinct on \(batch\.cabinet_id\)/iu);
  assert.match(cabinetVersions, /app\.can_access_cabinet\(batch\.cabinet_id\)/iu);
  assert.match(cabinetVersions, /'schema_version', '20260910016000'/iu);
  assert.match(smoke, /^begin;/iu);
  assert.match(smoke, /batches were mixed instead of replaced as one snapshot/iu);
  assert.match(smoke, /fulfillment mismatch was accepted/iu);
  assert.match(smoke, /rollback;/iu);
  assert.doesNotMatch(smoke, /commit;/iu);
});

test('geography import retains its source and publishes one canonical cabinet version atomically', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20260910017000_v5_geography_import.sql', import.meta.url), 'utf8');
  const smoke = readFileSync(new URL('../supabase/tests/geography_import_smoke.sql', import.meta.url), 'utf8');
  for (const rpc of ['v5_geography_create_batch', 'v5_geography_reset_staging', 'v5_geography_stage_rows', 'v5_geography_publish_batch', 'v5_geography_rollback_batch']) {
    assert.match(sql, new RegExp(`public\\.${rpc}`, 'iu'));
  }
  assert.match(sql, /p_size_bytes > 26214400/iu);
  assert.match(sql, /jsonb_array_length\(p_rows\) > 500/iu);
  assert.match(sql, /v_total_rows > 250000/iu);
  assert.match(sql, /object\.bucket_id = 'v5-import-sources'/iu);
  assert.match(sql, /row_number\(\) over \(partition by/iu);
  assert.match(sql, /order by row_number desc/iu);
  assert.match(sql, /'schema_version', '20260910017000'/iu);
  assert.match(smoke, /^begin;/iu);
  assert.match(smoke, /last normalized row did not win/iu);
  assert.match(smoke, /invalid geography batch was accepted/iu);
  assert.match(smoke, /rollback;/iu);
  assert.doesNotMatch(smoke, /commit;/iu);
});

test('geography read API bounds filters, series, locations and product leaders', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20260910018000_v5_geography_read_api.sql', import.meta.url), 'utf8');
  const smoke = readFileSync(new URL('../supabase/tests/geography_read_smoke.sql', import.meta.url), 'utf8');
  for (const rpc of ['v5_geography_filter_options', 'v5_geography_summary', 'v5_geography_series', 'v5_geography_locations', 'v5_geography_product_leaders']) {
    assert.match(sql, new RegExp(`public\\.${rpc}`, 'iu'));
  }
  assert.match(sql, /p_end - p_start > 731/iu);
  assert.match(sql, /cardinality\(p_cabinet_ids\).*100/isu);
  assert.match(sql, /cardinality\(p_product_ids\).*500/isu);
  assert.match(sql, /p_limit > 200/iu);
  assert.match(sql, /p_offset > 100000/iu);
  assert.match(sql, /app\.v5_current_geography_batches/iu);
  assert.match(sql, /'schema_version', '20260910018000'/iu);
  assert.match(smoke, /^begin;/iu);
  assert.match(smoke, /summary formulas failed/iu);
  assert.match(smoke, /location aggregation failed/iu);
  assert.match(smoke, /rollback;/iu);
  assert.doesNotMatch(smoke, /commit;/iu);
});

test('V5 staging deployment is isolated under the v5 subdirectory', () => {
  const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const buildScript = readFileSync(new URL('./build-v5.mjs', import.meta.url), 'utf8');
  const workflow = readFileSync(new URL('../.github/workflows/deploy.yml', import.meta.url), 'utf8');

  assert.match(packageJson.scripts['deploy:v5'], /-e v5 -a/iu);
  assert.match(buildScript, /VITE_APP_BASE:\s*'\/Analytics\/v5\/'/u);
  assert.match(buildScript, /VITE_APP_ENV:\s*'v5-development'/u);
  assert.match(buildScript, /VITE_V5_COMPETITORS_IMPORT_ENABLED:\s*'true'/u);
  assert.match(buildScript, /VITE_V5_DIRECTORY_BOOTSTRAP_ENABLED:\s*'false'/u);
  assert.match(workflow, /keep_files:\s*true/iu);
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
  assert.match(source, /export async function getMarketBatchErrors\(batchId: string, limit = 100\)/iu);
  assert.match(source, /supabase\.rpc\('v5_market_batch_errors'/iu);
  assert.match(source, /Math\.max\(1, Math\.min\(200, Math\.trunc\(limit\)\)\)/iu);
  assert.match(source, /supabase\.storage\.from\(BUCKET\)\.download\(objectPath\)/iu);
  assert.match(source, /export async function getMarketBatchEvents\(batchId: string, limit = 100\)/iu);
  assert.match(source, /supabase\.rpc\('v5_market_batch_events'/iu);
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
