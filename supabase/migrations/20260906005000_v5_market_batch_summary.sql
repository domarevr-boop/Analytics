begin;

create or replace function public.v5_market_batch_summary(p_batch_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_result jsonb;
begin
  if v_user_id is null or not app.can_import() then
    raise exception 'V5 importer access is required';
  end if;

  select jsonb_build_object(
    'batch_id', batch.id,
    'file_name', file.original_filename,
    'imported_at', batch.created_at,
    'status', batch.status,
    'duplicate', false,
    'input_rows', batch.input_rows,
    'accepted_rows', batch.accepted_rows,
    'rejected_rows', batch.rejected_rows,
    'error_count', (
      select count(*)
      from ingest.import_errors error
      where error.batch_id = batch.id
    ),
    'period_start', batch.period_start,
    'period_end', batch.period_end,
    'error_summary', batch.error_summary,
    'source_file_retained', exists (
      select 1
      from storage.objects object
      where object.bucket_id = file.bucket_id
        and object.name = file.object_path
    )
  )
  into v_result
  from ingest.import_batches batch
  join ingest.import_files file on file.batch_id = batch.id
  where batch.source_code = 'market_dynamics'
    and (p_batch_id is null or batch.id = p_batch_id)
    and (batch.created_by = v_user_id or app.is_admin())
  order by batch.created_at desc, batch.id desc
  limit 1;

  return v_result;
end
$$;

revoke all on function public.v5_market_batch_summary(uuid) from public, anon;
grant execute on function public.v5_market_batch_summary(uuid) to authenticated;

create or replace function public.v5_health()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'environment', 'analytics-v5',
    'schema_version', '20260906005000',
    'status', 'ok'
  )
$$;

revoke all on function public.v5_health() from public;
grant execute on function public.v5_health() to anon, authenticated;

commit;
