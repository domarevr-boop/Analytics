begin;

create table analytics.entry_point_versions (
  batch_id uuid not null references ingest.import_batches(id) on delete restrict,
  date date not null,
  source_product_id text not null,
  product_id uuid not null,
  cabinet_id uuid not null,
  section text not null,
  entry_point text not null,
  impressions bigint not null,
  clicks bigint not null,
  carts bigint not null,
  orders bigint not null,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (batch_id, date, product_id, section, entry_point),
  foreign key (product_id, cabinet_id) references core.products(id, cabinet_id) on delete restrict,
  constraint entry_points_source_product_present check (btrim(source_product_id) <> '' and length(source_product_id) <= 500),
  constraint entry_points_labels_present check (
    btrim(section) <> '' and length(section) <= 1000
    and btrim(entry_point) <> '' and length(entry_point) <= 1000
  ),
  constraint entry_points_values_nonnegative check (
    impressions >= 0 and clicks >= 0 and carts >= 0 and orders >= 0
  )
);

create index entry_point_versions_batch_date_idx
on analytics.entry_point_versions (batch_id, date);

create index entry_point_versions_cabinet_date_idx
on analytics.entry_point_versions (cabinet_id, date, batch_id);

create index entry_point_versions_product_date_idx
on analytics.entry_point_versions (product_id, date, batch_id);

create index entry_point_versions_point_date_idx
on analytics.entry_point_versions (section, entry_point, date, batch_id);

alter table analytics.entry_point_versions enable row level security;

create policy entry_point_versions_read_allowed
on analytics.entry_point_versions for select to authenticated
using (app.can_access_cabinet(cabinet_id) and app.can_read_batch(batch_id));

revoke all on analytics.entry_point_versions from public, anon, authenticated;

create or replace function public.v5_entry_points_create_batch(
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
    raise exception 'Entry points import supports only .xlsx files';
  end if;
  if p_size_bytes is null or p_size_bytes <= 0 or p_size_bytes > 26214400 then
    raise exception 'Entry points source file must be between 1 byte and 25 MiB';
  end if;
  if p_file_sha256 is null or p_file_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'A lowercase SHA-256 file hash is required';
  end if;

  select batch.id, batch.status, file.object_path
  into v_existing_id, v_existing_status, v_existing_path
  from ingest.import_batches batch
  join ingest.import_files file on file.batch_id = batch.id
  where batch.source_code = 'entry_points'
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
    v_batch_id, 'entry_points', p_cabinet_id, v_user_id, 'created',
    'entry-points:' || p_cabinet_id::text || ':' || p_file_sha256, p_file_sha256, 1
  ) on conflict do nothing;

  if not found then
    select batch.id, batch.status, file.object_path
    into strict v_existing_id, v_existing_status, v_existing_path
    from ingest.import_batches batch
    join ingest.import_files file on file.batch_id = batch.id
    where batch.source_code = 'entry_points'
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
  values (v_batch_id, 'created', 'Entry points import batch created', v_user_id);
  return jsonb_build_object('batch_id', v_batch_id, 'object_path', v_object_path, 'status', 'created', 'duplicate', false);
end
$$;

revoke all on function public.v5_entry_points_create_batch(uuid, text, text, bigint, text) from public, anon;
grant execute on function public.v5_entry_points_create_batch(uuid, text, text, bigint, text) to authenticated;

create or replace function public.v5_entry_points_reset_staging(p_batch_id uuid)
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
  where batch.id = p_batch_id and batch.source_code = 'entry_points' for update;
  if not found then raise exception 'Entry points import batch % does not exist', p_batch_id; end if;
  if v_batch.created_by <> v_user_id and not app.is_admin() then raise exception 'The entry points batch belongs to another user'; end if;
  if not app.can_access_cabinet(v_batch.cabinet_id) then raise exception 'The entry points batch cabinet is not accessible'; end if;
  if v_batch.status not in ('created', 'uploaded', 'validating', 'failed') then
    raise exception 'Entry points staging cannot be reset while batch status is %', v_batch.status;
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
  values (p_batch_id, v_next_status, 'Entry points staging reset for retry',
    jsonb_build_object('cleared_rows', v_cleared_rows, 'source_file_retained', v_source_exists), v_user_id);
  return jsonb_build_object('batch_id', p_batch_id, 'status', v_next_status, 'cleared_rows', v_cleared_rows, 'source_file_retained', v_source_exists);
