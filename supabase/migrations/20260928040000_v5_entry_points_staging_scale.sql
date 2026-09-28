-- A full monthly entry-points workbook needs hundreds of staging RPCs. Count only
-- newly inserted row keys instead of rescanning the entire batch after each RPC.
begin;

create or replace function public.v5_entry_points_stage_rows(p_batch_id uuid, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_batch ingest.import_batches%rowtype;
  v_object_path text;
  v_new_rows integer;
  v_total_rows integer;
begin
  if v_user_id is null or not app.can_import() then raise exception 'V5 importer access is required'; end if;
  select batch.* into v_batch from ingest.import_batches batch
  where batch.id = p_batch_id and batch.source_code = 'entry_points' for update;
  if not found then raise exception 'Entry points import batch % does not exist', p_batch_id; end if;
  if v_batch.created_by <> v_user_id and not app.is_admin() then raise exception 'The entry points batch belongs to another user'; end if;
  if not app.can_access_cabinet(v_batch.cabinet_id) then raise exception 'The entry points batch cabinet is not accessible'; end if;
  if v_batch.status not in ('created', 'uploaded', 'validating', 'failed') then
    raise exception 'Rows cannot be staged while entry points batch status is %', v_batch.status;
  end if;
  select file.object_path into strict v_object_path from ingest.import_files file where file.batch_id = p_batch_id;
  if not exists (
    select 1 from storage.objects object where object.bucket_id = 'v5-import-sources' and object.name = v_object_path
  ) then raise exception 'The source file must be uploaded before staging rows'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 or jsonb_array_length(p_rows) > 500 then
    raise exception 'Each staging chunk must contain between 1 and 500 rows';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_rows) item
    where jsonb_typeof(item) <> 'object'
      or coalesce(item ->> 'row_number', '') !~ '^[1-9][0-9]{0,8}$'
      or jsonb_typeof(item -> 'payload') <> 'object'
  ) then raise exception 'Every staged row requires a positive row_number and object payload'; end if;

  select count(*)::integer into v_new_rows
  from jsonb_array_elements(p_rows) item
  where not exists (
    select 1 from ingest.import_rows row_data
    where row_data.batch_id = p_batch_id and row_data.sheet_name = 'entry_points'
      and row_data.row_number = (item ->> 'row_number')::integer
  );

  insert into ingest.import_rows (batch_id, sheet_name, row_number, row_hash, payload, accepted)
  select p_batch_id, 'entry_points', (item ->> 'row_number')::integer,
    encode(extensions.digest((item -> 'payload')::text, 'sha256'), 'hex'), item -> 'payload', null
  from jsonb_array_elements(p_rows) item
  on conflict (batch_id, sheet_name, row_number) do update
  set row_hash = excluded.row_hash, payload = excluded.payload, accepted = null;

  update ingest.import_batches set status = 'validating', input_rows = input_rows + v_new_rows,
    uploaded_at = coalesce(uploaded_at, timezone('utc', now())), finished_at = null
  where id = p_batch_id returning input_rows into v_total_rows;
  if v_total_rows > 250000 then raise exception 'Entry points import is limited to 250000 staged rows'; end if;
  insert into ingest.import_events (batch_id, status, message, details, created_by)
  values (p_batch_id, 'validating', 'Entry points rows staged', jsonb_build_object('staged_rows', v_total_rows), v_user_id);
  return jsonb_build_object('batch_id', p_batch_id, 'status', 'validating', 'staged_rows', v_total_rows);
end
$$;

revoke all on function public.v5_entry_points_stage_rows(uuid, jsonb) from public, anon;
grant execute on function public.v5_entry_points_stage_rows(uuid, jsonb) to authenticated;

commit;
