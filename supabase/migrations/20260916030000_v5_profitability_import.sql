-- Versioned profitability facts and an atomic, cabinet-scoped import lifecycle.

begin;

create table analytics.profitability_metric_versions (
  version_order bigint generated always as identity unique,
  batch_id uuid not null references ingest.import_batches(id) on delete restrict,
  date date not null,
  source_product_id text not null,
  product_id uuid not null,
  cabinet_id uuid not null,
  quantity numeric(20, 4),
  revenue numeric(20, 2) not null,
  cost numeric(20, 2) not null,
  agent_fee numeric(20, 2) not null,
  logistics_cost numeric(20, 2) not null,
  marketing_cost numeric(20, 2) not null,
  storage_cost numeric(20, 2) not null,
  reported_gross_profit numeric(20, 2),
  reported_gross_margin numeric(20, 6),
  gross_profit numeric(20, 2) generated always as (
    revenue - cost - agent_fee - logistics_cost - marketing_cost - storage_cost
  ) stored,
  gross_margin numeric(20, 6) generated always as (
    case when revenue = 0 then null else
      (revenue - cost - agent_fee - logistics_cost - marketing_cost - storage_cost) / revenue * 100
    end
  ) stored,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (batch_id, date, product_id),
  foreign key (product_id, cabinet_id) references core.products(id, cabinet_id) on delete restrict,
  constraint profitability_source_product_present check (btrim(source_product_id) <> '' and length(source_product_id) <= 500),
  constraint profitability_quantity_nonnegative check (quantity is null or quantity >= 0)
);

create index profitability_versions_cabinet_date_idx
on analytics.profitability_metric_versions (cabinet_id, date, version_order desc);

create index profitability_versions_product_date_idx
on analytics.profitability_metric_versions (product_id, date, version_order desc);

alter table analytics.profitability_metric_versions enable row level security;

create policy profitability_metric_versions_read_allowed
on analytics.profitability_metric_versions for select to authenticated
using (app.can_access_cabinet(cabinet_id) and app.can_read_batch(batch_id));

revoke all on analytics.profitability_metric_versions from public, anon, authenticated;

