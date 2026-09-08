begin;

create or replace function ingest.normalize_competitor_key(p_value text)
returns text
language sql
immutable
security invoker
set search_path = ''
as $$
  select lower(regexp_replace(btrim(coalesce(p_value, '')), '\s+', ' ', 'g'))
$$;

revoke all on function ingest.normalize_competitor_key(text) from public, anon, authenticated;

create or replace function public.v5_competitor_create_batch(
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
  v_extension text;
  v_object_path text;
begin
  if v_user_id is null or not app.can_import() then
    raise exception 'V5 importer access is required';
  end if;

  if p_original_filename is null or btrim(p_original_filename) = '' then
    raise exception 'Original filename is required';
  end if;

  v_extension := case
    when lower(p_original_filename) like '%.xlsx' then 'xlsx'
    when lower(p_original_filename) like '%.xls' then 'xls'
    else null
  end;
  if v_extension is null then
    raise exception 'Competitor import supports only .xlsx and .xls files';
  end if;

  if p_size_bytes is null or p_size_bytes <= 0 or p_size_bytes > 26214400 then
    raise exception 'Competitor source file must be between 1 byte and 25 MiB';
  end if;
  if p_file_sha256 is null or p_file_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'A lowercase SHA-256 file hash is required';
  end if;

  select batch.id, batch.status, file.object_path
  into v_existing_id, v_existing_status, v_existing_path
  from ingest.import_batches batch
  join ingest.import_files file on file.batch_id = batch.id
  where batch.source_code = 'competitors'
    and batch.cabinet_id is null
    and batch.file_sha256 = p_file_sha256
  limit 1;

  if v_existing_id is not null then
    return jsonb_build_object('batch_id', v_existing_id, 'object_path', v_existing_path, 'status', v_existing_status, 'duplicate', true);
  end if;

  v_object_path := v_user_id::text || '/' || v_batch_id::text || '/source.' || v_extension;
  insert into ingest.import_batches (
    id, source_code, created_by, status, idempotency_key, file_sha256, source_schema_version
  ) values (
    v_batch_id, 'competitors', v_user_id, 'created', 'competitors:' || p_file_sha256, p_file_sha256, 1
  ) on conflict do nothing;

  if not found then
    select batch.id, batch.status, file.object_path
    into strict v_existing_id, v_existing_status, v_existing_path
    from ingest.import_batches batch
    join ingest.import_files file on file.batch_id = batch.id
    where batch.source_code = 'competitors'
      and batch.cabinet_id is null
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
  values (v_batch_id, 'created', 'Competitor import batch created', v_user_id);

  return jsonb_build_object('batch_id', v_batch_id, 'object_path', v_object_path, 'status', 'created', 'duplicate', false);
end
$$;

revoke all on function public.v5_competitor_create_batch(text, text, bigint, text) from public, anon;
grant execute on function public.v5_competitor_create_batch(text, text, bigint, text) to authenticated;

create or replace function public.v5_competitor_reset_staging(p_batch_id uuid)
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
  select batch.* into v_batch
  from ingest.import_batches batch
  where batch.id = p_batch_id and batch.source_code = 'competitors'
  for update;
  if not found then raise exception 'Competitor import batch % does not exist', p_batch_id; end if;
  if v_batch.created_by <> v_user_id and not app.is_admin() then raise exception 'The competitor batch belongs to another user'; end if;
  if v_batch.status not in ('created', 'uploaded', 'validating', 'failed') then
    raise exception 'Competitor staging cannot be reset while batch status is %', v_batch.status;
  end if;

  select file.object_path into strict v_object_path from ingest.import_files file where file.batch_id = p_batch_id;
  v_source_exists := exists (
    select 1 from storage.objects object
    where object.bucket_id = 'v5-import-sources' and object.name = v_object_path
  );
  v_next_status := case when v_source_exists then 'uploaded'::ingest.batch_status else 'created'::ingest.batch_status end;

  delete from ingest.import_errors where batch_id = p_batch_id;
  delete from ingest.import_rows where batch_id = p_batch_id;
  get diagnostics v_cleared_rows = row_count;
  update ingest.import_batches
  set status = v_next_status, period_start = null, period_end = null, input_rows = 0, accepted_rows = 0,
      rejected_rows = 0, error_summary = null,
      uploaded_at = case when v_source_exists then coalesce(uploaded_at, timezone('utc', now())) else null end,
      validated_at = null, published_at = null, finished_at = null
  where id = p_batch_id;
  insert into ingest.import_events (batch_id, status, message, details, created_by)
  values (p_batch_id, v_next_status, 'Competitor staging reset for retry', jsonb_build_object('cleared_rows', v_cleared_rows, 'source_file_retained', v_source_exists), v_user_id);
  return jsonb_build_object('batch_id', p_batch_id, 'status', v_next_status, 'cleared_rows', v_cleared_rows, 'source_file_retained', v_source_exists);
end
$$;

revoke all on function public.v5_competitor_reset_staging(uuid) from public, anon;
grant execute on function public.v5_competitor_reset_staging(uuid) to authenticated;

create or replace function public.v5_competitor_stage_rows(p_batch_id uuid, p_rows jsonb)
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
  select batch.* into v_batch
  from ingest.import_batches batch
  where batch.id = p_batch_id and batch.source_code = 'competitors'
  for update;
  if not found then raise exception 'Competitor import batch % does not exist', p_batch_id; end if;
  if v_batch.created_by <> v_user_id and not app.is_admin() then raise exception 'The competitor batch belongs to another user'; end if;
  if v_batch.status not in ('created', 'uploaded', 'validating', 'failed') then
    raise exception 'Rows cannot be staged while competitor batch status is %', v_batch.status;
  end if;

  select file.object_path into strict v_object_path from ingest.import_files file where file.batch_id = p_batch_id;
  if not exists (
    select 1 from storage.objects object
    where object.bucket_id = 'v5-import-sources' and object.name = v_object_path
  ) then raise exception 'The source file must be uploaded before staging rows'; end if;

  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 or jsonb_array_length(p_rows) > 500 then
    raise exception 'Each staging chunk must contain between 1 and 500 rows';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_rows) item
    where jsonb_typeof(item) <> 'object'
      or coalesce(item ->> 'sheet_name', '') not in ('funnel', 'search', 'stocks', 'positions')
      or coalesce(item ->> 'row_number', '') !~ '^[1-9][0-9]{0,8}$'
      or jsonb_typeof(item -> 'payload') <> 'object'
  ) then raise exception 'Every staged row requires a canonical sheet_name, positive row_number and object payload'; end if;

  insert into ingest.import_rows (batch_id, sheet_name, row_number, row_hash, payload, accepted)
  select p_batch_id, item ->> 'sheet_name', (item ->> 'row_number')::integer,
         encode(extensions.digest((item -> 'payload')::text, 'sha256'), 'hex'), item -> 'payload', null
  from jsonb_array_elements(p_rows) item
  on conflict (batch_id, sheet_name, row_number) do update
  set row_hash = excluded.row_hash, payload = excluded.payload, accepted = null;

  select count(*)::integer into v_total_rows from ingest.import_rows row_data where row_data.batch_id = p_batch_id;
  if v_total_rows > 50000 then raise exception 'Competitor import is limited to 50000 staged rows'; end if;

  update ingest.import_batches
  set status = 'validating', input_rows = v_total_rows, uploaded_at = coalesce(uploaded_at, timezone('utc', now())),
      error_summary = null, finished_at = null
  where id = p_batch_id;
  insert into ingest.import_events (batch_id, status, message, details, created_by)
  values (p_batch_id, 'validating', 'Competitor rows staged', jsonb_build_object('chunk_rows', jsonb_array_length(p_rows), 'total_rows', v_total_rows), v_user_id);
  return jsonb_build_object('batch_id', p_batch_id, 'chunk_rows', jsonb_array_length(p_rows), 'total_rows', v_total_rows, 'status', 'validating');
