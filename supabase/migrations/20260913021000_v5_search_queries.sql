begin;

create table analytics.search_query_versions (
  batch_id uuid not null references ingest.import_batches(id) on delete restrict,
  date date not null,
  query text not null,
  category text not null,
  requests bigint not null,
  requests_previous bigint not null,
  avg_daily_requests numeric(20, 6) not null,
  avg_daily_requests_previous numeric(20, 6) not null,
  card_clicks bigint not null,
  card_clicks_previous bigint not null,
  carts bigint not null,
  carts_previous bigint not null,
  reported_cart_conversion numeric(20, 6) not null,
  reported_cart_conversion_previous numeric(20, 6) not null,
  orders bigint not null,
  orders_previous bigint not null,
  reported_order_conversion numeric(20, 6) not null,
  reported_order_conversion_previous numeric(20, 6) not null,
  ordered_subjects bigint not null,
  ordered_subjects_previous bigint not null,
  products bigint not null,
  products_previous bigint not null,
  version_order bigint generated always as identity,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (batch_id, date, query, category),
  constraint search_query_labels_present check (
    btrim(query) <> '' and length(query) <= 1000
    and btrim(category) <> '' and length(category) <= 1000
  ),
  constraint search_query_values_nonnegative check (
    requests >= 0 and requests_previous >= 0
    and avg_daily_requests >= 0 and avg_daily_requests_previous >= 0
    and card_clicks >= 0 and card_clicks_previous >= 0
    and carts >= 0 and carts_previous >= 0
    and reported_cart_conversion >= 0 and reported_cart_conversion_previous >= 0
    and orders >= 0 and orders_previous >= 0
    and reported_order_conversion >= 0 and reported_order_conversion_previous >= 0
    and ordered_subjects >= 0 and ordered_subjects_previous >= 0
    and products >= 0 and products_previous >= 0
  )
);

create index search_query_versions_current_idx
on analytics.search_query_versions (date, query, category, version_order desc);

create index search_query_versions_category_date_idx
on analytics.search_query_versions (category, date, batch_id);

alter table analytics.search_query_versions enable row level security;

create policy search_query_versions_read_allowed
on analytics.search_query_versions for select to authenticated
using (app.can_read_batch(batch_id));

create or replace view analytics.search_queries_current
with (security_invoker = true)
as
select selected.batch_id, selected.date, selected.query, selected.category,
  selected.requests, selected.requests_previous,
  selected.avg_daily_requests, selected.avg_daily_requests_previous,
  selected.card_clicks, selected.card_clicks_previous,
  selected.carts, selected.carts_previous,
  selected.reported_cart_conversion, selected.reported_cart_conversion_previous,
  selected.orders, selected.orders_previous,
  selected.reported_order_conversion, selected.reported_order_conversion_previous,
  selected.ordered_subjects, selected.ordered_subjects_previous,
  selected.products, selected.products_previous
from (
  select row_data.*,
    row_number() over (
      partition by row_data.date, row_data.query, row_data.category
      order by row_data.version_order desc
    ) as version_rank
  from analytics.search_query_versions row_data
  join ingest.import_batches batch on batch.id = row_data.batch_id
  where batch.source_code = 'search_queries' and batch.status = 'published'
) selected
where selected.version_rank = 1;

revoke all on analytics.search_query_versions from public, anon, authenticated;
revoke all on analytics.search_queries_current from public, anon, authenticated;