end
$$;

revoke all on function public.v5_entry_points_reset_staging(uuid) from public, anon;
grant execute on function public.v5_entry_points_reset_staging(uuid) to authenticated;

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

  insert into ingest.import_rows (batch_id, sheet_name, row_number, row_hash, payload, accepted)
  select p_batch_id, 'entry_points', (item ->> 'row_number')::integer,
    encode(extensions.digest((item -> 'payload')::text, 'sha256'), 'hex'), item -> 'payload', null
  from jsonb_array_elements(p_rows) item
  on conflict (batch_id, sheet_name, row_number) do update
  set row_hash = excluded.row_hash, payload = excluded.payload, accepted = null;

  select count(*)::integer into v_total_rows from ingest.import_rows row_data where row_data.batch_id = p_batch_id;
  if v_total_rows > 250000 then raise exception 'Entry points import is limited to 250000 staged rows'; end if;
  update ingest.import_batches set status = 'validating', input_rows = v_total_rows,
    uploaded_at = coalesce(uploaded_at, timezone('utc', now())), finished_at = null
  where id = p_batch_id;
  insert into ingest.import_events (batch_id, status, message, details, created_by)
  values (p_batch_id, 'validating', 'Entry points rows staged', jsonb_build_object('staged_rows', v_total_rows), v_user_id);
  return jsonb_build_object('batch_id', p_batch_id, 'status', 'validating', 'staged_rows', v_total_rows);
end
$$;

revoke all on function public.v5_entry_points_stage_rows(uuid, jsonb) from public, anon;
grant execute on function public.v5_entry_points_stage_rows(uuid, jsonb) to authenticated;

create or replace function public.v5_entry_points_publish_batch(p_batch_id uuid)
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
  v_row record;
  v_product_id uuid;
  v_product core.products%rowtype;
  v_created_products integer := 0;
  v_resolved_products integer := 0;