end
$$;

revoke all on function public.v5_competitor_stage_rows(uuid, jsonb) from public, anon;
grant execute on function public.v5_competitor_stage_rows(uuid, jsonb) to authenticated;

create or replace function public.v5_competitor_publish_batch(p_batch_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_batch ingest.import_batches%rowtype;
  v_input_rows integer;
  v_error_count integer;
  v_rejected_rows integer;
  v_period_start date;
  v_period_end date;
  v_section_counts jsonb;
begin
  if v_user_id is null or not app.can_import() then raise exception 'V5 importer access is required'; end if;
  select batch.* into v_batch
  from ingest.import_batches batch
  where batch.id = p_batch_id and batch.source_code = 'competitors'
  for update;
  if not found then raise exception 'Competitor import batch % does not exist', p_batch_id; end if;
  if v_batch.created_by <> v_user_id and not app.is_admin() then raise exception 'The competitor batch belongs to another user'; end if;
  if v_batch.status not in ('validating', 'failed') then raise exception 'Competitor batch cannot be published while status is %', v_batch.status; end if;

  select count(*)::integer into v_input_rows from ingest.import_rows row_data where row_data.batch_id = p_batch_id;
  if v_input_rows = 0 then raise exception 'Competitor batch has no staged rows'; end if;
  delete from ingest.import_errors where batch_id = p_batch_id;

  insert into ingest.import_errors (batch_id, sheet_name, error_code, message)
  select p_batch_id, required.sheet_name, 'missing_section', 'Конкурентный файл должен содержать все четыре обязательных раздела'
  from (values ('funnel'), ('search'), ('stocks'), ('positions')) required(sheet_name)
  where not exists (
    select 1 from ingest.import_rows row_data where row_data.batch_id = p_batch_id and row_data.sheet_name = required.sheet_name
  );

  insert into ingest.import_errors (batch_id, sheet_name, row_number, column_name, error_code, message, raw_value)
  select row_data.batch_id, row_data.sheet_name, row_data.row_number, 'date', 'invalid_date',
         'Дата должна быть календарной датой в формате YYYY-MM-DD', row_data.payload ->> 'date'
  from ingest.import_rows row_data
  where row_data.batch_id = p_batch_id and not ingest.is_iso_date(row_data.payload ->> 'date');

  insert into ingest.import_errors (batch_id, sheet_name, row_number, column_name, error_code, message, raw_value)
  select row_data.batch_id, row_data.sheet_name, row_data.row_number, 'wb_article', 'invalid_article',
         'Артикул WB обязателен и не должен превышать 100 символов', row_data.payload ->> 'wb_article'
  from ingest.import_rows row_data
  where row_data.batch_id = p_batch_id
    and (btrim(coalesce(row_data.payload ->> 'wb_article', '')) = '' or length(row_data.payload ->> 'wb_article') > 100);

  insert into ingest.import_errors (batch_id, sheet_name, row_number, column_name, error_code, message, raw_value)
  select row_data.batch_id, row_data.sheet_name, row_data.row_number, required.column_name, 'missing_text',
         'Обязательное текстовое значение отсутствует или превышает допустимую длину', row_data.payload ->> required.column_name
  from ingest.import_rows row_data
  join lateral (
    select field.column_name, field.max_length
    from (values
      ('funnel', 'seller', 500), ('funnel', 'brand', 500),
      ('search', 'query', 1000),
      ('stocks', 'name', 2000), ('stocks', 'subject', 500), ('stocks', 'brand', 500), ('stocks', 'warehouse', 1000),
      ('positions', 'seller', 500), ('positions', 'brand', 500)
    ) field(sheet_name, column_name, max_length)
    where field.sheet_name = row_data.sheet_name
  ) required on true
  where row_data.batch_id = p_batch_id
    and (btrim(coalesce(row_data.payload ->> required.column_name, '')) = '' or length(row_data.payload ->> required.column_name) > required.max_length);

  insert into ingest.import_errors (batch_id, sheet_name, row_number, column_name, error_code, message, raw_value)
  select row_data.batch_id, row_data.sheet_name, row_data.row_number, required.column_name, 'invalid_number',
         'Обязательное значение должно быть неотрицательным числом', row_data.payload ->> required.column_name
  from ingest.import_rows row_data
  join lateral (
    select field.column_name
    from (values
      ('funnel', 'ordered_amount'), ('funnel', 'discounted_price'), ('funnel', 'buyer_median_price'),
      ('funnel', 'avg_search_position'),
      ('search', 'reported_cart_conversion'), ('search', 'reported_cart_conversion_previous'),
      ('search', 'reported_order_conversion'), ('search', 'reported_order_conversion_previous'),
      ('stocks', 'avg_daily_orders')
    ) field(sheet_name, column_name)
    where field.sheet_name = row_data.sheet_name
  ) required on true
  where row_data.batch_id = p_batch_id
    and (coalesce(jsonb_typeof(row_data.payload -> required.column_name), '') <> 'number'
      or ingest.try_numeric(row_data.payload ->> required.column_name) is null
      or ingest.try_numeric(row_data.payload ->> required.column_name) < 0
      or ingest.try_numeric(row_data.payload ->> required.column_name) >= 1000000000000000000);

  insert into ingest.import_errors (batch_id, sheet_name, row_number, column_name, error_code, message, raw_value)
  select row_data.batch_id, row_data.sheet_name, row_data.row_number, required.column_name, 'invalid_integer',
         'Обязательное значение должно быть целым неотрицательным числом', row_data.payload ->> required.column_name
  from ingest.import_rows row_data
  join lateral (
    select field.column_name
    from (values
      ('funnel', 'position'), ('funnel', 'impressions'), ('funnel', 'clicks'), ('funnel', 'carts'),
      ('funnel', 'orders'), ('funnel', 'buyouts'),
      ('search', 'requests'), ('search', 'requests_previous'),
      ('stocks', 'stock'), ('stocks', 'in_transit_to_customer'), ('stocks', 'in_transit_from_customer'),
      ('positions', 'position')
    ) field(sheet_name, column_name)
    where field.sheet_name = row_data.sheet_name
  ) required on true
  where row_data.batch_id = p_batch_id
    and (coalesce(jsonb_typeof(row_data.payload -> required.column_name), '') <> 'number'
      or ingest.try_numeric(row_data.payload ->> required.column_name) is null
      or ingest.try_numeric(row_data.payload ->> required.column_name) < 0
      or trunc(ingest.try_numeric(row_data.payload ->> required.column_name)) <> ingest.try_numeric(row_data.payload ->> required.column_name)
      or ingest.try_numeric(row_data.payload ->> required.column_name) > 9223372036854775807);

  insert into ingest.import_errors (batch_id, sheet_name, row_number, column_name, error_code, message, raw_value)
  select row_data.batch_id, row_data.sheet_name, row_data.row_number, required.column_name, 'invalid_percent',
         'Процент воронки должен находиться в диапазоне от 0 до 100', row_data.payload ->> required.column_name
  from ingest.import_rows row_data
  join lateral (
    select field.column_name
    from (values ('reported_ctr'), ('reported_cart_conversion'), ('reported_order_conversion'), ('reported_buyout_rate')) field(column_name)
    where row_data.sheet_name = 'funnel'
  ) required on true
  where row_data.batch_id = p_batch_id
    and (coalesce(jsonb_typeof(row_data.payload -> required.column_name), '') <> 'number'
      or ingest.try_numeric(row_data.payload ->> required.column_name) is null
      or ingest.try_numeric(row_data.payload ->> required.column_name) < 0
      or ingest.try_numeric(row_data.payload ->> required.column_name) > 100);

  insert into ingest.import_errors (batch_id, sheet_name, row_number, column_name, error_code, message, raw_value)
  select row_data.batch_id, row_data.sheet_name, row_data.row_number, 'position', 'position_out_of_range',
         'Позиция ежедневного TOP должна находиться в диапазоне 1–50', row_data.payload ->> 'position'
  from ingest.import_rows row_data
  where row_data.batch_id = p_batch_id and row_data.sheet_name = 'positions'
    and ingest.try_numeric(row_data.payload ->> 'position') is not null
    and ingest.try_numeric(row_data.payload ->> 'position') not between 1 and 50;

  insert into ingest.import_errors (batch_id, sheet_name, row_number, error_code, message)
  select row_data.batch_id, row_data.sheet_name, row_data.row_number, 'duplicate_key',
         'Составной ключ строки повторяется внутри раздела конкурентного файла'
  from ingest.import_rows row_data
  join (
    select keyed.sheet_name, keyed.business_key
    from (
      select source.sheet_name,
        case source.sheet_name
          when 'search' then coalesce(source.payload ->> 'date', '') || '|' || coalesce(source.payload ->> 'wb_article', '') || '|' || ingest.normalize_competitor_key(source.payload ->> 'query')
          when 'stocks' then coalesce(source.payload ->> 'date', '') || '|' || coalesce(source.payload ->> 'wb_article', '') || '|' || ingest.normalize_competitor_key(source.payload ->> 'region') || '|' || ingest.normalize_competitor_key(source.payload ->> 'warehouse')
          else coalesce(source.payload ->> 'date', '') || '|' || coalesce(source.payload ->> 'wb_article', '')
        end as business_key
      from ingest.import_rows source
      where source.batch_id = p_batch_id
    ) keyed
    group by keyed.sheet_name, keyed.business_key
    having count(*) > 1
  ) duplicates on duplicates.sheet_name = row_data.sheet_name
    and duplicates.business_key = case row_data.sheet_name
      when 'search' then coalesce(row_data.payload ->> 'date', '') || '|' || coalesce(row_data.payload ->> 'wb_article', '') || '|' || ingest.normalize_competitor_key(row_data.payload ->> 'query')
      when 'stocks' then coalesce(row_data.payload ->> 'date', '') || '|' || coalesce(row_data.payload ->> 'wb_article', '') || '|' || ingest.normalize_competitor_key(row_data.payload ->> 'region') || '|' || ingest.normalize_competitor_key(row_data.payload ->> 'warehouse')
      else coalesce(row_data.payload ->> 'date', '') || '|' || coalesce(row_data.payload ->> 'wb_article', '')
    end
  where row_data.batch_id = p_batch_id;

  update ingest.import_rows row_data
  set accepted = not exists (
    select 1 from ingest.import_errors error
    where error.batch_id = row_data.batch_id and error.sheet_name = row_data.sheet_name and error.row_number = row_data.row_number
  )
  where row_data.batch_id = p_batch_id;

  select count(*)::integer, count(distinct (sheet_name, row_number)) filter (where row_number is not null)::integer
  into v_error_count, v_rejected_rows
  from ingest.import_errors where batch_id = p_batch_id;

  if v_error_count > 0 then
    update ingest.import_batches
    set status = 'failed', input_rows = v_input_rows, accepted_rows = v_input_rows - v_rejected_rows,
        rejected_rows = v_rejected_rows, error_summary = v_error_count || ' validation errors', finished_at = timezone('utc', now())
    where id = p_batch_id;
    insert into ingest.import_events (batch_id, status, message, details, created_by)
    values (p_batch_id, 'failed', 'Competitor batch validation failed', jsonb_build_object('error_count', v_error_count, 'rejected_rows', v_rejected_rows), v_user_id);
    return jsonb_build_object('batch_id', p_batch_id, 'status', 'failed', 'input_rows', v_input_rows,
      'accepted_rows', v_input_rows - v_rejected_rows, 'rejected_rows', v_rejected_rows, 'error_count', v_error_count);
  end if;

  delete from analytics.competitor_funnel_versions where batch_id = p_batch_id;
  delete from analytics.competitor_search_versions where batch_id = p_batch_id;
  delete from analytics.competitor_stock_versions where batch_id = p_batch_id;
  delete from analytics.competitor_position_versions where batch_id = p_batch_id;

  insert into analytics.competitor_funnel_versions (
    batch_id, date, wb_article, position, seller, brand, ordered_amount, discounted_price, buyer_median_price,
    avg_search_position, impressions, clicks, reported_ctr, carts, reported_cart_conversion, orders,
    reported_order_conversion, buyouts, reported_buyout_rate
  )
  select p_batch_id, (payload ->> 'date')::date, btrim(payload ->> 'wb_article'), (payload ->> 'position')::integer,
    btrim(payload ->> 'seller'), btrim(payload ->> 'brand'), (payload ->> 'ordered_amount')::numeric,
    (payload ->> 'discounted_price')::numeric, (payload ->> 'buyer_median_price')::numeric,
    (payload ->> 'avg_search_position')::numeric, (payload ->> 'impressions')::bigint, (payload ->> 'clicks')::bigint,
    (payload ->> 'reported_ctr')::numeric, (payload ->> 'carts')::bigint, (payload ->> 'reported_cart_conversion')::numeric,
    (payload ->> 'orders')::bigint, (payload ->> 'reported_order_conversion')::numeric,
    (payload ->> 'buyouts')::bigint, (payload ->> 'reported_buyout_rate')::numeric
  from ingest.import_rows where batch_id = p_batch_id and sheet_name = 'funnel';

  insert into analytics.competitor_search_versions (
    batch_id, date, wb_article, query, normalized_query, requests, requests_previous,
    reported_cart_conversion, reported_cart_conversion_previous, reported_order_conversion, reported_order_conversion_previous
  )
  select p_batch_id, (payload ->> 'date')::date, btrim(payload ->> 'wb_article'), btrim(payload ->> 'query'),
    ingest.normalize_competitor_key(payload ->> 'query'), (payload ->> 'requests')::bigint, (payload ->> 'requests_previous')::bigint,
    (payload ->> 'reported_cart_conversion')::numeric, (payload ->> 'reported_cart_conversion_previous')::numeric,
    (payload ->> 'reported_order_conversion')::numeric, (payload ->> 'reported_order_conversion_previous')::numeric
  from ingest.import_rows where batch_id = p_batch_id and sheet_name = 'search';

  insert into analytics.competitor_stock_versions (
    batch_id, date, wb_article, name, subject, brand, region, normalized_region, warehouse, normalized_warehouse,
    stock, in_transit_to_customer, in_transit_from_customer, avg_daily_orders
  )
  select p_batch_id, (payload ->> 'date')::date, btrim(payload ->> 'wb_article'), btrim(payload ->> 'name'),
    btrim(payload ->> 'subject'), btrim(payload ->> 'brand'), btrim(coalesce(payload ->> 'region', '')),
    ingest.normalize_competitor_key(payload ->> 'region'), btrim(payload ->> 'warehouse'),
    ingest.normalize_competitor_key(payload ->> 'warehouse'), (payload ->> 'stock')::bigint,
    (payload ->> 'in_transit_to_customer')::bigint, (payload ->> 'in_transit_from_customer')::bigint,
    (payload ->> 'avg_daily_orders')::numeric
  from ingest.import_rows where batch_id = p_batch_id and sheet_name = 'stocks';

  insert into analytics.competitor_position_versions (batch_id, date, wb_article, position, seller, brand)
  select p_batch_id, (payload ->> 'date')::date, btrim(payload ->> 'wb_article'), (payload ->> 'position')::integer,
    btrim(payload ->> 'seller'), btrim(payload ->> 'brand')
  from ingest.import_rows where batch_id = p_batch_id and sheet_name = 'positions';

  select min((payload ->> 'date')::date), max((payload ->> 'date')::date)
  into v_period_start, v_period_end from ingest.import_rows where batch_id = p_batch_id;
  select jsonb_object_agg(section.sheet_name, section.row_count)
  into v_section_counts
  from (select sheet_name, count(*) as row_count from ingest.import_rows where batch_id = p_batch_id group by sheet_name) section;

  update ingest.import_batches
  set status = 'published', period_start = v_period_start, period_end = v_period_end,
      input_rows = v_input_rows, accepted_rows = v_input_rows, rejected_rows = 0,
      metadata = metadata || jsonb_build_object('section_counts', v_section_counts), error_summary = null,
      validated_at = timezone('utc', now()), published_at = timezone('utc', now()), finished_at = timezone('utc', now())
  where id = p_batch_id;
  insert into ingest.import_events (batch_id, status, message, details, created_by)
  values (p_batch_id, 'published', 'Competitor batch published',
    jsonb_build_object('rows', v_input_rows, 'period_start', v_period_start, 'period_end', v_period_end, 'section_counts', v_section_counts), v_user_id);
  return jsonb_build_object('batch_id', p_batch_id, 'status', 'published', 'input_rows', v_input_rows,
    'accepted_rows', v_input_rows, 'rejected_rows', 0, 'period_start', v_period_start, 'period_end', v_period_end,
    'section_counts', v_section_counts);
end
$$;

revoke all on function public.v5_competitor_publish_batch(uuid) from public, anon;
grant execute on function public.v5_competitor_publish_batch(uuid) to authenticated;

create or replace function public.v5_competitor_rollback_batch(p_batch_id uuid, p_reason text default null)
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
  where batch.id = p_batch_id and batch.source_code = 'competitors' and batch.status = 'published'
  for update;
  if not found then raise exception 'Published competitor batch % does not exist', p_batch_id; end if;
  select
    (select count(*) from analytics.competitor_funnel_versions where batch_id = p_batch_id)
    + (select count(*) from analytics.competitor_search_versions where batch_id = p_batch_id)
    + (select count(*) from analytics.competitor_stock_versions where batch_id = p_batch_id)
    + (select count(*) from analytics.competitor_position_versions where batch_id = p_batch_id)
  into v_rows;
  update ingest.import_batches
  set status = 'cancelled', error_summary = nullif(btrim(p_reason), ''), finished_at = timezone('utc', now())
  where id = p_batch_id;
  insert into ingest.import_events (batch_id, status, message, details, created_by)
  values (p_batch_id, 'cancelled', 'Competitor batch rolled back', jsonb_build_object('version_rows', v_rows, 'reason', nullif(btrim(p_reason), '')), v_user_id);
  return jsonb_build_object('batch_id', p_batch_id, 'status', 'cancelled', 'version_rows', v_rows);
end
$$;

revoke all on function public.v5_competitor_rollback_batch(uuid, text) from public, anon;
grant execute on function public.v5_competitor_rollback_batch(uuid, text) to authenticated;

create or replace function public.v5_health()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object('environment', 'analytics-v5', 'schema_version', '20260908012000', 'status', 'ok')
$$;

revoke all on function public.v5_health() from public;
grant execute on function public.v5_health() to anon, authenticated;

commit;
