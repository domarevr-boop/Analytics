begin;

create or replace function public.v5_market_batch_history(p_limit integer default 20)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if auth.uid() is null or not app.can_import() then
    raise exception 'V5 importer access is required';
  end if;

  if p_limit is null or p_limit < 1 or p_limit > 50 then
    raise exception 'Market batch history limit must be between 1 and 50';
  end if;

  select coalesce(jsonb_agg(to_jsonb(history_row) order by history_row.created_at desc, history_row.batch_id desc), '[]'::jsonb)
  into v_result
  from (
    select
      batch.id as batch_id,
      file.original_filename as file_name,
      batch.status::text as status,
      batch.input_rows,
      batch.accepted_rows,
      batch.rejected_rows,
      (select count(*) from ingest.import_errors error where error.batch_id = batch.id) as error_count,
      batch.period_start,
      batch.period_end,
      batch.error_summary,
      batch.attempt_count,
      batch.created_at,
      batch.published_at,
      exists (
        select 1
        from storage.objects object
        where object.bucket_id = file.bucket_id
          and object.name = file.object_path
      ) as source_file_retained
    from ingest.import_batches batch
    join ingest.import_files file on file.batch_id = batch.id
    where batch.source_code = 'market_dynamics'
      and app.can_read_batch(batch.id)
    order by batch.created_at desc, batch.id desc
    limit p_limit
  ) history_row;

  return v_result;
end
$$;

revoke all on function public.v5_market_batch_history(integer) from public, anon;
grant execute on function public.v5_market_batch_history(integer) to authenticated;

create or replace function public.v5_health()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'environment', 'analytics-v5',
    'schema_version', '20260907004000',
    'status', 'ok'
  )
$$;

revoke all on function public.v5_health() from public;
grant execute on function public.v5_health() to anon, authenticated;

comment on function public.v5_market_batch_history(integer) is 'Bounded V5 Market import history visible to the creating importer or an administrator.';

commit;
