begin;

create or replace function public.v5_market_reset_staging(p_batch_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_batch ingest.import_batches%rowtype;
  v_object_path text;
  v_source_exists boolean;
  v_cleared_rows integer;
  v_next_status ingest.batch_status;
begin
  if v_user_id is null or not app.can_import() then
    raise exception 'V5 importer access is required';
  end if;

  select batch.*
  into v_batch
  from ingest.import_batches batch
  where batch.id = p_batch_id
    and batch.source_code = 'market_dynamics'
  for update;

  if not found then
    raise exception 'Market import batch % does not exist', p_batch_id;
  end if;

  if v_batch.created_by <> v_user_id and not app.is_admin() then
    raise exception 'The market batch belongs to another user';
  end if;

  if v_batch.status not in ('created', 'uploaded', 'validating', 'failed') then
    raise exception 'Market staging cannot be reset while batch status is %', v_batch.status;
  end if;

  select file.object_path
  into strict v_object_path
  from ingest.import_files file
  where file.batch_id = p_batch_id;

  v_source_exists := exists (
    select 1
    from storage.objects object
    where object.bucket_id = 'v5-import-sources'
      and object.name = v_object_path
  );
  v_next_status := case
    when v_source_exists then 'uploaded'::ingest.batch_status
    else 'created'::ingest.batch_status
  end;

  delete from ingest.import_errors where batch_id = p_batch_id;
  delete from ingest.import_rows where batch_id = p_batch_id;
  get diagnostics v_cleared_rows = row_count;

  update ingest.import_batches
  set status = v_next_status,
      period_start = null,
      period_end = null,
      input_rows = 0,
      accepted_rows = 0,
      rejected_rows = 0,
      error_summary = null,
      uploaded_at = case
        when v_source_exists then coalesce(uploaded_at, timezone('utc', now()))
        else null
      end,
      validated_at = null,
      published_at = null,
      finished_at = null
  where id = p_batch_id;

  insert into ingest.import_events (batch_id, status, message, details, created_by)
  values (
    p_batch_id,
    v_next_status,
    'Market staging reset for retry',
    jsonb_build_object('cleared_rows', v_cleared_rows, 'source_file_retained', v_source_exists),
    v_user_id
  );

  return jsonb_build_object(
    'batch_id', p_batch_id,
    'status', v_next_status,
    'cleared_rows', v_cleared_rows,
    'source_file_retained', v_source_exists
  );
end
$$;

create or replace function public.v5_health()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'environment', 'analytics-v5',
    'schema_version', '20260907002000',
    'status', 'ok'
  )
$$;

commit;