create or replace function public.v5_profitability_create_batch(
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
    raise exception 'Profitability import supports only .xlsx files';
  end if;
  if p_size_bytes is null or p_size_bytes <= 0 or p_size_bytes > 26214400 then
    raise exception 'Profitability source file must be between 1 byte and 25 MiB';
  end if;
  if p_file_sha256 is null or p_file_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'A lowercase SHA-256 file hash is required'; end if;

  select batch.id, batch.status, file.object_path
  into v_existing_id, v_existing_status, v_existing_path
  from ingest.import_batches batch
  join ingest.import_files file on file.batch_id = batch.id
  where batch.source_code = 'profitability' and batch.cabinet_id = p_cabinet_id and batch.file_sha256 = p_file_sha256
  limit 1;
  if v_existing_id is not null then
    return jsonb_build_object('batch_id', v_existing_id, 'object_path', v_existing_path, 'status', v_existing_status, 'duplicate', true);
  end if;

  v_object_path := v_user_id::text || '/' || v_batch_id::text || '/source.xlsx';
  insert into ingest.import_batches (
    id, source_code, cabinet_id, created_by, status, idempotency_key, file_sha256, source_schema_version
  ) values (
    v_batch_id, 'profitability', p_cabinet_id, v_user_id, 'created',
    'profitability:' || p_cabinet_id::text || ':' || p_file_sha256, p_file_sha256, 1
  ) on conflict do nothing;
  if not found then
    select batch.id, batch.status, file.object_path
    into strict v_existing_id, v_existing_status, v_existing_path
    from ingest.import_batches batch
    join ingest.import_files file on file.batch_id = batch.id
    where batch.source_code = 'profitability' and batch.cabinet_id = p_cabinet_id and batch.file_sha256 = p_file_sha256
    limit 1;
    return jsonb_build_object('batch_id', v_existing_id, 'object_path', v_existing_path, 'status', v_existing_status, 'duplicate', true);
  end if;

  insert into ingest.import_files (batch_id, object_path, original_filename, content_type, size_bytes, file_sha256)
  values (v_batch_id, v_object_path, p_original_filename, nullif(btrim(p_content_type), ''), p_size_bytes, p_file_sha256);
  insert into ingest.import_events (batch_id, status, message, details, created_by)
  values (v_batch_id, 'created', 'Profitability import batch created', '{}'::jsonb, v_user_id);
  return jsonb_build_object('batch_id', v_batch_id, 'object_path', v_object_path, 'status', 'created', 'duplicate', false);
end
$$;

revoke all on function public.v5_profitability_create_batch(uuid, text, text, bigint, text) from public, anon;
grant execute on function public.v5_profitability_create_batch(uuid, text, text, bigint, text) to authenticated;

create or replace function public.v5_profitability_reset_staging(p_batch_id uuid)
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
  where batch.id = p_batch_id and batch.source_code = 'profitability' for update;
  if not found then raise exception 'Profitability import batch % does not exist', p_batch_id; end if;
  if v_batch.created_by <> v_user_id and not app.is_admin() then raise exception 'The profitability batch belongs to another user'; end if;
  if not app.can_access_cabinet(v_batch.cabinet_id) then raise exception 'The profitability batch cabinet is not accessible'; end if;
  if v_batch.status not in ('created', 'uploaded', 'validating', 'failed') then raise exception 'Profitability staging cannot be reset while status is %', v_batch.status; end if;
  select file.object_path into strict v_object_path from ingest.import_files file where file.batch_id = p_batch_id;
  v_source_exists := exists (select 1 from storage.objects object where object.bucket_id = 'v5-import-sources' and object.name = v_object_path);
  v_next_status := case when v_source_exists then 'uploaded'::ingest.batch_status else 'created'::ingest.batch_status end;
  delete from ingest.import_errors where batch_id = p_batch_id;
  delete from ingest.import_rows where batch_id = p_batch_id;
  get diagnostics v_cleared_rows = row_count;
  update ingest.import_batches set status = v_next_status, period_start = null, period_end = null,
    input_rows = 0, accepted_rows = 0, rejected_rows = 0, metadata = '{}'::jsonb, error_summary = null,
    uploaded_at = case when v_source_exists then coalesce(uploaded_at, timezone('utc', now())) else null end,
    validated_at = null, published_at = null, finished_at = null, attempt_count = attempt_count + 1
  where id = p_batch_id;
  insert into ingest.import_events (batch_id, status, message, details, created_by)
  values (p_batch_id, v_next_status, 'Profitability staging reset for retry', jsonb_build_object('cleared_rows', v_cleared_rows, 'source_file_retained', v_source_exists), v_user_id);
  return jsonb_build_object('batch_id', p_batch_id, 'status', v_next_status, 'cleared_rows', v_cleared_rows, 'source_file_retained', v_source_exists);
end
$$;

revoke all on function public.v5_profitability_reset_staging(uuid) from public, anon;
grant execute on function public.v5_profitability_reset_staging(uuid) to authenticated;

create or replace function public.v5_profitability_stage_rows(p_batch_id uuid, p_rows jsonb)
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
  where batch.id = p_batch_id and batch.source_code = 'profitability' for update;
  if not found then raise exception 'Profitability import batch % does not exist', p_batch_id; end if;
  if v_batch.created_by <> v_user_id and not app.is_admin() then raise exception 'The profitability batch belongs to another user'; end if;
  if not app.can_access_cabinet(v_batch.cabinet_id) then raise exception 'The profitability batch cabinet is not accessible'; end if;
  if v_batch.status not in ('created', 'uploaded', 'validating', 'failed') then raise exception 'Rows cannot be staged while profitability batch status is %', v_batch.status; end if;
  select file.object_path into strict v_object_path from ingest.import_files file where file.batch_id = p_batch_id;
  if not exists (select 1 from storage.objects object where object.bucket_id = 'v5-import-sources' and object.name = v_object_path) then
    raise exception 'The source file must be uploaded before staging rows';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 or jsonb_array_length(p_rows) > 500 then
    raise exception 'Each staging chunk must contain between 1 and 500 rows';
  end if;
  if exists (select 1 from jsonb_array_elements(p_rows) item where jsonb_typeof(item) <> 'object'
    or coalesce(item ->> 'row_number', '') !~ '^[1-9][0-9]{0,8}$' or jsonb_typeof(item -> 'payload') <> 'object') then
    raise exception 'Every staged row requires a positive row_number and object payload';
  end if;
  insert into ingest.import_rows (batch_id, sheet_name, row_number, row_hash, payload, accepted)
  select p_batch_id, 'profitability', (item ->> 'row_number')::integer,
    encode(extensions.digest((item -> 'payload')::text, 'sha256'), 'hex'), item -> 'payload', null
  from jsonb_array_elements(p_rows) item
  on conflict (batch_id, sheet_name, row_number) do update set row_hash = excluded.row_hash, payload = excluded.payload, accepted = null;
  select count(*)::integer into v_total_rows from ingest.import_rows row_data where row_data.batch_id = p_batch_id;
  if v_total_rows > 500000 then raise exception 'Profitability import is limited to 500000 staged rows'; end if;
  update ingest.import_batches set status = 'validating', input_rows = v_total_rows,
    uploaded_at = coalesce(uploaded_at, timezone('utc', now())), error_summary = null, finished_at = null
  where id = p_batch_id;
  insert into ingest.import_events (batch_id, status, message, details, created_by)
  values (p_batch_id, 'validating', 'Profitability rows staged', jsonb_build_object('staged_rows', v_total_rows), v_user_id);
  return jsonb_build_object('batch_id', p_batch_id, 'status', 'validating', 'staged_rows', v_total_rows);
end
$$;

revoke all on function public.v5_profitability_stage_rows(uuid, jsonb) from public, anon;
grant execute on function public.v5_profitability_stage_rows(uuid, jsonb) to authenticated;

create or replace function public.v5_profitability_publish_batch(p_batch_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '120s'
as $$
declare
  v_user_id uuid := auth.uid();
  v_batch ingest.import_batches%rowtype;
  v_object_path text;
  v_input_rows integer;
  v_error_count integer;
  v_rejected_rows integer;
  v_period_start date;
  v_period_end date;
  v_row record;
  v_product_id uuid;
  v_product core.products%rowtype;
  v_created_products integer;
  v_resolved_products integer;
begin
  if v_user_id is null or not app.can_import() then raise exception 'V5 importer access is required'; end if;
  select batch.* into v_batch from ingest.import_batches batch
  where batch.id = p_batch_id and batch.source_code = 'profitability' for update;
  if not found then raise exception 'Profitability import batch % does not exist', p_batch_id; end if;
  if v_batch.created_by <> v_user_id and not app.is_admin() then raise exception 'The profitability batch belongs to another user'; end if;
  if not app.can_access_cabinet(v_batch.cabinet_id) then raise exception 'The profitability batch cabinet is not accessible'; end if;
  if v_batch.status not in ('uploaded', 'validating', 'failed') then raise exception 'Profitability batch cannot be published while status is %', v_batch.status; end if;
  select file.object_path into strict v_object_path from ingest.import_files file where file.batch_id = p_batch_id;
  if not exists (select 1 from storage.objects object where object.bucket_id = 'v5-import-sources' and object.name = v_object_path) then
    raise exception 'The source file must be retained before profitability publication';
  end if;
  select count(*)::integer into v_input_rows from ingest.import_rows row_data where row_data.batch_id = p_batch_id;
  if v_input_rows = 0 then raise exception 'Profitability batch has no staged rows'; end if;
  delete from ingest.import_errors where batch_id = p_batch_id;

  insert into ingest.import_errors (batch_id, sheet_name, row_number, column_name, error_code, message, raw_value)
  select row_data.batch_id, row_data.sheet_name, row_data.row_number, 'date', 'invalid_date',
    'Дата должна иметь формат YYYY-MM-DD и существовать', row_data.payload ->> 'date'
  from ingest.import_rows row_data where row_data.batch_id = p_batch_id and not ingest.is_iso_date(row_data.payload ->> 'date');

  insert into ingest.import_errors (batch_id, sheet_name, row_number, error_code, message)
  select row_data.batch_id, row_data.sheet_name, row_data.row_number, 'missing_product_identity', 'Требуется артикул продавца или WB'
  from ingest.import_rows row_data where row_data.batch_id = p_batch_id
    and btrim(coalesce(row_data.payload ->> 'seller_sku', '')) = '' and btrim(coalesce(row_data.payload ->> 'wb_sku', '')) = '';

  insert into ingest.import_errors (batch_id, sheet_name, row_number, column_name, error_code, message, raw_value)
  select row_data.batch_id, row_data.sheet_name, row_data.row_number, field.column_name, 'invalid_amount',
    'Обязательное денежное значение должно быть числом допустимого диапазона', row_data.payload ->> field.column_name
  from ingest.import_rows row_data
  cross join lateral (values ('revenue'), ('cost'), ('agent_fee'), ('logistics_cost'), ('marketing_cost'), ('storage_cost')) field(column_name)
  where row_data.batch_id = p_batch_id and (
    not row_data.payload ? field.column_name
    or jsonb_typeof(row_data.payload -> field.column_name) <> 'number'
    or ingest.try_numeric(row_data.payload ->> field.column_name) is null
    or abs(ingest.try_numeric(row_data.payload ->> field.column_name)) > 999999999999999999.99
  );

  insert into ingest.import_errors (batch_id, sheet_name, row_number, column_name, error_code, message, raw_value)
  select row_data.batch_id, row_data.sheet_name, row_data.row_number, field.column_name, 'invalid_optional_number',
    'Необязательное значение должно быть числом допустимого диапазона', row_data.payload ->> field.column_name
  from ingest.import_rows row_data
  cross join lateral (values ('quantity'), ('reported_gross_profit'), ('reported_gross_margin')) field(column_name)
  where row_data.batch_id = p_batch_id and row_data.payload ? field.column_name and (
    jsonb_typeof(row_data.payload -> field.column_name) <> 'number'
    or ingest.try_numeric(row_data.payload ->> field.column_name) is null
    or abs(ingest.try_numeric(row_data.payload ->> field.column_name)) > 999999999999999999.99
    or (field.column_name = 'quantity' and ingest.try_numeric(row_data.payload ->> field.column_name) < 0)
  );

  update ingest.import_rows row_data set accepted = not exists (
    select 1 from ingest.import_errors error where error.batch_id = row_data.batch_id
      and error.sheet_name = row_data.sheet_name and error.row_number = row_data.row_number
  ) where row_data.batch_id = p_batch_id;
  select count(*)::integer, count(distinct (sheet_name, row_number)) filter (where row_number is not null)::integer
  into v_error_count, v_rejected_rows from ingest.import_errors where batch_id = p_batch_id;
  if v_error_count > 0 then
    update ingest.import_batches set status = 'failed', input_rows = v_input_rows,
      accepted_rows = v_input_rows - v_rejected_rows, rejected_rows = v_rejected_rows,
      error_summary = v_error_count || ' validation errors', finished_at = timezone('utc', now())
    where id = p_batch_id;
    insert into ingest.import_events (batch_id, status, message, details, created_by)
    values (p_batch_id, 'failed', 'Profitability batch validation failed', jsonb_build_object('error_count', v_error_count, 'rejected_rows', v_rejected_rows), v_user_id);
    return jsonb_build_object('batch_id', p_batch_id, 'status', 'failed', 'input_rows', v_input_rows,
      'accepted_rows', v_input_rows - v_rejected_rows, 'rejected_rows', v_rejected_rows, 'error_count', v_error_count);
  end if;

  for v_row in select row_data.sheet_name, row_data.row_number, row_data.payload from ingest.import_rows row_data
    where row_data.batch_id = p_batch_id and row_data.accepted order by row_data.sheet_name, row_data.row_number
  loop
    v_product_id := core.resolve_or_create_import_product(v_batch.cabinet_id, v_row.payload ->> 'seller_sku',
      v_row.payload ->> 'wb_sku', p_batch_id, (v_row.payload ->> 'date')::date);
    select product.* into strict v_product from core.products product where product.id = v_product_id;
    update ingest.import_rows row_data set payload = row_data.payload || jsonb_build_object(
      'source_seller_sku', v_row.payload ->> 'seller_sku', 'source_wb_sku', v_row.payload ->> 'wb_sku',
      'product_id', v_product_id, 'seller_sku', v_product.seller_sku, 'wb_sku', v_product.wb_sku
    ) where row_data.batch_id = p_batch_id and row_data.sheet_name = v_row.sheet_name and row_data.row_number = v_row.row_number;
  end loop;

  delete from analytics.profitability_metric_versions where batch_id = p_batch_id;
  insert into analytics.profitability_metric_versions (
    batch_id, date, source_product_id, product_id, cabinet_id, quantity,
    revenue, cost, agent_fee, logistics_cost, marketing_cost, storage_cost,
    reported_gross_profit, reported_gross_margin
  )
  select p_batch_id, (payload ->> 'date')::date,
    coalesce(nullif(btrim(payload ->> 'source_seller_sku'), ''), btrim(payload ->> 'source_wb_sku')),
    (payload ->> 'product_id')::uuid, v_batch.cabinet_id,
    (payload ->> 'quantity')::numeric,
    (payload ->> 'revenue')::numeric, (payload ->> 'cost')::numeric,
    (payload ->> 'agent_fee')::numeric, (payload ->> 'logistics_cost')::numeric,
    (payload ->> 'marketing_cost')::numeric, (payload ->> 'storage_cost')::numeric,
    (payload ->> 'reported_gross_profit')::numeric, (payload ->> 'reported_gross_margin')::numeric
  from ingest.import_rows where batch_id = p_batch_id and accepted;

  select min((payload ->> 'date')::date), max((payload ->> 'date')::date)
  into v_period_start, v_period_end from ingest.import_rows where batch_id = p_batch_id;
  select count(distinct (payload ->> 'product_id')::uuid)::integer into v_resolved_products
  from ingest.import_rows where batch_id = p_batch_id;
  select count(*)::integer into v_created_products from core.products product where product.source_batch_id = p_batch_id;
  update ingest.import_batches set status = 'published', period_start = v_period_start, period_end = v_period_end,
    input_rows = v_input_rows, accepted_rows = v_input_rows, rejected_rows = 0,
    metadata = metadata || jsonb_build_object('canonical_rows', v_input_rows,
      'products_created', v_created_products, 'products_resolved', v_resolved_products),
    error_summary = null, validated_at = timezone('utc', now()), published_at = timezone('utc', now()), finished_at = timezone('utc', now())
  where id = p_batch_id;
  insert into ingest.import_events (batch_id, status, message, details, created_by)
  values (p_batch_id, 'published', 'Profitability batch published', jsonb_build_object(
    'input_rows', v_input_rows, 'products_created', v_created_products, 'products_resolved', v_resolved_products,
    'period_start', v_period_start, 'period_end', v_period_end), v_user_id);
  return jsonb_build_object('batch_id', p_batch_id, 'status', 'published', 'input_rows', v_input_rows,
    'accepted_rows', v_input_rows, 'rejected_rows', 0, 'canonical_rows', v_input_rows,
    'products_created', v_created_products, 'products_resolved', v_resolved_products,
    'period_start', v_period_start, 'period_end', v_period_end);
end
$$;

revoke all on function public.v5_profitability_publish_batch(uuid) from public, anon;
grant execute on function public.v5_profitability_publish_batch(uuid) to authenticated;

create or replace function public.v5_profitability_rollback_batch(p_batch_id uuid, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_user_id uuid := auth.uid(); v_batch ingest.import_batches%rowtype; v_rows integer;
begin
  if v_user_id is null or not app.is_admin() then raise exception 'V5 administrator access is required'; end if;
  select batch.* into v_batch from ingest.import_batches batch
  where batch.id = p_batch_id and batch.source_code = 'profitability' for update;
  if not found then raise exception 'Profitability import batch % does not exist', p_batch_id; end if;
  if not app.can_access_cabinet(v_batch.cabinet_id) then raise exception 'The profitability batch cabinet is not accessible'; end if;
  if v_batch.status <> 'published' then raise exception 'Only a published profitability batch can be rolled back'; end if;
  delete from analytics.profitability_metric_versions where batch_id = p_batch_id;
  get diagnostics v_rows = row_count;
  update ingest.import_batches set status = 'cancelled', finished_at = timezone('utc', now()),
    error_summary = nullif(btrim(p_reason), '') where id = p_batch_id;
  insert into ingest.import_events (batch_id, status, message, details, created_by)
  values (p_batch_id, 'cancelled', 'Profitability batch rolled back', jsonb_build_object('version_rows', v_rows, 'reason', nullif(btrim(p_reason), '')), v_user_id);
  return jsonb_build_object('batch_id', p_batch_id, 'status', 'cancelled', 'version_rows', v_rows);
end
$$;

revoke all on function public.v5_profitability_rollback_batch(uuid, text) from public, anon;
grant execute on function public.v5_profitability_rollback_batch(uuid, text) to authenticated;

create or replace function app.v5_profitability_current(p_start date, p_end date)
returns table (
  date date, product_id uuid, cabinet_id uuid, quantity numeric,
  revenue numeric, cost numeric, agent_fee numeric, logistics_cost numeric,
  marketing_cost numeric, storage_cost numeric, gross_profit numeric, gross_margin numeric,
  reported_gross_profit numeric, reported_gross_margin numeric, batch_id uuid
)
language sql
stable
security invoker
set search_path = ''
as $$
  select distinct on (version.date, version.product_id)
    version.date, version.product_id, version.cabinet_id, version.quantity,
    version.revenue, version.cost, version.agent_fee, version.logistics_cost,
    version.marketing_cost, version.storage_cost, version.gross_profit, version.gross_margin,
    version.reported_gross_profit, version.reported_gross_margin, version.batch_id
  from analytics.profitability_metric_versions version
  join ingest.import_batches batch on batch.id = version.batch_id
  where batch.status = 'published' and version.date between p_start and p_end
    and app.can_access_cabinet(version.cabinet_id)
  order by version.date, version.product_id, version.version_order desc
$$;

revoke all on function app.v5_profitability_current(date, date) from public, anon, authenticated;

create or replace function public.v5_health()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object('environment', 'analytics-v5', 'schema_version', '20260916030000', 'status', 'ok')
$$;

revoke all on function public.v5_health() from public;
grant execute on function public.v5_health() to anon, authenticated;

commit;
