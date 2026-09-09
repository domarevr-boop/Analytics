begin;

create or replace function public.v5_competitor_batch_summary(p_batch_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if auth.uid() is null or not app.can_import() then raise exception 'V5 importer access is required'; end if;

  select to_jsonb(summary_row) into v_result
  from (
    select batch.id as batch_id, file.original_filename as file_name, batch.status::text as status,
      batch.input_rows, batch.accepted_rows, batch.rejected_rows,
      (select count(*) from ingest.import_errors error where error.batch_id = batch.id) as error_count,
      batch.period_start, batch.period_end, coalesce(batch.metadata -> 'section_counts', '{}'::jsonb) as section_counts,
      coalesce(batch.finished_at, batch.created_at) as imported_at
    from ingest.import_batches batch
    join ingest.import_files file on file.batch_id = batch.id
    where batch.source_code = 'competitors'
      and (p_batch_id is null or batch.id = p_batch_id)
      and app.can_read_batch(batch.id)
    order by batch.created_at desc, batch.id desc
    limit 1
  ) summary_row;

  return v_result;
end
$$;

create or replace function public.v5_competitor_batch_history(p_limit integer default 20)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if auth.uid() is null or not app.can_import() then raise exception 'V5 importer access is required'; end if;
  if p_limit is null or p_limit < 1 or p_limit > 50 then raise exception 'Competitor batch history limit must be between 1 and 50'; end if;

  select coalesce(jsonb_agg(to_jsonb(history_row) order by history_row.created_at desc, history_row.batch_id desc), '[]'::jsonb)
  into v_result
  from (
    select batch.id as batch_id, file.original_filename as file_name, file.object_path,
      batch.status::text as status, batch.input_rows, batch.accepted_rows, batch.rejected_rows,
      (select count(*) from ingest.import_errors error where error.batch_id = batch.id) as error_count,
      batch.period_start, batch.period_end, batch.error_summary, batch.attempt_count,
      batch.created_at, batch.published_at,
      exists (
        select 1 from storage.objects object
        where object.bucket_id = file.bucket_id and object.name = file.object_path
      ) as source_file_retained
    from ingest.import_batches batch
    join ingest.import_files file on file.batch_id = batch.id
    where batch.source_code = 'competitors' and app.can_read_batch(batch.id)
    order by batch.created_at desc, batch.id desc
    limit p_limit
  ) history_row;
  return v_result;
end
$$;

create or replace function public.v5_competitor_batch_errors(p_batch_id uuid, p_limit integer default 100)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if auth.uid() is null or not app.can_import() then raise exception 'V5 importer access is required'; end if;
  if p_batch_id is null or not app.can_read_batch(p_batch_id) or not exists (
    select 1 from ingest.import_batches batch where batch.id = p_batch_id and batch.source_code = 'competitors'
  ) then raise exception 'Competitor batch is not available'; end if;
  if p_limit is null or p_limit < 1 or p_limit > 200 then raise exception 'Competitor batch error limit must be between 1 and 200'; end if;

  select coalesce(jsonb_agg(to_jsonb(error_row) order by error_row.sheet_name, error_row.row_number nulls last, error_row.error_id), '[]'::jsonb)
  into v_result
  from (
    select error.id as error_id, error.sheet_name, error.row_number, error.column_name,
      error.error_code, error.message, error.raw_value, error.created_at
    from ingest.import_errors error where error.batch_id = p_batch_id
    order by error.sheet_name, error.row_number nulls last, error.id limit p_limit
  ) error_row;
  return v_result;
end
$$;

create or replace function public.v5_competitor_batch_events(p_batch_id uuid, p_limit integer default 100)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if auth.uid() is null or not app.can_import() then raise exception 'V5 importer access is required'; end if;
  if p_batch_id is null or not app.can_read_batch(p_batch_id) or not exists (
    select 1 from ingest.import_batches batch where batch.id = p_batch_id and batch.source_code = 'competitors'
  ) then raise exception 'Competitor batch is not available'; end if;
  if p_limit is null or p_limit < 1 or p_limit > 200 then raise exception 'Competitor batch event limit must be between 1 and 200'; end if;

  select coalesce(jsonb_agg(to_jsonb(event_row) order by event_row.created_at, event_row.event_id), '[]'::jsonb)
  into v_result
  from (
    select event.id as event_id, event.status, event.message, event.details, event.created_at
    from ingest.import_events event where event.batch_id = p_batch_id
    order by event.created_at desc, event.id desc limit p_limit
  ) event_row;
  return v_result;
end
$$;

revoke all on function public.v5_competitor_batch_summary(uuid) from public, anon;
revoke all on function public.v5_competitor_batch_history(integer) from public, anon;
revoke all on function public.v5_competitor_batch_errors(uuid, integer) from public, anon;
revoke all on function public.v5_competitor_batch_events(uuid, integer) from public, anon;
grant execute on function public.v5_competitor_batch_summary(uuid) to authenticated;
grant execute on function public.v5_competitor_batch_history(integer) to authenticated;
grant execute on function public.v5_competitor_batch_errors(uuid, integer) to authenticated;
grant execute on function public.v5_competitor_batch_events(uuid, integer) to authenticated;

create or replace function public.v5_health()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object('environment', 'analytics-v5', 'schema_version', '20260909014000', 'status', 'ok')
$$;

revoke all on function public.v5_health() from public;
grant execute on function public.v5_health() to anon, authenticated;

comment on function public.v5_competitor_batch_summary(uuid) is 'One accessible competitor import summary for the V5 Import UI.';
comment on function public.v5_competitor_batch_history(integer) is 'Bounded competitor import history with private source paths for authorized downloads.';
comment on function public.v5_competitor_batch_errors(uuid, integer) is 'Bounded row-level validation errors for one accessible competitor batch.';
comment on function public.v5_competitor_batch_events(uuid, integer) is 'Bounded lifecycle events for one accessible competitor batch.';

commit;