begin
  if v_user_id is null or not app.can_import() then raise exception 'V5 importer access is required'; end if;
  select batch.* into v_batch from ingest.import_batches batch
  where batch.id = p_batch_id and batch.source_code = 'entry_points' for update;
  if not found then raise exception 'Entry points import batch % does not exist', p_batch_id; end if;
  if v_batch.created_by <> v_user_id and not app.is_admin() then raise exception 'The entry points batch belongs to another user'; end if;
  if not app.can_access_cabinet(v_batch.cabinet_id) then raise exception 'The entry points batch cabinet is not accessible'; end if;
  if v_batch.status not in ('uploaded', 'validating', 'failed') then
    raise exception 'Entry points batch cannot be published while status is %', v_batch.status;
  end if;
  select file.object_path into strict v_object_path from ingest.import_files file where file.batch_id = p_batch_id;
  if not exists (
    select 1 from storage.objects object where object.bucket_id = 'v5-import-sources' and object.name = v_object_path
  ) then raise exception 'The source file must be retained before entry points publication'; end if;
  select count(*)::integer into v_input_rows from ingest.import_rows row_data where row_data.batch_id = p_batch_id;
  if v_input_rows = 0 then raise exception 'Entry points batch has no staged rows'; end if;

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
  join lateral (values ('section', 1000)) required(column_name, max_length) on true
  where row_data.batch_id = p_batch_id
    and (btrim(coalesce(row_data.payload ->> required.column_name, '')) = ''
      or length(row_data.payload ->> required.column_name) > required.max_length);

  insert into ingest.import_errors (batch_id, sheet_name, row_number, column_name, error_code, message, raw_value)
  select row_data.batch_id, row_data.sheet_name, row_data.row_number, 'entry_point', 'invalid_entry_point',
    'Точка входа не должна превышать 1000 символов', row_data.payload ->> 'entry_point'
  from ingest.import_rows row_data
  where row_data.batch_id = p_batch_id and length(coalesce(row_data.payload ->> 'entry_point', '')) > 1000;

  insert into ingest.import_errors (batch_id, sheet_name, row_number, error_code, message)
  select row_data.batch_id, row_data.sheet_name, row_data.row_number, 'missing_product_identity',
    'Требуется артикул продавца или WB'
  from ingest.import_rows row_data
  where row_data.batch_id = p_batch_id
    and btrim(coalesce(row_data.payload ->> 'seller_sku', '')) = ''
    and btrim(coalesce(row_data.payload ->> 'wb_sku', '')) = '';

  insert into ingest.import_errors (batch_id, sheet_name, row_number, error_code, message)
  select row_data.batch_id, row_data.sheet_name, row_data.row_number, 'ambiguous_product',
    'Артикулы строки соответствуют нескольким товарам справочника'
  from ingest.import_rows row_data
  cross join lateral (
    select count(distinct candidate.product_id)::integer as match_count
    from (
      select product.id as product_id
      from core.products product
      where product.cabinet_id = v_batch.cabinet_id
        and (
          (btrim(coalesce(row_data.payload ->> 'seller_sku', '')) <> '' and (
            product.seller_sku = btrim(row_data.payload ->> 'seller_sku')
            or core.canonical_seller_sku(product.seller_sku) = core.canonical_seller_sku(row_data.payload ->> 'seller_sku')
            or product.wb_sku = btrim(row_data.payload ->> 'seller_sku')
          ))
          or (btrim(coalesce(row_data.payload ->> 'wb_sku', '')) <> '' and (
            product.wb_sku = btrim(row_data.payload ->> 'wb_sku')
            or product.seller_sku = btrim(row_data.payload ->> 'wb_sku')
          ))
        )
      union
      select alias.product_id
      from core.product_aliases alias
      where alias.cabinet_id = v_batch.cabinet_id
        and (
          alias.alias_value = nullif(btrim(row_data.payload ->> 'seller_sku'), '')
          or core.canonical_seller_sku(alias.alias_value) = nullif(core.canonical_seller_sku(row_data.payload ->> 'seller_sku'), '')
          or alias.alias_value = nullif(btrim(row_data.payload ->> 'wb_sku'), '')
        )
    ) candidate
  ) matched
  where row_data.batch_id = p_batch_id and matched.match_count > 1;

  insert into ingest.import_errors (batch_id, sheet_name, row_number, column_name, error_code, message, raw_value)
  select row_data.batch_id, row_data.sheet_name, row_data.row_number, required.column_name, 'invalid_integer',
    'Обязательное значение должно быть целым неотрицательным числом', row_data.payload ->> required.column_name
  from ingest.import_rows row_data
  join lateral (values ('impressions'), ('clicks'), ('carts'), ('orders')) required(column_name) on true
  where row_data.batch_id = p_batch_id
    and (coalesce(jsonb_typeof(row_data.payload -> required.column_name), '') <> 'number'
      or ingest.try_numeric(row_data.payload ->> required.column_name) is null
      or ingest.try_numeric(row_data.payload ->> required.column_name) < 0
      or trunc(ingest.try_numeric(row_data.payload ->> required.column_name)) <> ingest.try_numeric(row_data.payload ->> required.column_name)
      or ingest.try_numeric(row_data.payload ->> required.column_name) > 9223372036854775807);

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
    values (p_batch_id, 'failed', 'Entry points batch validation failed',
      jsonb_build_object('error_count', v_error_count, 'rejected_rows', v_rejected_rows), v_user_id);
    return jsonb_build_object('batch_id', p_batch_id, 'status', 'failed', 'input_rows', v_input_rows,
      'accepted_rows', v_input_rows - v_rejected_rows, 'rejected_rows', v_rejected_rows, 'error_count', v_error_count);
  end if;

  for v_row in
    select row_data.sheet_name, row_data.row_number, row_data.payload
    from ingest.import_rows row_data
    where row_data.batch_id = p_batch_id and row_data.accepted
    order by row_data.sheet_name, row_data.row_number
  loop
    v_product_id := core.resolve_or_create_import_product(
      v_batch.cabinet_id,
      v_row.payload ->> 'seller_sku',
      v_row.payload ->> 'wb_sku',
      p_batch_id,
      (v_row.payload ->> 'date')::date
    );
    select product.* into strict v_product from core.products product where product.id = v_product_id;
    update ingest.import_rows row_data
    set payload = row_data.payload || jsonb_build_object(
          'source_seller_sku', v_row.payload ->> 'seller_sku',
          'source_wb_sku', v_row.payload ->> 'wb_sku',
          'product_id', v_product_id,
          'seller_sku', v_product.seller_sku,
          'wb_sku', v_product.wb_sku
        ),
        row_hash = encode(extensions.digest((row_data.payload || jsonb_build_object(
          'source_seller_sku', v_row.payload ->> 'seller_sku',
          'source_wb_sku', v_row.payload ->> 'wb_sku',
          'product_id', v_product_id,
          'seller_sku', v_product.seller_sku,
          'wb_sku', v_product.wb_sku
        ))::text, 'sha256'), 'hex')
    where row_data.batch_id = p_batch_id
      and row_data.sheet_name = v_row.sheet_name
      and row_data.row_number = v_row.row_number;
  end loop;

  delete from analytics.entry_point_versions where batch_id = p_batch_id;
  with ranked as (
    select row_data.*,
      row_number() over (partition by
        (payload ->> 'date')::date,
        (payload ->> 'product_id')::uuid,
        btrim(payload ->> 'section'),
        case when btrim(coalesce(payload ->> 'entry_point', '')) in ('', '-', '—') then 'Без уточнения' else btrim(payload ->> 'entry_point') end
        order by row_number desc) as duplicate_rank
    from ingest.import_rows row_data
    where row_data.batch_id = p_batch_id and row_data.accepted
  )
  insert into analytics.entry_point_versions (
    batch_id, date, source_product_id, product_id, cabinet_id,
    section, entry_point, impressions, clicks, carts, orders
  )
  select p_batch_id, (payload ->> 'date')::date,
    coalesce(nullif(btrim(payload ->> 'source_seller_sku'), ''), btrim(payload ->> 'source_wb_sku')),
    (payload ->> 'product_id')::uuid, v_batch.cabinet_id,
    btrim(payload ->> 'section'), case when btrim(coalesce(payload ->> 'entry_point', '')) in ('', '-', '—') then 'Без уточнения' else btrim(payload ->> 'entry_point') end,
    (payload ->> 'impressions')::bigint, (payload ->> 'clicks')::bigint,
    (payload ->> 'carts')::bigint, (payload ->> 'orders')::bigint
  from ranked where duplicate_rank = 1;

  select count(*)::integer into v_canonical_rows from analytics.entry_point_versions where batch_id = p_batch_id;
  v_duplicate_rows := v_input_rows - v_canonical_rows;
  select min((payload ->> 'date')::date), max((payload ->> 'date')::date)
  into v_period_start, v_period_end from ingest.import_rows where batch_id = p_batch_id;
  select count(distinct (payload ->> 'product_id')::uuid)::integer
  into v_resolved_products from ingest.import_rows where batch_id = p_batch_id;
  select count(*)::integer into v_created_products
  from core.products product where product.source_batch_id = p_batch_id;

  update ingest.import_batches set status = 'published', period_start = v_period_start, period_end = v_period_end,
    input_rows = v_input_rows, accepted_rows = v_input_rows, rejected_rows = 0,
    metadata = metadata || jsonb_build_object(
      'canonical_rows', v_canonical_rows,
      'replaced_duplicate_rows', v_duplicate_rows,
      'products_created', v_created_products,
      'products_resolved', v_resolved_products
    ),
    error_summary = null, validated_at = timezone('utc', now()), published_at = timezone('utc', now()), finished_at = timezone('utc', now())
  where id = p_batch_id;
  insert into ingest.import_events (batch_id, status, message, details, created_by)
  values (p_batch_id, 'published', 'Entry points batch published',
    jsonb_build_object('input_rows', v_input_rows, 'canonical_rows', v_canonical_rows,
      'replaced_duplicate_rows', v_duplicate_rows, 'products_created', v_created_products,
      'products_resolved', v_resolved_products, 'period_start', v_period_start, 'period_end', v_period_end), v_user_id);
  return jsonb_build_object('batch_id', p_batch_id, 'status', 'published', 'input_rows', v_input_rows,
    'accepted_rows', v_input_rows, 'rejected_rows', 0, 'canonical_rows', v_canonical_rows,
    'replaced_duplicate_rows', v_duplicate_rows, 'products_created', v_created_products,
    'products_resolved', v_resolved_products, 'period_start', v_period_start, 'period_end', v_period_end);
