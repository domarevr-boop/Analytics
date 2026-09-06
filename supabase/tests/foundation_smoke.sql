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
  )
) as foundation_smoke;
