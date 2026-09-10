begin;

create or replace function public.v5_geography_create_batch(
  p_cabinet_id uuid,
  p_original_filename text,
  p_content_type text,
  p_size_bytes bigint,
  p_file_sha256 text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_batch_id uuid := gen_random_uuid();
  v_existing_id uuid;
  v_existing_status ingest.batch_status;
  v_existing_path text;
  v_object_path text;
begin
  if v_user_id is null or not app.can_import() then raise exception 'V5 importer access is required'; end if;
  if p_cabinet_id is null or not app.can_access_cabinet(p_cabinet_id) then raise exception 'Accessible cabinet is required'; end if;
  if not exists (select 1 from core.cabinets cabinet where cabinet.id = p_cabinet_id and cabinet.is_active) then
    raise exception 'Active cabinet % does not exist', p_cabinet_id;
  end if;
  if p_original_filename is null or btrim(p_original_filename) = '' or lower(p_original_filename) not like '%.xlsx' then
    raise exception 'Geography import supports only .xlsx files';
  end if;
  if p_size_bytes is null or p_size_bytes <= 0 or p_size_bytes > 26214400 then
    raise exception 'Geography source file must be between 1 byte and 25 MiB';
  end if;
  if p_file_sha256 is null or p_file_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'A lowercase SHA-256 file hash is required';
  end if;

  select batch.id, batch.status, file.object_path
  into v_existing_id, v_existing_status, v_existing_path
  from ingest.import_batches batch
  join ingest.import_files file on file.batch_id = batch.id
  where batch.source_code = 'geography'
    and batch.cabinet_id = p_cabinet_id
    and batch.file_sha256 = p_file_sha256
  limit 1;
  if v_existing_id is not null then
    return jsonb_build_object('batch_id', v_existing_id, 'object_path', v_existing_path, 'status', v_existing_status, 'duplicate', true);
  end if;

  v_object_path := v_user_id::text || '/' || v_batch_id::text || '/source.xlsx';
  insert into ingest.import_batches (
    id, source_code, cabinet_id, created_by, status, idempotency_key, file_sha256, source_schema_version
  ) values (
    v_batch_id, 'geography', p_cabinet_id, v_user_id, 'created',
    'geography:' || p_cabinet_id::text || ':' || p_file_sha256, p_file_sha256, 1
  ) on conflict do nothing;

  if not found then
    select batch.id, batch.status, file.object_path
    into strict v_existing_id, v_existing_status, v_existing_path
    from ingest.import_batches batch
    join ingest.import_files file on file.batch_id = batch.id
    where batch.source_code = 'geography'
      and batch.cabinet_id = p_cabinet_id
      and batch.file_sha256 = p_file_sha256
    limit 1;
    return jsonb_build_object('batch_id', v_existing_id, 'object_path', v_existing_path, 'status', v_existing_status, 'duplicate', true);
  end if;

  insert into ingest.import_files (
    batch_id, object_path, original_filename, content_type, size_bytes, file_sha256
  ) values (
    v_batch_id, v_object_path, p_original_filename, nullif(btrim(p_content_type), ''), p_size_bytes, p_file_sha256
  );
  insert into ingest.import_events (batch_id, status, message, created_by)
  values (v_batch_id, 'created', 'Geography import batch created', v_user_id);
  return jsonb_build_object('batch_id', v_batch_id, 'object_path', v_object_path, 'status', 'created', 'duplicate', false);
end
$$;

revoke all on function public.v5_geography_create_batch(uuid, text, text, bigint, text) from public, anon;
grant execute on function public.v5_geography_create_batch(uuid, text, text, bigint, text) to authenticated;

create or replace function public.v5_geography_reset_staging(p_batch_id uuid)
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
  if v_user_id is null or not app.can_import() then raise exception 'V5 importer access is required'; end if;
  select batch.* into v_batch from ingest.import_batches batch
  where batch.id = p_batch_id and batch.source_code = 'geography' for update;
  if not found then raise exception 'Geography import batch % does not exist', p_batch_id; end if;
  if v_batch.created_by <> v_user_id and not app.is_admin() then raise exception 'The geography batch belongs to another user'; end if;
  if not app.can_access_cabinet(v_batch.cabinet_id) then raise exception 'The geography batch cabinet is not accessible'; end if;
  if v_batch.status not in ('created', 'uploaded', 'validating', 'failed') then
    raise exception 'Geography staging cannot be reset while batch status is %', v_batch.status;
  end if;

  select file.object_path into strict v_object_path from ingest.import_files file where file.batch_id = p_batch_id;
  v_source_exists := exists (
    select 1 from storage.objects object where object.bucket_id = 'v5-import-sources' and object.name = v_object_path
  );
  v_next_status := case when v_source_exists then 'uploaded'::ingest.batch_status else 'created'::ingest.batch_status end;
  delete from ingest.import_errors where batch_id = p_batch_id;
  delete from ingest.import_rows where batch_id = p_batch_id;
  get diagnostics v_cleared_rows = row_count;
  update ingest.import_batches set
    status = v_next_status, period_start = null, period_end = null, input_rows = 0, accepted_rows = 0,
    rejected_rows = 0, metadata = '{}'::jsonb, error_summary = null,
    uploaded_at = case when v_source_exists then coalesce(uploaded_at, timezone('utc', now())) else null end,
    validated_at = null, published_at = null, finished_at = null,
    attempt_count = attempt_count + 1
  where id = p_batch_id;
  insert into ingest.import_events (batch_id, status, message, details, created_by)
  values (p_batch_id, v_next_status, 'Geography staging reset for retry',
    jsonb_build_object('cleared_rows', v_cleared_rows, 'source_file_retained', v_source_exists), v_user_id);
  return jsonb_build_object('batch_id', p_batch_id, 'status', v_next_status, 'cleared_rows', v_cleared_rows, 'source_file_retained', v_source_exists);
end
$$;

revoke all on function public.v5_geography_reset_staging(uuid) from public, anon;
grant execute on function public.v5_geography_reset_staging(uuid) to authenticated;

create or replace function public.v5_geography_stage_rows(p_batch_id uuid, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_batch ingest.import_batches%rowtype;
  v_object_path text;
  v_total_rows integer;
begin
  if v_user_id is null or not app.can_import() then raise exception 'V5 importer access is required'; end if;
  select batch.* into v_batch from ingest.import_batches batch
  where batch.id = p_batch_id and batch.source_code = 'geography' for update;
  if not found then raise exception 'Geography import batch % does not exist', p_batch_id; end if;
  if v_batch.created_by <> v_user_id and not app.is_admin() then raise exception 'The geography batch belongs to another user'; end if;
  if not app.can_access_cabinet(v_batch.cabinet_id) then raise exception 'The geography batch cabinet is not accessible'; end if;
  if v_batch.status not in ('created', 'uploaded', 'validating', 'failed') then
    raise exception 'Rows cannot be staged while geography batch status is %', v_batch.status;
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

  insert into ingest.import_rows (batch_id, sheet_name, row_number, row_hash, payload, accepted)
  select p_batch_id, 'geography', (item ->> 'row_number')::integer,
    encode(extensions.digest((item -> 'payload')::text, 'sha256'), 'hex'), item -> 'payload', null
  from jsonb_array_elements(p_rows) item
  on conflict (batch_id, sheet_name, row_number) do update
  set row_hash = excluded.row_hash, payload = excluded.payload, accepted = null;

  select count(*)::integer into v_total_rows from ingest.import_rows row_data where row_data.batch_id = p_batch_id;
  if v_total_rows > 250000 then raise exception 'Geography import is limited to 250000 staged rows'; end if;
  update ingest.import_batches set status = 'validating', input_rows = v_total_rows,
    uploaded_at = coalesce(uploaded_at, timezone('utc', now())), finished_at = null
  where id = p_batch_id;
  insert into ingest.import_events (batch_id, status, message, details, created_by)
  values (p_batch_id, 'validating', 'Geography rows staged', jsonb_build_object('staged_rows', v_total_rows), v_user_id);
  return jsonb_build_object('batch_id', p_batch_id, 'status', 'validating', 'staged_rows', v_total_rows);
end
$$;

revoke all on function public.v5_geography_stage_rows(uuid, jsonb) from public, anon;
grant execute on function public.v5_geography_stage_rows(uuid, jsonb) to authenticated;

create or replace function public.v5_geography_publish_batch(p_batch_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_batch ingest.import_batches%rowtype;
  v_object_path text;
  v_input_rows integer;
  v_error_count integer;
  v_rejected_rows integer;
  v_canonical_rows integer;
  v_duplicate_rows integer;
  v_period_start date;
  v_period_end date;
begin
  if v_user_id is null or not app.can_import() then raise exception 'V5 importer access is required'; end if;
  select batch.* into v_batch from ingest.import_batches batch
  where batch.id = p_batch_id and batch.source_code = 'geography' for update;
  if not found then raise exception 'Geography import batch % does not exist', p_batch_id; end if;
  if v_batch.created_by <> v_user_id and not app.is_admin() then raise exception 'The geography batch belongs to another user'; end if;
  if not app.can_access_cabinet(v_batch.cabinet_id) then raise exception 'The geography batch cabinet is not accessible'; end if;
  if v_batch.status not in ('uploaded', 'validating', 'failed') then
    raise exception 'Geography batch cannot be published while status is %', v_batch.status;
  end if;
  select file.object_path into strict v_object_path from ingest.import_files file where file.batch_id = p_batch_id;
  if not exists (
    select 1 from storage.objects object where object.bucket_id = 'v5-import-sources' and object.name = v_object_path
  ) then raise exception 'The source file must be retained before geography publication'; end if;
  select count(*)::integer into v_input_rows from ingest.import_rows row_data where row_data.batch_id = p_batch_id;
  if v_input_rows = 0 then raise exception 'Geography batch has no staged rows'; end if;

  delete from ingest.import_errors where batch_id = p_batch_id;

  insert into ingest.import_errors (batch_id, sheet_name, row_number, column_name, error_code, message, raw_value)
  select row_data.batch_id, row_data.sheet_name, row_data.row_number, 'date', 'invalid_date',
    'Дата должна иметь формат YYYY-MM-DD и существовать', row_data.payload ->> 'date'
  from ingest.import_rows row_data
  where row_data.batch_id = p_batch_id and not ingest.is_iso_date(row_data.payload ->> 'date');

  insert into ingest.import_errors (batch_id, sheet_name, row_number, column_name, error_code, message, raw_value)
  select row_data.batch_id, row_data.sheet_name, row_data.row_number, required.column_name, 'missing_text',
    'Обязательное текстовое значение отсутствует или превышает допустимую длину', row_data.payload ->> required.column_name
  from ingest.import_rows row_data
  join lateral (values ('region', 1000)) required(column_name, max_length) on true
  where row_data.batch_id = p_batch_id
    and (btrim(coalesce(row_data.payload ->> required.column_name, '')) = ''
      or length(row_data.payload ->> required.column_name) > required.max_length);

  insert into ingest.import_errors (batch_id, sheet_name, row_number, error_code, message)
  select row_data.batch_id, row_data.sheet_name, row_data.row_number, 'missing_product_identity',
    'Требуется артикул продавца или WB'
  from ingest.import_rows row_data
  where row_data.batch_id = p_batch_id
    and btrim(coalesce(row_data.payload ->> 'seller_sku', '')) = ''
    and btrim(coalesce(row_data.payload ->> 'wb_sku', '')) = '';

  insert into ingest.import_errors (batch_id, sheet_name, row_number, error_code, message)
  select row_data.batch_id, row_data.sheet_name, row_data.row_number,
    case when matched.match_count = 0 then 'unknown_product' else 'ambiguous_product' end,
    case when matched.match_count = 0 then 'Товар не найден в опубликованном справочнике кабинета'
      else 'Артикулы строки соответствуют разным товарам справочника' end
  from ingest.import_rows row_data
  cross join lateral (
    select count(distinct product.id)::integer as match_count
    from core.products product
    where product.cabinet_id = v_batch.cabinet_id
      and (
        (btrim(coalesce(row_data.payload ->> 'seller_sku', '')) <> '' and product.seller_sku = btrim(row_data.payload ->> 'seller_sku'))
        or (btrim(coalesce(row_data.payload ->> 'wb_sku', '')) <> '' and product.wb_sku = btrim(row_data.payload ->> 'wb_sku'))
      )
  ) matched
  where row_data.batch_id = p_batch_id and matched.match_count <> 1;

  insert into ingest.import_errors (batch_id, sheet_name, row_number, column_name, error_code, message, raw_value)
  select row_data.batch_id, row_data.sheet_name, row_data.row_number, required.column_name, 'invalid_integer',
    'Обязательное значение должно быть целым неотрицательным числом', row_data.payload ->> required.column_name
  from ingest.import_rows row_data
  join lateral (
    select field.column_name from (values
      ('orders_total'), ('product_local_orders'), ('product_nonlocal_orders'),
      ('wb_local_orders'), ('wb_nonlocal_orders'), ('marketplace_local_orders'), ('marketplace_nonlocal_orders')
    ) field(column_name)
  ) required on true
  where row_data.batch_id = p_batch_id
    and (coalesce(jsonb_typeof(row_data.payload -> required.column_name), '') <> 'number'
      or ingest.try_numeric(row_data.payload ->> required.column_name) is null
      or ingest.try_numeric(row_data.payload ->> required.column_name) < 0
      or trunc(ingest.try_numeric(row_data.payload ->> required.column_name)) <> ingest.try_numeric(row_data.payload ->> required.column_name)
      or ingest.try_numeric(row_data.payload ->> required.column_name) > 9223372036854775807);

  insert into ingest.import_errors (batch_id, sheet_name, row_number, column_name, error_code, message, raw_value)
  select row_data.batch_id, row_data.sheet_name, row_data.row_number, 'delivery_hours', 'invalid_delivery_hours',
    'СВД должно быть null или неотрицательным числом', row_data.payload ->> 'delivery_hours'
  from ingest.import_rows row_data
  where row_data.batch_id = p_batch_id
    and row_data.payload ? 'delivery_hours'
    and jsonb_typeof(row_data.payload -> 'delivery_hours') <> 'null'
    and (jsonb_typeof(row_data.payload -> 'delivery_hours') <> 'number'
      or ingest.try_numeric(row_data.payload ->> 'delivery_hours') is null
      or ingest.try_numeric(row_data.payload ->> 'delivery_hours') < 0);

  insert into ingest.import_errors (batch_id, sheet_name, row_number, error_code, message)
  select row_data.batch_id, row_data.sheet_name, row_data.row_number, 'product_split_mismatch',
    'Итого заказов не совпадает с локальным и нелокальным разбиением товара'
  from ingest.import_rows row_data
  where row_data.batch_id = p_batch_id
    and not exists (select 1 from ingest.import_errors error where error.batch_id = row_data.batch_id and error.row_number = row_data.row_number)
    and ingest.try_numeric(row_data.payload ->> 'orders_total')
      <> ingest.try_numeric(row_data.payload ->> 'product_local_orders') + ingest.try_numeric(row_data.payload ->> 'product_nonlocal_orders');

  insert into ingest.import_errors (batch_id, sheet_name, row_number, error_code, message)
  select row_data.batch_id, row_data.sheet_name, row_data.row_number, 'fulfillment_mismatch',
    'Итого заказов не совпадает с суммой FBO и FBS'
  from ingest.import_rows row_data
  where row_data.batch_id = p_batch_id
    and not exists (select 1 from ingest.import_errors error where error.batch_id = row_data.batch_id and error.row_number = row_data.row_number)
    and ingest.try_numeric(row_data.payload ->> 'orders_total')
      <> ingest.try_numeric(row_data.payload ->> 'wb_local_orders') + ingest.try_numeric(row_data.payload ->> 'wb_nonlocal_orders')
        + ingest.try_numeric(row_data.payload ->> 'marketplace_local_orders') + ingest.try_numeric(row_data.payload ->> 'marketplace_nonlocal_orders');

  update ingest.import_rows row_data set accepted = not exists (
    select 1 from ingest.import_errors error
    where error.batch_id = row_data.batch_id and error.sheet_name = row_data.sheet_name and error.row_number = row_data.row_number
  ) where row_data.batch_id = p_batch_id;

  select count(*)::integer, count(distinct (sheet_name, row_number)) filter (where row_number is not null)::integer
  into v_error_count, v_rejected_rows from ingest.import_errors where batch_id = p_batch_id;
  if v_error_count > 0 then
    update ingest.import_batches set status = 'failed', input_rows = v_input_rows,
      accepted_rows = v_input_rows - v_rejected_rows, rejected_rows = v_rejected_rows,
      error_summary = v_error_count || ' validation errors', finished_at = timezone('utc', now())
    where id = p_batch_id;
    insert into ingest.import_events (batch_id, status, message, details, created_by)
    values (p_batch_id, 'failed', 'Geography batch validation failed',
      jsonb_build_object('error_count', v_error_count, 'rejected_rows', v_rejected_rows), v_user_id);
    return jsonb_build_object('batch_id', p_batch_id, 'status', 'failed', 'input_rows', v_input_rows,
      'accepted_rows', v_input_rows - v_rejected_rows, 'rejected_rows', v_rejected_rows, 'error_count', v_error_count);
  end if;

  delete from analytics.geography_order_versions where batch_id = p_batch_id;
  with resolved as (
    select row_data.*,
      (select product.id from core.products product
       where product.cabinet_id = v_batch.cabinet_id
         and ((btrim(coalesce(row_data.payload ->> 'seller_sku', '')) <> '' and product.seller_sku = btrim(row_data.payload ->> 'seller_sku'))
           or (btrim(coalesce(row_data.payload ->> 'wb_sku', '')) <> '' and product.wb_sku = btrim(row_data.payload ->> 'wb_sku')))
       order by product.id limit 1) as resolved_product_id
    from ingest.import_rows row_data
    where row_data.batch_id = p_batch_id and row_data.accepted
  ), ranked as (
    select resolved.*,
      row_number() over (partition by
        (payload ->> 'date')::date, resolved_product_id,
        ingest.normalize_geography_level(payload ->> 'region', ''),
        ingest.normalize_geography_level(payload ->> 'area', 'Без региона'),
        ingest.normalize_geography_level(payload ->> 'city', 'Без населённого пункта')
        order by row_number desc) as duplicate_rank
    from resolved
  )
  insert into analytics.geography_order_versions (
    batch_id, date, source_product_id, product_id, cabinet_id,
    region, normalized_region, area, normalized_area, city, normalized_city, delivery_hours,
    orders_total, product_local_orders, product_nonlocal_orders,
    wb_local_orders, wb_nonlocal_orders, marketplace_local_orders, marketplace_nonlocal_orders
  )
  select p_batch_id, (payload ->> 'date')::date,
    coalesce(nullif(btrim(payload ->> 'seller_sku'), ''), btrim(payload ->> 'wb_sku')),
    resolved_product_id, v_batch.cabinet_id,
    ingest.normalize_geography_level(payload ->> 'region', ''), ingest.normalize_geography_level(payload ->> 'region', ''),
    ingest.normalize_geography_level(payload ->> 'area', 'Без региона'), ingest.normalize_geography_level(payload ->> 'area', 'Без региона'),
    ingest.normalize_geography_level(payload ->> 'city', 'Без населённого пункта'), ingest.normalize_geography_level(payload ->> 'city', 'Без населённого пункта'),
    case when jsonb_typeof(payload -> 'delivery_hours') = 'number' then (payload ->> 'delivery_hours')::numeric else null end,
    (payload ->> 'orders_total')::bigint, (payload ->> 'product_local_orders')::bigint, (payload ->> 'product_nonlocal_orders')::bigint,
    (payload ->> 'wb_local_orders')::bigint, (payload ->> 'wb_nonlocal_orders')::bigint,
    (payload ->> 'marketplace_local_orders')::bigint, (payload ->> 'marketplace_nonlocal_orders')::bigint
  from ranked where duplicate_rank = 1;

  select count(*)::integer into v_canonical_rows from analytics.geography_order_versions where batch_id = p_batch_id;
  v_duplicate_rows := v_input_rows - v_canonical_rows;
  select min((payload ->> 'date')::date), max((payload ->> 'date')::date)
  into v_period_start, v_period_end from ingest.import_rows where batch_id = p_batch_id;
  update ingest.import_batches set status = 'published', period_start = v_period_start, period_end = v_period_end,
    input_rows = v_input_rows, accepted_rows = v_input_rows, rejected_rows = 0,
    metadata = metadata || jsonb_build_object('canonical_rows', v_canonical_rows, 'replaced_duplicate_rows', v_duplicate_rows),
    error_summary = null, validated_at = timezone('utc', now()), published_at = timezone('utc', now()), finished_at = timezone('utc', now())
  where id = p_batch_id;
  insert into ingest.import_events (batch_id, status, message, details, created_by)
  values (p_batch_id, 'published', 'Geography batch published',
    jsonb_build_object('input_rows', v_input_rows, 'canonical_rows', v_canonical_rows,
      'replaced_duplicate_rows', v_duplicate_rows, 'period_start', v_period_start, 'period_end', v_period_end), v_user_id);
  return jsonb_build_object('batch_id', p_batch_id, 'status', 'published', 'input_rows', v_input_rows,
    'accepted_rows', v_input_rows, 'rejected_rows', 0, 'canonical_rows', v_canonical_rows,
    'replaced_duplicate_rows', v_duplicate_rows, 'period_start', v_period_start, 'period_end', v_period_end);
end
$$;

revoke all on function public.v5_geography_publish_batch(uuid) from public, anon;
grant execute on function public.v5_geography_publish_batch(uuid) to authenticated;

create or replace function public.v5_geography_rollback_batch(p_batch_id uuid, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_rows integer;
begin
  if v_user_id is null or not app.is_admin() then raise exception 'V5 administrator access is required'; end if;
  perform 1 from ingest.import_batches batch
  where batch.id = p_batch_id and batch.source_code = 'geography' and batch.status = 'published' for update;
  if not found then raise exception 'Published geography batch % does not exist', p_batch_id; end if;
  select count(*)::integer into v_rows from analytics.geography_order_versions where batch_id = p_batch_id;
  update ingest.import_batches set status = 'cancelled', error_summary = nullif(btrim(p_reason), ''), finished_at = timezone('utc', now())
  where id = p_batch_id;
  insert into ingest.import_events (batch_id, status, message, details, created_by)
  values (p_batch_id, 'cancelled', 'Geography batch rolled back',
    jsonb_build_object('version_rows', v_rows, 'reason', nullif(btrim(p_reason), '')), v_user_id);
  return jsonb_build_object('batch_id', p_batch_id, 'status', 'cancelled', 'version_rows', v_rows);
end
$$;

revoke all on function public.v5_geography_rollback_batch(uuid, text) from public, anon;
grant execute on function public.v5_geography_rollback_batch(uuid, text) to authenticated;

create or replace function public.v5_health()
returns jsonb language sql stable security invoker set search_path = ''
as $$ select jsonb_build_object('environment', 'analytics-v5', 'schema_version', '20260910017000', 'status', 'ok') $$;

revoke all on function public.v5_health() from public;
grant execute on function public.v5_health() to anon, authenticated;

commit;