end
$$;

revoke all on function public.v5_entry_points_publish_batch(uuid) from public, anon;
grant execute on function public.v5_entry_points_publish_batch(uuid) to authenticated;

create or replace function public.v5_entry_points_rollback_batch(p_batch_id uuid, p_reason text default null)
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
  where batch.id = p_batch_id and batch.source_code = 'entry_points' and batch.status = 'published' for update;
  if not found then raise exception 'Published entry points batch % does not exist', p_batch_id; end if;
  select count(*)::integer into v_rows from analytics.entry_point_versions where batch_id = p_batch_id;
  update ingest.import_batches set status = 'cancelled', error_summary = nullif(btrim(p_reason), ''), finished_at = timezone('utc', now())
  where id = p_batch_id;
  insert into ingest.import_events (batch_id, status, message, details, created_by)
  values (p_batch_id, 'cancelled', 'Entry points batch rolled back',
    jsonb_build_object('version_rows', v_rows, 'reason', nullif(btrim(p_reason), '')), v_user_id);
  return jsonb_build_object('batch_id', p_batch_id, 'status', 'cancelled', 'version_rows', v_rows);
end
$$;

revoke all on function public.v5_entry_points_rollback_batch(uuid, text) from public, anon;
grant execute on function public.v5_entry_points_rollback_batch(uuid, text) to authenticated;