create or replace function public.v5_search_queries_create_batch(
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
  if p_original_filename is null or btrim(p_original_filename) = '' or lower(p_original_filename) not like '%.xlsx' then
    raise exception 'Search queries import supports only .xlsx files';
  end if;
  if p_size_bytes is null or p_size_bytes <= 0 or p_size_bytes > 26214400 then
    raise exception 'Search queries source file must be between 1 byte and 25 MiB';
  end if;
  if p_file_sha256 is null or p_file_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'A lowercase SHA-256 file hash is required'; end if;

  select batch.id, batch.status, file.object_path into v_existing_id, v_existing_status, v_existing_path
  from ingest.import_batches batch join ingest.import_files file on file.batch_id = batch.id
  where batch.source_code = 'search_queries' and batch.cabinet_id is null and batch.file_sha256 = p_file_sha256 limit 1;
  if v_existing_id is not null then
    return jsonb_build_object('batch_id', v_existing_id, 'object_path', v_existing_path, 'status', v_existing_status, 'duplicate', true);
  end if;

  v_object_path := v_user_id::text || '/' || v_batch_id::text || '/source.xlsx';
  insert into ingest.import_batches (id, source_code, created_by, status, idempotency_key, file_sha256, source_schema_version)
  values (v_batch_id, 'search_queries', v_user_id, 'created', 'search-queries:' || p_file_sha256, p_file_sha256, 1)
  on conflict do nothing;
  if not found then
    select batch.id, batch.status, file.object_path into strict v_existing_id, v_existing_status, v_existing_path
    from ingest.import_batches batch join ingest.import_files file on file.batch_id = batch.id
    where batch.source_code = 'search_queries' and batch.cabinet_id is null and batch.file_sha256 = p_file_sha256 limit 1;
    return jsonb_build_object('batch_id', v_existing_id, 'object_path', v_existing_path, 'status', v_existing_status, 'duplicate', true);
  end if;
  insert into ingest.import_files (batch_id, object_path, original_filename, content_type, size_bytes, file_sha256)
  values (v_batch_id, v_object_path, p_original_filename, nullif(btrim(p_content_type), ''), p_size_bytes, p_file_sha256);
  insert into ingest.import_events (batch_id, status, message, created_by)
  values (v_batch_id, 'created', 'Search queries import batch created', v_user_id);
  return jsonb_build_object('batch_id', v_batch_id, 'object_path', v_object_path, 'status', 'created', 'duplicate', false);
end
$$;

revoke all on function public.v5_search_queries_create_batch(text, text, bigint, text) from public, anon;
grant execute on function public.v5_search_queries_create_batch(text, text, bigint, text) to authenticated;

create or replace function public.v5_search_queries_reset_staging(p_batch_id uuid)
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
  where batch.id = p_batch_id and batch.source_code = 'search_queries' for update;
  if not found then raise exception 'Search queries import batch % does not exist', p_batch_id; end if;
  if v_batch.created_by <> v_user_id and not app.is_admin() then raise exception 'The search queries batch belongs to another user'; end if;
  if v_batch.status not in ('created', 'uploaded', 'validating', 'failed') then raise exception 'Search queries staging cannot be reset while batch status is %', v_batch.status; end if;
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
  values (p_batch_id, v_next_status, 'Search queries staging reset for retry', jsonb_build_object('cleared_rows', v_cleared_rows, 'source_file_retained', v_source_exists), v_user_id);
  return jsonb_build_object('batch_id', p_batch_id, 'status', v_next_status, 'cleared_rows', v_cleared_rows, 'source_file_retained', v_source_exists);
end
$$;

revoke all on function public.v5_search_queries_reset_staging(uuid) from public, anon;
grant execute on function public.v5_search_queries_reset_staging(uuid) to authenticated;

create or replace function public.v5_search_queries_stage_rows(p_batch_id uuid, p_rows jsonb)
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
  where batch.id = p_batch_id and batch.source_code = 'search_queries' for update;
  if not found then raise exception 'Search queries import batch % does not exist', p_batch_id; end if;
  if v_batch.created_by <> v_user_id and not app.is_admin() then raise exception 'The search queries batch belongs to another user'; end if;
  if v_batch.status not in ('created', 'uploaded', 'validating', 'failed') then raise exception 'Rows cannot be staged while search queries batch status is %', v_batch.status; end if;
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
  select p_batch_id, 'search_queries', (item ->> 'row_number')::integer,
    encode(extensions.digest((item -> 'payload')::text, 'sha256'), 'hex'), item -> 'payload', null
  from jsonb_array_elements(p_rows) item
  on conflict (batch_id, sheet_name, row_number) do update
  set row_hash = excluded.row_hash, payload = excluded.payload, accepted = null;
  select count(*)::integer into v_total_rows from ingest.import_rows row_data where row_data.batch_id = p_batch_id;
  if v_total_rows > 500000 then raise exception 'Search queries import is limited to 500000 staged rows'; end if;
  update ingest.import_batches set status = 'validating', input_rows = v_total_rows,
    uploaded_at = coalesce(uploaded_at, timezone('utc', now())), error_summary = null, finished_at = null
  where id = p_batch_id;
  insert into ingest.import_events (batch_id, status, message, details, created_by)
  values (p_batch_id, 'validating', 'Search queries rows staged', jsonb_build_object('staged_rows', v_total_rows), v_user_id);
  return jsonb_build_object('batch_id', p_batch_id, 'status', 'validating', 'staged_rows', v_total_rows);
end
$$;

revoke all on function public.v5_search_queries_stage_rows(uuid, jsonb) from public, anon;
grant execute on function public.v5_search_queries_stage_rows(uuid, jsonb) to authenticated;

create or replace function public.v5_search_queries_publish_batch(p_batch_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_batch ingest.import_batches%rowtype;
  v_input_rows integer;
  v_rejected_rows integer;
  v_error_count integer;
  v_canonical_rows integer;
  v_period_start date;
  v_period_end date;
begin
  if v_user_id is null or not app.can_import() then raise exception 'V5 importer access is required'; end if;
  select batch.* into v_batch from ingest.import_batches batch
  where batch.id = p_batch_id and batch.source_code = 'search_queries' for update;
  if not found then raise exception 'Search queries import batch % does not exist', p_batch_id; end if;
  if v_batch.created_by <> v_user_id and not app.is_admin() then raise exception 'The search queries batch belongs to another user'; end if;
  if v_batch.status not in ('validating', 'failed') then raise exception 'Search queries batch cannot be published while status is %', v_batch.status; end if;
  select count(*)::integer into v_input_rows from ingest.import_rows row_data where row_data.batch_id = p_batch_id;
  if v_input_rows = 0 then raise exception 'Search queries batch has no staged rows'; end if;
  delete from ingest.import_errors where batch_id = p_batch_id;

  insert into ingest.import_errors (batch_id, sheet_name, row_number, column_name, error_code, message, raw_value)
  select row_data.batch_id, row_data.sheet_name, row_data.row_number, 'date', 'invalid_date',
    'Дата должна быть календарной датой в формате YYYY-MM-DD', row_data.payload ->> 'date'
  from ingest.import_rows row_data
  where row_data.batch_id = p_batch_id and not ingest.is_iso_date(row_data.payload ->> 'date');

  insert into ingest.import_errors (batch_id, sheet_name, row_number, column_name, error_code, message, raw_value)
  select row_data.batch_id, row_data.sheet_name, row_data.row_number, field.column_name, 'invalid_label',
    'Запрос и предмет обязательны, длина не более 1000 символов', row_data.payload ->> field.column_name
  from ingest.import_rows row_data cross join (values ('query'), ('category')) field(column_name)
  where row_data.batch_id = p_batch_id and (btrim(coalesce(row_data.payload ->> field.column_name, '')) = '' or length(row_data.payload ->> field.column_name) > 1000);

  insert into ingest.import_errors (batch_id, sheet_name, row_number, column_name, error_code, message, raw_value)
  select row_data.batch_id, row_data.sheet_name, row_data.row_number, field.column_name, 'invalid_integer',
    'Значение должно быть целым неотрицательным числом', row_data.payload ->> field.column_name
  from ingest.import_rows row_data cross join (values
    ('requests'), ('requests_previous'), ('card_clicks'), ('card_clicks_previous'),
    ('carts'), ('carts_previous'), ('orders'), ('orders_previous'),
    ('ordered_subjects'), ('ordered_subjects_previous'), ('products'), ('products_previous')
  ) field(column_name)
  where row_data.batch_id = p_batch_id and (
    jsonb_typeof(row_data.payload -> field.column_name) <> 'number'
    or ingest.try_numeric(row_data.payload ->> field.column_name) is null
    or ingest.try_numeric(row_data.payload ->> field.column_name) < 0
    or trunc(ingest.try_numeric(row_data.payload ->> field.column_name)) <> ingest.try_numeric(row_data.payload ->> field.column_name)
    or ingest.try_numeric(row_data.payload ->> field.column_name) > 9223372036854775807
  );

  insert into ingest.import_errors (batch_id, sheet_name, row_number, column_name, error_code, message, raw_value)
  select row_data.batch_id, row_data.sheet_name, row_data.row_number, field.column_name, 'invalid_number',
    'Значение должно быть неотрицательным числом', row_data.payload ->> field.column_name
  from ingest.import_rows row_data cross join (values
    ('avg_daily_requests'), ('avg_daily_requests_previous'), ('cart_conversion'), ('cart_conversion_previous'),
    ('order_conversion'), ('order_conversion_previous')
  ) field(column_name)
  where row_data.batch_id = p_batch_id and (
    jsonb_typeof(row_data.payload -> field.column_name) <> 'number'
    or ingest.try_numeric(row_data.payload ->> field.column_name) is null
    or ingest.try_numeric(row_data.payload ->> field.column_name) < 0
    or ingest.try_numeric(row_data.payload ->> field.column_name) >= 1000000000000000000
  );

  update ingest.import_rows row_data set accepted = not exists (
    select 1 from ingest.import_errors error where error.batch_id = row_data.batch_id
      and error.sheet_name = row_data.sheet_name and error.row_number = row_data.row_number
  ) where row_data.batch_id = p_batch_id;
  select count(*)::integer, count(distinct (sheet_name, row_number))::integer into v_error_count, v_rejected_rows
  from ingest.import_errors where batch_id = p_batch_id;
  if v_error_count > 0 then
    update ingest.import_batches set status = 'failed', input_rows = v_input_rows,
      accepted_rows = v_input_rows - v_rejected_rows, rejected_rows = v_rejected_rows,
      error_summary = v_error_count || ' validation errors', finished_at = timezone('utc', now())
    where id = p_batch_id;
    insert into ingest.import_events (batch_id, status, message, details, created_by)
    values (p_batch_id, 'failed', 'Search queries batch validation failed', jsonb_build_object('error_count', v_error_count, 'rejected_rows', v_rejected_rows), v_user_id);
    return jsonb_build_object('batch_id', p_batch_id, 'status', 'failed', 'input_rows', v_input_rows,
      'accepted_rows', v_input_rows - v_rejected_rows, 'rejected_rows', v_rejected_rows, 'error_count', v_error_count);
  end if;

  insert into analytics.search_query_versions (
    batch_id, date, query, category, requests, requests_previous, avg_daily_requests, avg_daily_requests_previous,
    card_clicks, card_clicks_previous, carts, carts_previous, reported_cart_conversion, reported_cart_conversion_previous,
    orders, orders_previous, reported_order_conversion, reported_order_conversion_previous,
    ordered_subjects, ordered_subjects_previous, products, products_previous
  )
  select p_batch_id, canonical.date_value, canonical.query_value, canonical.category_value,
    (canonical.payload ->> 'requests')::bigint, (canonical.payload ->> 'requests_previous')::bigint,
    (canonical.payload ->> 'avg_daily_requests')::numeric, (canonical.payload ->> 'avg_daily_requests_previous')::numeric,
    (canonical.payload ->> 'card_clicks')::bigint, (canonical.payload ->> 'card_clicks_previous')::bigint,
    (canonical.payload ->> 'carts')::bigint, (canonical.payload ->> 'carts_previous')::bigint,
    (canonical.payload ->> 'cart_conversion')::numeric, (canonical.payload ->> 'cart_conversion_previous')::numeric,
    (canonical.payload ->> 'orders')::bigint, (canonical.payload ->> 'orders_previous')::bigint,
    (canonical.payload ->> 'order_conversion')::numeric, (canonical.payload ->> 'order_conversion_previous')::numeric,
    (canonical.payload ->> 'ordered_subjects')::bigint, (canonical.payload ->> 'ordered_subjects_previous')::bigint,
    (canonical.payload ->> 'products')::bigint, (canonical.payload ->> 'products_previous')::bigint
  from (
    select distinct on ((payload ->> 'date')::date, lower(btrim(payload ->> 'query')), btrim(payload ->> 'category'))
      payload, (payload ->> 'date')::date as date_value,
      lower(btrim(payload ->> 'query')) as query_value, btrim(payload ->> 'category') as category_value
    from ingest.import_rows where batch_id = p_batch_id and accepted
    order by (payload ->> 'date')::date, lower(btrim(payload ->> 'query')), btrim(payload ->> 'category'), row_number desc
  ) canonical
  on conflict (batch_id, date, query, category) do update set
    requests = excluded.requests, requests_previous = excluded.requests_previous,
    avg_daily_requests = excluded.avg_daily_requests, avg_daily_requests_previous = excluded.avg_daily_requests_previous,
    card_clicks = excluded.card_clicks, card_clicks_previous = excluded.card_clicks_previous,
    carts = excluded.carts, carts_previous = excluded.carts_previous,
    reported_cart_conversion = excluded.reported_cart_conversion, reported_cart_conversion_previous = excluded.reported_cart_conversion_previous,
    orders = excluded.orders, orders_previous = excluded.orders_previous,
    reported_order_conversion = excluded.reported_order_conversion, reported_order_conversion_previous = excluded.reported_order_conversion_previous,
    ordered_subjects = excluded.ordered_subjects, ordered_subjects_previous = excluded.ordered_subjects_previous,
    products = excluded.products, products_previous = excluded.products_previous;

  select count(*)::integer, min(date), max(date) into v_canonical_rows, v_period_start, v_period_end
  from analytics.search_query_versions where batch_id = p_batch_id;
  update ingest.import_batches set status = 'published', period_start = v_period_start, period_end = v_period_end,
    input_rows = v_input_rows, accepted_rows = v_input_rows, rejected_rows = 0,
    metadata = jsonb_build_object('canonical_rows', v_canonical_rows, 'replaced_duplicate_rows', v_input_rows - v_canonical_rows),
    error_summary = null, validated_at = timezone('utc', now()), published_at = timezone('utc', now()), finished_at = timezone('utc', now())
  where id = p_batch_id;
  insert into ingest.import_events (batch_id, status, message, details, created_by)
  values (p_batch_id, 'published', 'Search queries batch published',
    jsonb_build_object('rows', v_input_rows, 'canonical_rows', v_canonical_rows, 'period_start', v_period_start, 'period_end', v_period_end), v_user_id);
  return jsonb_build_object('batch_id', p_batch_id, 'status', 'published', 'input_rows', v_input_rows,
    'accepted_rows', v_input_rows, 'rejected_rows', 0, 'error_count', 0, 'canonical_rows', v_canonical_rows,
    'replaced_duplicate_rows', v_input_rows - v_canonical_rows, 'period_start', v_period_start, 'period_end', v_period_end);
end
$$;

revoke all on function public.v5_search_queries_publish_batch(uuid) from public, anon;
grant execute on function public.v5_search_queries_publish_batch(uuid) to authenticated;

create or replace function public.v5_search_queries_rollback_batch(p_batch_id uuid, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_user_id uuid := auth.uid(); v_affected_rows integer;
begin
  if v_user_id is null or not app.is_admin() then raise exception 'V5 administrator access is required'; end if;
  perform 1 from ingest.import_batches batch where batch.id = p_batch_id and batch.source_code = 'search_queries' and batch.status = 'published' for update;
  if not found then raise exception 'Published search queries batch % does not exist', p_batch_id; end if;
  select count(*)::integer into v_affected_rows from analytics.search_query_versions where batch_id = p_batch_id;
  update ingest.import_batches set status = 'cancelled', error_summary = nullif(btrim(p_reason), ''), finished_at = timezone('utc', now()) where id = p_batch_id;
  insert into ingest.import_events (batch_id, status, message, details, created_by)
  values (p_batch_id, 'cancelled', 'Published search queries batch rolled back', jsonb_build_object('reason', nullif(btrim(p_reason), ''), 'affected_rows', v_affected_rows), v_user_id);
  return jsonb_build_object('batch_id', p_batch_id, 'status', 'cancelled', 'affected_rows', v_affected_rows);
end
$$;

revoke all on function public.v5_search_queries_rollback_batch(uuid, text) from public, anon;
grant execute on function public.v5_search_queries_rollback_batch(uuid, text) to authenticated;

create or replace function public.v5_search_queries_filter_options(p_limit integer default 500)
returns table (min_date date, max_date date, category_count bigint, query_count bigint, categories jsonb)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not app.can_read() then raise exception 'V5 read access is required'; end if;
  if p_limit < 1 or p_limit > 500 then raise exception 'Search query filter limit must be between 1 and 500'; end if;
  return query
  select min(data.date), max(data.date), count(distinct data.category), count(distinct data.query),
    coalesce((select jsonb_agg(item.category order by item.category) from (
      select distinct source.category from analytics.search_queries_current source order by source.category limit p_limit
    ) item), '[]'::jsonb)
  from analytics.search_queries_current data;
end
$$;

revoke all on function public.v5_search_queries_filter_options(integer) from public, anon;
grant execute on function public.v5_search_queries_filter_options(integer) to authenticated;

create or replace function public.v5_search_queries_summary(p_start date, p_end date, p_category text default null, p_search text default null)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_result jsonb; v_days integer; v_own_orders bigint;
begin
  if not app.can_read() then raise exception 'V5 read access is required'; end if;
  if p_start is null or p_end is null or p_start > p_end or p_end - p_start > 1826 then raise exception 'Invalid search query period'; end if;
  if length(coalesce(p_search, '')) > 200 then raise exception 'Search query text filter is too long'; end if;
  v_days := p_end - p_start + 1;
  with filtered as (
    select data.* from analytics.search_queries_current data
    where data.date between p_start and p_end
      and (p_category is null or data.category = p_category)
      and (nullif(btrim(p_search), '') is null or data.query like '%' || lower(btrim(p_search)) || '%')
  ), totals as (
    select coalesce(sum(requests), 0)::bigint requests, coalesce(sum(requests_previous), 0)::bigint requests_previous,
      coalesce(sum(card_clicks), 0)::bigint card_clicks, coalesce(sum(card_clicks_previous), 0)::bigint card_clicks_previous,
      coalesce(sum(carts), 0)::bigint carts, coalesce(sum(carts_previous), 0)::bigint carts_previous,
      coalesce(sum(orders), 0)::bigint orders, coalesce(sum(orders_previous), 0)::bigint orders_previous,
      count(distinct (query, category))::bigint query_count
    from filtered
  ), money as (
    select coalesce(sum(filtered.orders * coalesce(nullif(market.reported_market_avg_check, 0), market.market_ordered_amount / nullif(market.market_orders, 0))), 0)::numeric order_amount,
      coalesce(sum(filtered.orders_previous * coalesce(nullif(previous_market.reported_market_avg_check, 0), previous_market.market_ordered_amount / nullif(previous_market.market_orders, 0))), 0)::numeric order_amount_previous
    from filtered
    left join analytics.market_daily_current market on market.date = filtered.date
    left join analytics.market_daily_current previous_market on previous_market.date = filtered.date - v_days
  )
  select jsonb_build_object(
    'requests', totals.requests, 'requests_previous', totals.requests_previous,
    'card_clicks', totals.card_clicks, 'card_clicks_previous', totals.card_clicks_previous,
    'carts', totals.carts, 'carts_previous', totals.carts_previous,
    'orders', totals.orders, 'orders_previous', totals.orders_previous,
    'query_count', totals.query_count, 'order_amount', money.order_amount, 'order_amount_previous', money.order_amount_previous
  ) into v_result from totals cross join money;

  if nullif(btrim(p_search), '') is null then
    with current_entry as (
      select selected.* from (
        select row_data.*, row_number() over (partition by row_data.cabinet_id, row_data.date, row_data.product_id, row_data.section, row_data.entry_point order by row_data.created_at desc, row_data.batch_id desc) version_rank
        from analytics.entry_point_versions row_data join ingest.import_batches batch on batch.id = row_data.batch_id
        where batch.status = 'published' and batch.source_code = 'entry_points' and app.can_access_cabinet(row_data.cabinet_id)
      ) selected where selected.version_rank = 1
    )
    select coalesce(sum(entry.orders), 0)::bigint into v_own_orders
    from current_entry entry
    join core.products product on product.id = entry.product_id and product.cabinet_id = entry.cabinet_id
    left join core.categories category on category.id = product.category_id
    where entry.date between p_start and p_end and lower(entry.section) like '%поиск%'
      and (p_category is null or lower(category.name) = lower(p_category));
    v_result := v_result || jsonb_build_object('own_orders', v_own_orders,
      'own_orders_share', case when (v_result ->> 'orders')::numeric > 0 then v_own_orders * 100.0 / (v_result ->> 'orders')::numeric else null end);
  else
    v_result := v_result || jsonb_build_object('own_orders', null, 'own_orders_share', null);
  end if;
  return v_result;
end
$$;

revoke all on function public.v5_search_queries_summary(date, date, text, text) from public, anon;
grant execute on function public.v5_search_queries_summary(date, date, text, text) to authenticated;

create or replace function public.v5_search_queries_series(
  p_start date, p_end date, p_category text default null, p_search text default null, p_query text default null
)
returns table (period_date date, requests bigint, requests_previous bigint, card_clicks bigint, card_clicks_previous bigint,
  carts bigint, carts_previous bigint, orders bigint, orders_previous bigint, products bigint, products_previous bigint,
  order_amount numeric, order_amount_previous numeric)
language plpgsql stable security definer set search_path = ''
as $$
declare v_days integer;
begin
  if not app.can_read() then raise exception 'V5 read access is required'; end if;
  if p_start is null or p_end is null or p_start > p_end or p_end - p_start > 1826 then raise exception 'Invalid search query period'; end if;
  v_days := p_end - p_start + 1;
  return query
  select data.date,
    sum(data.requests)::bigint, sum(data.requests_previous)::bigint,
    sum(data.card_clicks)::bigint, sum(data.card_clicks_previous)::bigint,
    sum(data.carts)::bigint, sum(data.carts_previous)::bigint,
    sum(data.orders)::bigint, sum(data.orders_previous)::bigint,
    max(data.products)::bigint, max(data.products_previous)::bigint,
    coalesce(sum(data.orders * coalesce(nullif(market.reported_market_avg_check, 0), market.market_ordered_amount / nullif(market.market_orders, 0))), 0)::numeric,
    coalesce(sum(data.orders_previous * coalesce(nullif(previous_market.reported_market_avg_check, 0), previous_market.market_ordered_amount / nullif(previous_market.market_orders, 0))), 0)::numeric
  from analytics.search_queries_current data
  left join analytics.market_daily_current market on market.date = data.date
  left join analytics.market_daily_current previous_market on previous_market.date = data.date - v_days
  where data.date between p_start and p_end
    and (p_category is null or data.category = p_category)
    and (nullif(btrim(p_search), '') is null or data.query like '%' || lower(btrim(p_search)) || '%')
    and (nullif(btrim(p_query), '') is null or data.query = lower(btrim(p_query)))
  group by data.date order by data.date;
end
$$;

revoke all on function public.v5_search_queries_series(date, date, text, text, text) from public, anon;
grant execute on function public.v5_search_queries_series(date, date, text, text, text) to authenticated;

create or replace function public.v5_search_queries_rows(
  p_start date, p_end date, p_category text default null, p_search text default null,
  p_sort text default 'requests', p_offset integer default 0, p_limit integer default 50
)
returns table (
  query text, category text, requests bigint, requests_previous bigint, card_clicks bigint, card_clicks_previous bigint,
  carts bigint, carts_previous bigint, orders bigint, orders_previous bigint, products bigint, products_previous bigint,
  order_amount numeric, order_amount_previous numeric, cart_cr numeric, order_cr numeric, growth numeric, opportunity numeric,
  total_count bigint
)
language plpgsql stable security definer set search_path = ''
as $$
declare v_days integer;
begin
  if not app.can_read() then raise exception 'V5 read access is required'; end if;
  if p_start is null or p_end is null or p_start > p_end or p_end - p_start > 1826 then raise exception 'Invalid search query period'; end if;
  if p_offset < 0 or p_limit < 1 or p_limit > 1000 then raise exception 'Invalid search query page bounds'; end if;
  if p_sort not in ('requests', 'growth', 'order_amount', 'orders', 'cart_cr', 'order_cr', 'opportunity', 'products') then raise exception 'Unsupported search query sort'; end if;
  v_days := p_end - p_start + 1;
  return query
  with grouped as (
    select data.query, data.category,
      sum(data.requests)::bigint requests, sum(data.requests_previous)::bigint requests_previous,
      sum(data.card_clicks)::bigint card_clicks, sum(data.card_clicks_previous)::bigint card_clicks_previous,
      sum(data.carts)::bigint carts, sum(data.carts_previous)::bigint carts_previous,
      sum(data.orders)::bigint orders, sum(data.orders_previous)::bigint orders_previous,
      max(data.products)::bigint products, max(data.products_previous)::bigint products_previous,
      coalesce(sum(data.orders * coalesce(nullif(market.reported_market_avg_check, 0), market.market_ordered_amount / nullif(market.market_orders, 0))), 0)::numeric order_amount,
      coalesce(sum(data.orders_previous * coalesce(nullif(previous_market.reported_market_avg_check, 0), previous_market.market_ordered_amount / nullif(previous_market.market_orders, 0))), 0)::numeric order_amount_previous
    from analytics.search_queries_current data
    left join analytics.market_daily_current market on market.date = data.date
    left join analytics.market_daily_current previous_market on previous_market.date = data.date - v_days
    where data.date between p_start and p_end
      and (p_category is null or data.category = p_category)
      and (nullif(btrim(p_search), '') is null or data.query like '%' || lower(btrim(p_search)) || '%')
    group by data.query, data.category
  ), enriched as (
    select grouped.*,
      case when card_clicks > 0 then carts * 100.0 / card_clicks else 0 end cart_cr,
      case when carts > 0 then orders * 100.0 / carts else 0 end order_cr,
      case when requests_previous > 0 then (requests - requests_previous) * 100.0 / requests_previous when requests > 0 then 100 else 0 end growth
    from grouped
  ), scored as (
    select enriched.*,
      log(requests + 1.0) * (100 - least(order_cr, 100)) / nullif(log(products + 10.0), 0) opportunity
    from enriched
  )
  select scored.query, scored.category, scored.requests, scored.requests_previous,
    scored.card_clicks, scored.card_clicks_previous, scored.carts, scored.carts_previous,
    scored.orders, scored.orders_previous, scored.products, scored.products_previous,
    scored.order_amount, scored.order_amount_previous, scored.cart_cr, scored.order_cr, scored.growth, scored.opportunity,
    count(*) over() total_count
  from scored
  order by
    case p_sort when 'requests' then scored.requests when 'orders' then scored.orders when 'products' then scored.products end desc nulls last,
    case p_sort when 'growth' then scored.growth when 'order_amount' then scored.order_amount when 'cart_cr' then scored.cart_cr when 'order_cr' then scored.order_cr when 'opportunity' then scored.opportunity end desc nulls last,
    scored.requests desc, scored.query, scored.category
  offset p_offset limit p_limit;
end
$$;

revoke all on function public.v5_search_queries_rows(date, date, text, text, text, integer, integer) from public, anon;
grant execute on function public.v5_search_queries_rows(date, date, text, text, text, integer, integer) to authenticated;

comment on table analytics.search_query_versions is 'Versioned V5 WB search query facts; current rows are selected by source grain date + normalized query + category.';
comment on view analytics.search_queries_current is 'Latest published V5 search query row per date, normalized query and category; cancelling a batch reveals the previous version.';
comment on function public.v5_search_queries_rows(date, date, text, text, text, integer, integer) is 'Bounded server aggregation and pagination for the V5 search-query analytical page.';

create or replace function public.v5_health()
returns jsonb language sql stable security invoker set search_path = ''
as $$ select jsonb_build_object('environment', 'analytics-v5', 'schema_version', '20260913021000', 'status', 'ok') $$;

revoke all on function public.v5_health() from public;
grant execute on function public.v5_health() to anon, authenticated;

commit;
