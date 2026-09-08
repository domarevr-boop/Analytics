select jsonb_build_object(
  'environment', public.v5_health() ->> 'environment',
  'schema_version', public.v5_health() ->> 'schema_version',
  'source_count', (select count(*) from ingest.sources),
  'auth_user_count', (select count(*) from auth.users),
  'assigned_role_count', (select count(*) from app.user_access),
  'private_bucket_count', (
    select count(*)
    from storage.buckets
    where id = 'v5-import-sources'
      and public = false
  ),
  'foundation_table_count', (
    select count(*)
    from pg_catalog.pg_tables
    where schemaname in ('app', 'core', 'ingest', 'analytics')
  ),
  'rls_table_count', (
    select count(*)
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('app', 'core', 'ingest', 'analytics')
      and c.relkind = 'r'
      and c.relrowsecurity
  ),
  'private_bootstrap_exposed_count', (
    select count(*)
    from information_schema.routine_privileges rp
    where rp.routine_schema = 'app'
      and rp.routine_name = 'bootstrap_first_admin'
      and rp.grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role')
  ),
  'role_smoke_fixture_count', (
    (
      select count(*)
      from core.cabinets
      where external_key in ('__v5_rls_test_allowed__', '__v5_rls_test_denied__')
    )
    +
    (
      select count(*)
      from ingest.import_batches
      where idempotency_key in ('__v5_role_smoke__', '__v5_viewer_must_not_import__')
    )
  ),
  'market_metric_definition_count', (
    select count(*)
    from analytics.metric_definitions
    where code in (
      'market_amount_share',
      'market_orders_share',
      'market_average_check',
      'own_market_average_check'
    )
      and is_active
  ),
  'market_batch_count', (
    select count(*)
    from ingest.import_batches
    where source_code = 'market_dynamics'
  ),
  'market_version_row_count', (
    select count(*)
    from analytics.market_daily_versions
  ),
  'competitor_batch_count', (
    select count(*)
    from ingest.import_batches
    where source_code = 'competitors'
  ),
  'competitor_version_row_count', (
    (select count(*) from analytics.competitor_funnel_versions)
    + (select count(*) from analytics.competitor_search_versions)
    + (select count(*) from analytics.competitor_stock_versions)
    + (select count(*) from analytics.competitor_position_versions)
  ),
  'market_storage_object_count', (
    select count(*)
    from storage.objects
    where bucket_id = 'v5-import-sources'
  )
) as foundation_smoke;