create or replace function app.v5_current_entry_point_batches()
returns table (batch_id uuid, cabinet_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select selected.id, selected.cabinet_id
  from (
    select distinct on (batch.cabinet_id) batch.id, batch.cabinet_id
    from ingest.import_batches batch
    where batch.source_code = 'entry_points'
      and batch.status = 'published'
      and batch.cabinet_id is not null
      and app.can_access_cabinet(batch.cabinet_id)
    order by batch.cabinet_id, batch.published_at desc nulls last, batch.id desc
  ) selected
$$;

revoke all on function app.v5_current_entry_point_batches() from public, anon, authenticated;

create or replace function app.v5_assert_entry_points_read(
  p_start date,
  p_end date,
  p_cabinet_ids uuid[] default null,
  p_product_ids uuid[] default null
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not app.can_read() then raise exception 'V5 read access is required'; end if;
  if p_start is null or p_end is null or p_end < p_start or p_end - p_start > 731 then
    raise exception 'Entry points range is invalid or exceeds 731 days';
  end if;
  if coalesce(cardinality(p_cabinet_ids), 0) > 100 then raise exception 'At most 100 cabinets are allowed'; end if;
  if coalesce(cardinality(p_product_ids), 0) > 500 then raise exception 'At most 500 products are allowed'; end if;
  if exists (select 1 from unnest(coalesce(p_cabinet_ids, array[]::uuid[])) cabinet_id where not app.can_access_cabinet(cabinet_id)) then
    raise exception 'One or more requested cabinets are not accessible';
  end if;
end
$$;

revoke all on function app.v5_assert_entry_points_read(date, date, uuid[], uuid[]) from public, anon, authenticated;

create or replace function public.v5_entry_points_filter_options(
  p_start date,
  p_end date,
  p_section text default null,
  p_limit integer default 500
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  perform app.v5_assert_entry_points_read(p_start, p_end, null, null);
  if p_limit is null or p_limit < 1 or p_limit > 500 then raise exception 'Entry points filter limit must be between 1 and 500'; end if;
  if length(coalesce(p_section, '')) > 1000 then raise exception 'Entry points section must not exceed 1000 characters'; end if;

  with current_batches as (select * from app.v5_current_entry_point_batches()),
  base as (
    select row_data.*
    from analytics.entry_point_versions row_data
    join current_batches batch on batch.batch_id = row_data.batch_id and batch.cabinet_id = row_data.cabinet_id
    where row_data.date between p_start and p_end
  )
  select jsonb_build_object(
    'min_date', min(base.date),
    'max_date', max(base.date),
    'cabinet_count', count(distinct base.cabinet_id),
    'product_count', count(distinct base.product_id),
    'sections', coalesce((select jsonb_agg(item.value order by item.value) from
      (select distinct source.section as value from base source order by value limit p_limit) item), '[]'::jsonb),
    'entry_points', coalesce((select jsonb_agg(item.value order by item.value) from
      (select distinct source.entry_point as value from base source
       where nullif(btrim(p_section), '') is null or source.section = p_section
       order by value limit p_limit) item), '[]'::jsonb)
  ) into v_result from base;
  return v_result;
end
$$;

revoke all on function public.v5_entry_points_filter_options(date, date, text, integer) from public, anon;
grant execute on function public.v5_entry_points_filter_options(date, date, text, integer) to authenticated;

create or replace function public.v5_entry_points_summary(
  p_start date,
  p_end date,
  p_cabinet_ids uuid[] default null,
  p_product_ids uuid[] default null,
  p_category_ids uuid[] default null,
  p_brand_ids uuid[] default null,
  p_group_ids uuid[] default null,
  p_search text default null,
  p_section text default null,
  p_entry_point text default null
)
returns table (
  impressions bigint,
  clicks bigint,
  carts bigint,
  orders bigint,
  point_count bigint,
  product_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.v5_assert_entry_points_read(p_start, p_end, p_cabinet_ids, p_product_ids);
  if coalesce(cardinality(p_category_ids), 0) > 100 or coalesce(cardinality(p_brand_ids), 0) > 100
    or coalesce(cardinality(p_group_ids), 0) > 500 then raise exception 'Entry points directory filter is too large'; end if;
  if length(coalesce(p_search, '')) > 100 then raise exception 'Entry points search must not exceed 100 characters'; end if;
  return query
  with current_batches as (select * from app.v5_current_entry_point_batches()),
  base as (
    select row_data.*
    from analytics.entry_point_versions row_data
    join current_batches batch on batch.batch_id = row_data.batch_id and batch.cabinet_id = row_data.cabinet_id
    join core.products product on product.id = row_data.product_id and product.cabinet_id = row_data.cabinet_id
    left join lateral (
      select membership.group_id from core.group_membership_versions membership
      where membership.product_id = row_data.product_id and membership.effective_date <= row_data.date
      order by membership.effective_date desc, membership.id desc limit 1
    ) membership on true
    where row_data.date between p_start and p_end
      and (p_cabinet_ids is null or row_data.cabinet_id = any(p_cabinet_ids))
      and (p_product_ids is null or row_data.product_id = any(p_product_ids))
      and (p_category_ids is null or product.category_id = any(p_category_ids))
      and (p_brand_ids is null or product.brand_id = any(p_brand_ids))
      and (p_group_ids is null or membership.group_id = any(p_group_ids))
      and (nullif(btrim(p_search), '') is null or product.name ilike '%' || btrim(p_search) || '%'
        or product.seller_sku ilike '%' || btrim(p_search) || '%' or product.wb_sku ilike '%' || btrim(p_search) || '%'
        or exists (select 1 from core.product_aliases alias where alias.product_id = product.id and alias.alias_value ilike '%' || btrim(p_search) || '%'))
      and (nullif(btrim(p_section), '') is null or row_data.section = p_section)
      and (nullif(btrim(p_entry_point), '') is null or row_data.entry_point = p_entry_point)
  )
  select coalesce(sum(base.impressions), 0)::bigint, coalesce(sum(base.clicks), 0)::bigint,
    coalesce(sum(base.carts), 0)::bigint, coalesce(sum(base.orders), 0)::bigint,
    count(distinct (base.section, base.entry_point))::bigint, count(distinct base.product_id)::bigint
  from base;
end
$$;

revoke all on function public.v5_entry_points_summary(date, date, uuid[], uuid[], uuid[], uuid[], uuid[], text, text, text) from public, anon;
grant execute on function public.v5_entry_points_summary(date, date, uuid[], uuid[], uuid[], uuid[], uuid[], text, text, text) to authenticated;

create or replace function public.v5_entry_points_series(
  p_start date,
  p_end date,
  p_cabinet_ids uuid[] default null,
  p_product_ids uuid[] default null,
  p_category_ids uuid[] default null,
  p_brand_ids uuid[] default null,
  p_group_ids uuid[] default null,
  p_search text default null,
  p_section text default null,
  p_entry_point text default null
)
returns table (
  period_date date,
  impressions bigint,
  clicks bigint,
  carts bigint,
  orders bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.v5_assert_entry_points_read(p_start, p_end, p_cabinet_ids, p_product_ids);
  return query
  with current_batches as (select * from app.v5_current_entry_point_batches()),
  base as (
    select row_data.*
    from analytics.entry_point_versions row_data
    join current_batches batch on batch.batch_id = row_data.batch_id and batch.cabinet_id = row_data.cabinet_id
    join core.products product on product.id = row_data.product_id and product.cabinet_id = row_data.cabinet_id
    left join lateral (
      select membership.group_id from core.group_membership_versions membership
      where membership.product_id = row_data.product_id and membership.effective_date <= row_data.date
      order by membership.effective_date desc, membership.id desc limit 1
    ) membership on true
    where row_data.date between p_start and p_end
      and (p_cabinet_ids is null or row_data.cabinet_id = any(p_cabinet_ids))
      and (p_product_ids is null or row_data.product_id = any(p_product_ids))
      and (p_category_ids is null or product.category_id = any(p_category_ids))
      and (p_brand_ids is null or product.brand_id = any(p_brand_ids))
      and (p_group_ids is null or membership.group_id = any(p_group_ids))
      and (nullif(btrim(p_search), '') is null or product.name ilike '%' || btrim(p_search) || '%'
        or product.seller_sku ilike '%' || btrim(p_search) || '%' or product.wb_sku ilike '%' || btrim(p_search) || '%')
      and (nullif(btrim(p_section), '') is null or row_data.section = p_section)
      and (nullif(btrim(p_entry_point), '') is null or row_data.entry_point = p_entry_point)
  )
  select base.date, sum(base.impressions)::bigint, sum(base.clicks)::bigint,
    sum(base.carts)::bigint, sum(base.orders)::bigint
  from base group by base.date order by base.date;
end
$$;

revoke all on function public.v5_entry_points_series(date, date, uuid[], uuid[], uuid[], uuid[], uuid[], text, text, text) from public, anon;
grant execute on function public.v5_entry_points_series(date, date, uuid[], uuid[], uuid[], uuid[], uuid[], text, text, text) to authenticated;

create or replace function public.v5_entry_points_matrix(
  p_start date,
  p_end date,
  p_metric text default 'orders',
  p_cabinet_ids uuid[] default null,
  p_product_ids uuid[] default null,
  p_category_ids uuid[] default null,
  p_brand_ids uuid[] default null,
  p_group_ids uuid[] default null,
  p_search text default null,
  p_section text default null,
  p_entry_point text default null,
  p_limit integer default 100
)
returns table (
  section text,
  entry_point text,
  period_date date,
  impressions bigint,
  clicks bigint,
  carts bigint,
  orders bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.v5_assert_entry_points_read(p_start, p_end, p_cabinet_ids, p_product_ids);
  if p_metric not in ('impressions', 'clicks', 'carts', 'orders') then raise exception 'Entry points metric is invalid'; end if;
  if p_limit is null or p_limit < 1 or p_limit > 200 then raise exception 'Entry points matrix limit must be between 1 and 200'; end if;
  return query
  with current_batches as (select * from app.v5_current_entry_point_batches()),
  base as (
    select row_data.*
    from analytics.entry_point_versions row_data
    join current_batches batch on batch.batch_id = row_data.batch_id and batch.cabinet_id = row_data.cabinet_id
    join core.products product on product.id = row_data.product_id and product.cabinet_id = row_data.cabinet_id
    left join lateral (
      select membership.group_id from core.group_membership_versions membership
      where membership.product_id = row_data.product_id and membership.effective_date <= row_data.date
      order by membership.effective_date desc, membership.id desc limit 1
    ) membership on true
    where row_data.date between p_start and p_end
      and (p_cabinet_ids is null or row_data.cabinet_id = any(p_cabinet_ids))
      and (p_product_ids is null or row_data.product_id = any(p_product_ids))
      and (p_category_ids is null or product.category_id = any(p_category_ids))
      and (p_brand_ids is null or product.brand_id = any(p_brand_ids))
      and (p_group_ids is null or membership.group_id = any(p_group_ids))
      and (nullif(btrim(p_search), '') is null or product.name ilike '%' || btrim(p_search) || '%'
        or product.seller_sku ilike '%' || btrim(p_search) || '%' or product.wb_sku ilike '%' || btrim(p_search) || '%')
      and (nullif(btrim(p_section), '') is null or row_data.section = p_section)
      and (nullif(btrim(p_entry_point), '') is null or row_data.entry_point = p_entry_point)
  ), ranked_points as (
    select base.section, base.entry_point
    from base group by base.section, base.entry_point
    order by case p_metric when 'impressions' then sum(base.impressions) when 'clicks' then sum(base.clicks)
      when 'carts' then sum(base.carts) else sum(base.orders) end desc,
      base.section, base.entry_point
    limit p_limit
  )
  select base.section, base.entry_point, base.date,
    sum(base.impressions)::bigint, sum(base.clicks)::bigint,
    sum(base.carts)::bigint, sum(base.orders)::bigint
  from base join ranked_points point on point.section = base.section and point.entry_point = base.entry_point
  group by base.section, base.entry_point, base.date
  order by base.section, base.entry_point, base.date;
end
$$;

revoke all on function public.v5_entry_points_matrix(date, date, text, uuid[], uuid[], uuid[], uuid[], uuid[], text, text, text, integer) from public, anon;
grant execute on function public.v5_entry_points_matrix(date, date, text, uuid[], uuid[], uuid[], uuid[], uuid[], text, text, text, integer) to authenticated;

create or replace function public.v5_entry_points_product_leaders(
  p_start date,
  p_end date,
  p_section_query text,
  p_metric text default 'orders',
  p_cabinet_ids uuid[] default null,
  p_category_ids uuid[] default null,
  p_group_ids uuid[] default null,
  p_limit integer default 5
)
returns table (
  product_id uuid,
  cabinet_id uuid,
  seller_sku text,
  wb_sku text,
  product_name text,
  section text,
  impressions bigint,
  clicks bigint,
  carts bigint,
  orders bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.v5_assert_entry_points_read(p_start, p_end, p_cabinet_ids, null);
  if p_metric not in ('impressions', 'clicks', 'carts', 'orders') then raise exception 'Entry points metric is invalid'; end if;
  if nullif(btrim(p_section_query), '') is null or length(p_section_query) > 100 then raise exception 'Entry points section query is required'; end if;
  if p_limit is null or p_limit < 1 or p_limit > 100 then raise exception 'Entry points product limit must be between 1 and 100'; end if;
  return query
  with current_batches as (select * from app.v5_current_entry_point_batches()),
  base as (
    select row_data.*
    from analytics.entry_point_versions row_data
    join current_batches batch on batch.batch_id = row_data.batch_id and batch.cabinet_id = row_data.cabinet_id
    join core.products product on product.id = row_data.product_id and product.cabinet_id = row_data.cabinet_id
    left join lateral (
      select membership.group_id from core.group_membership_versions membership
      where membership.product_id = row_data.product_id and membership.effective_date <= row_data.date
      order by membership.effective_date desc, membership.id desc limit 1
    ) membership on true
    where row_data.date between p_start and p_end
      and row_data.section ilike '%' || btrim(p_section_query) || '%'
      and (p_cabinet_ids is null or row_data.cabinet_id = any(p_cabinet_ids))
      and (p_category_ids is null or product.category_id = any(p_category_ids))
      and (p_group_ids is null or membership.group_id = any(p_group_ids))
  )
  select product.id, product.cabinet_id, product.seller_sku, product.wb_sku, product.name,
    min(base.section), sum(base.impressions)::bigint, sum(base.clicks)::bigint,
    sum(base.carts)::bigint, sum(base.orders)::bigint
  from base join core.products product on product.id = base.product_id and product.cabinet_id = base.cabinet_id
  group by product.id, product.cabinet_id, product.seller_sku, product.wb_sku, product.name
  order by case p_metric when 'impressions' then sum(base.impressions) when 'clicks' then sum(base.clicks)
    when 'carts' then sum(base.carts) else sum(base.orders) end desc,
    product.id
  limit p_limit;
end
$$;

revoke all on function public.v5_entry_points_product_leaders(date, date, text, text, uuid[], uuid[], uuid[], integer) from public, anon;
grant execute on function public.v5_entry_points_product_leaders(date, date, text, text, uuid[], uuid[], uuid[], integer) to authenticated;

create or replace function public.v5_health()
returns jsonb language sql stable security invoker set search_path = ''
as $$ select jsonb_build_object('environment', 'analytics-v5', 'schema_version', '20260913020000', 'status', 'ok') $$;

revoke all on function public.v5_health() from public;
grant execute on function public.v5_health() to anon, authenticated;

comment on table analytics.entry_point_versions is 'Versioned entry-point traffic facts at date + product + section + entry point grain.';
comment on function public.v5_entry_points_summary(date, date, uuid[], uuid[], uuid[], uuid[], uuid[], text, text, text) is 'Returns traffic totals only. Financial attribution stays unavailable until V5 funnel and profitability sources are migrated.';

commit;
