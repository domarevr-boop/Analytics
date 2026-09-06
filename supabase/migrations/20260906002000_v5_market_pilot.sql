begin;

create table analytics.market_daily_versions (
  batch_id uuid not null references ingest.import_batches(id) on delete restrict,
  date date not null,
  market_ordered_amount numeric(20, 2) not null,
  own_ordered_amount numeric(20, 2) not null,
  market_orders bigint not null,
  own_orders bigint not null,
  reported_amount_share numeric(12, 6),
  reported_orders_share numeric(12, 6),
  reported_own_avg_check numeric(20, 6),
  reported_market_avg_check numeric(20, 6),
  created_at timestamptz not null default timezone('utc', now()),
  primary key (batch_id, date),
  constraint market_daily_amounts_nonnegative check (
    market_ordered_amount >= 0 and own_ordered_amount >= 0
  ),
  constraint market_daily_orders_nonnegative check (
    market_orders >= 0 and own_orders >= 0
  ),
  constraint market_daily_reported_shares_valid check (
    (reported_amount_share is null or reported_amount_share between 0 and 100)
    and (reported_orders_share is null or reported_orders_share between 0 and 100)
  ),
  constraint market_daily_reported_checks_nonnegative check (
    (reported_own_avg_check is null or reported_own_avg_check >= 0)
    and (reported_market_avg_check is null or reported_market_avg_check >= 0)
  )
);

create index market_daily_versions_date_idx
on analytics.market_daily_versions (date, batch_id);

alter table analytics.market_daily_versions enable row level security;

create policy market_daily_versions_read_allowed
on analytics.market_daily_versions for select to authenticated
using (app.can_read_batch(batch_id));

create or replace view analytics.market_daily_current
with (security_invoker = true)
as
select
  selected.batch_id,
  selected.date,
  selected.market_ordered_amount,
  selected.own_ordered_amount,
  selected.market_orders,
  selected.own_orders,
  selected.reported_amount_share,
  selected.reported_orders_share,
  selected.reported_own_avg_check,
  selected.reported_market_avg_check
from (
  select
    row_data.*,
    row_number() over (
      partition by row_data.date
      order by batch.published_at desc nulls last, batch.id desc
    ) as version_rank
  from analytics.market_daily_versions row_data
  join ingest.import_batches batch on batch.id = row_data.batch_id
  where batch.source_code = 'market_dynamics'
    and batch.status = 'published'
) selected
where selected.version_rank = 1;

revoke all on analytics.market_daily_versions from public, anon, authenticated;
revoke all on analytics.market_daily_current from public, anon, authenticated;

create or replace function ingest.is_iso_date(p_value text)
returns boolean
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  v_date date;
begin
  if p_value is null or p_value !~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$' then
    return false;
  end if;

  v_date := p_value::date;
  return to_char(v_date, 'YYYY-MM-DD') = p_value;
exception
  when others then return false;
end
$$;

revoke all on function ingest.is_iso_date(text) from public, anon, authenticated;

create or replace function ingest.try_numeric(p_value text)
returns numeric
language plpgsql
immutable
security invoker
set search_path = ''
as $$
begin
  return p_value::numeric;
exception
  when others then return null;
end
$$;

revoke all on function ingest.try_numeric(text) from public, anon, authenticated;

create or replace function public.v5_market_create_batch(
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
    when lower(p_original_filename) like '%.csv' then 'csv'
    else null
  end;

  if v_extension is null then
    raise exception 'Market import supports only .xlsx and .csv files';
  end if;

  if p_size_bytes is null or p_size_bytes <= 0 or p_size_bytes > 10485760 then
    raise exception 'Market source file must be between 1 byte and 10 MiB';
  end if;

  if p_file_sha256 is null or p_file_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'A lowercase SHA-256 file hash is required';
  end if;

  select batch.id, batch.status, file.object_path
  into v_existing_id, v_existing_status, v_existing_path
  from ingest.import_batches batch
  join ingest.import_files file on file.batch_id = batch.id
  where batch.source_code = 'market_dynamics'
    and batch.cabinet_id is null
    and batch.file_sha256 = p_file_sha256
  limit 1;

  if v_existing_id is not null then
    return jsonb_build_object(
      'batch_id', v_existing_id,
      'object_path', v_existing_path,
      'status', v_existing_status,
      'duplicate', true
    );
  end if;

  v_object_path := v_user_id::text || '/' || v_batch_id::text || '/source.' || v_extension;

  insert into ingest.import_batches (
    id,
    source_code,
    created_by,
    status,
    idempotency_key,
    file_sha256,
    source_schema_version
  )
  values (
    v_batch_id,
    'market_dynamics',
    v_user_id,
    'created',
    'market:' || p_file_sha256,
    p_file_sha256,
    1
  )
  on conflict do nothing;

  if not found then
    select batch.id, batch.status, file.object_path
    into strict v_existing_id, v_existing_status, v_existing_path
    from ingest.import_batches batch
    join ingest.import_files file on file.batch_id = batch.id
    where batch.source_code = 'market_dynamics'
      and batch.cabinet_id is null
      and batch.file_sha256 = p_file_sha256
    limit 1;

    return jsonb_build_object(
      'batch_id', v_existing_id,
      'object_path', v_existing_path,
      'status', v_existing_status,
      'duplicate', true
    );
  end if;

  insert into ingest.import_files (
    batch_id,
    object_path,
    original_filename,
    content_type,
    size_bytes,
    file_sha256
  )
  values (
    v_batch_id,
    v_object_path,
    p_original_filename,
    nullif(btrim(p_content_type), ''),
    p_size_bytes,
    p_file_sha256
  );

  insert into ingest.import_events (batch_id, status, message, created_by)
  values (v_batch_id, 'created', 'Market import batch created', v_user_id);

  return jsonb_build_object(
    'batch_id', v_batch_id,
    'object_path', v_object_path,
    'status', 'created',
    'duplicate', false
  );
end
$$;

revoke all on function public.v5_market_create_batch(text, text, bigint, text) from public, anon;
grant execute on function public.v5_market_create_batch(text, text, bigint, text) to authenticated;

create or replace function public.v5_market_stage_rows(
  p_batch_id uuid,
  p_rows jsonb
)
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
    raise exception 'Rows cannot be staged while batch status is %', v_batch.status;
  end if;

  select file.object_path
  into strict v_object_path
  from ingest.import_files file
  where file.batch_id = p_batch_id;

  if not exists (
    select 1
    from storage.objects object
    where object.bucket_id = 'v5-import-sources'
      and object.name = v_object_path
  ) then
    raise exception 'The source file must be uploaded before staging rows';
  end if;

  if jsonb_typeof(p_rows) <> 'array'
    or jsonb_array_length(p_rows) = 0
    or jsonb_array_length(p_rows) > 500
  then
    raise exception 'Each staging chunk must contain between 1 and 500 rows';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_rows) item
    where jsonb_typeof(item) <> 'object'
      or coalesce(item ->> 'row_number', '') !~ '^[1-9][0-9]{0,8}$'
      or jsonb_typeof(item -> 'payload') <> 'object'
  ) then
    raise exception 'Every staged row requires a positive row_number and object payload';
  end if;

  insert into ingest.import_rows (
    batch_id,
    sheet_name,
    row_number,
    row_hash,
    payload,
    accepted
  )
  select
    p_batch_id,
    left(coalesce(item ->> 'sheet_name', ''), 100),
    (item ->> 'row_number')::integer,
    encode(digest((item -> 'payload')::text, 'sha256'), 'hex'),
    item -> 'payload',
    null
  from jsonb_array_elements(p_rows) item
  on conflict (batch_id, sheet_name, row_number) do update
  set row_hash = excluded.row_hash,
      payload = excluded.payload,
      accepted = null;

  select count(*)::integer
  into v_total_rows
  from ingest.import_rows row_data
  where row_data.batch_id = p_batch_id;

  if v_total_rows > 50000 then
    raise exception 'Market import is limited to 50000 staged rows';
  end if;

  update ingest.import_batches
  set status = 'validating',
      input_rows = v_total_rows,
      uploaded_at = coalesce(uploaded_at, timezone('utc', now())),
      error_summary = null,
      finished_at = null
  where id = p_batch_id;

  insert into ingest.import_events (batch_id, status, message, details, created_by)
  values (
    p_batch_id,
    'validating',
    'Market rows staged',
    jsonb_build_object('chunk_rows', jsonb_array_length(p_rows), 'total_rows', v_total_rows),
    v_user_id
  );

  return jsonb_build_object(
    'batch_id', p_batch_id,
    'chunk_rows', jsonb_array_length(p_rows),
    'total_rows', v_total_rows,
    'status', 'validating'
  );
end
$$;

revoke all on function public.v5_market_stage_rows(uuid, jsonb) from public, anon;
grant execute on function public.v5_market_stage_rows(uuid, jsonb) to authenticated;

create or replace function public.v5_market_publish_batch(p_batch_id uuid)
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
  v_period_start date;
  v_period_end date;
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

  if v_batch.status not in ('validating', 'failed') then
    raise exception 'Market batch cannot be published while status is %', v_batch.status;
  end if;

  select count(*)::integer
  into v_input_rows
  from ingest.import_rows row_data
  where row_data.batch_id = p_batch_id;

  if v_input_rows = 0 then
    raise exception 'Market batch has no staged rows';
  end if;

  delete from ingest.import_errors where batch_id = p_batch_id;

  insert into ingest.import_errors (
    batch_id, sheet_name, row_number, column_name, error_code, message, raw_value
  )
  select
    row_data.batch_id,
    row_data.sheet_name,
    row_data.row_number,
    'date',
    'invalid_date',
    'Дата должна быть календарной датой в формате YYYY-MM-DD',
    row_data.payload ->> 'date'
  from ingest.import_rows row_data
  where row_data.batch_id = p_batch_id
    and not ingest.is_iso_date(row_data.payload ->> 'date');

  insert into ingest.import_errors (
    batch_id, sheet_name, row_number, column_name, error_code, message, raw_value
  )
  select
    row_data.batch_id,
    row_data.sheet_name,
    row_data.row_number,
    field.column_name,
    'invalid_number',
    'Обязательное значение должно быть неотрицательным числом',
    row_data.payload ->> field.column_name
  from ingest.import_rows row_data
  cross join (
    values ('market_ordered_amount'), ('own_ordered_amount')
  ) field(column_name)
  where row_data.batch_id = p_batch_id
    and (
      jsonb_typeof(row_data.payload -> field.column_name) <> 'number'
      or ingest.try_numeric(row_data.payload ->> field.column_name) is null
      or ingest.try_numeric(row_data.payload ->> field.column_name) < 0
      or ingest.try_numeric(row_data.payload ->> field.column_name) >= 1000000000000000000
    );

  insert into ingest.import_errors (
    batch_id, sheet_name, row_number, column_name, error_code, message, raw_value
  )
  select
    row_data.batch_id,
    row_data.sheet_name,
    row_data.row_number,
    field.column_name,
    'invalid_integer',
    'Обязательное значение должно быть целым неотрицательным числом',
    row_data.payload ->> field.column_name
  from ingest.import_rows row_data
  cross join (
    values ('market_orders'), ('own_orders')
  ) field(column_name)
  where row_data.batch_id = p_batch_id
    and (
      jsonb_typeof(row_data.payload -> field.column_name) <> 'number'
      or ingest.try_numeric(row_data.payload ->> field.column_name) is null
      or ingest.try_numeric(row_data.payload ->> field.column_name) < 0
      or trunc(ingest.try_numeric(row_data.payload ->> field.column_name)) <> ingest.try_numeric(row_data.payload ->> field.column_name)
      or ingest.try_numeric(row_data.payload ->> field.column_name) > 9223372036854775807
    );

  insert into ingest.import_errors (
    batch_id, sheet_name, row_number, column_name, error_code, message, raw_value
  )
  select
    row_data.batch_id,
    row_data.sheet_name,
    row_data.row_number,
    field.column_name,
    'invalid_optional_number',
    case
      when field.is_share then 'Значение должно быть числом от 0 до 100'
      else 'Значение должно быть неотрицательным числом'
    end,
    row_data.payload ->> field.column_name
  from ingest.import_rows row_data
  cross join (
    values
      ('amount_share', true),
      ('orders_share', true),
      ('own_avg_check', false),
      ('market_avg_check', false)
  ) field(column_name, is_share)
  where row_data.batch_id = p_batch_id
    and row_data.payload ? field.column_name
    and row_data.payload -> field.column_name <> 'null'::jsonb
    and (
      jsonb_typeof(row_data.payload -> field.column_name) <> 'number'
      or ingest.try_numeric(row_data.payload ->> field.column_name) is null
      or ingest.try_numeric(row_data.payload ->> field.column_name) < 0
      or (field.is_share and ingest.try_numeric(row_data.payload ->> field.column_name) > 100)
      or (not field.is_share and ingest.try_numeric(row_data.payload ->> field.column_name) >= 1000000000000000000)
    );

  insert into ingest.import_errors (
    batch_id, sheet_name, row_number, column_name, error_code, message, raw_value
  )
  select
    row_data.batch_id,
    row_data.sheet_name,
    row_data.row_number,
    'date',
    'duplicate_date',
    'В одной партии дата должна встречаться только один раз',
    row_data.payload ->> 'date'
  from ingest.import_rows row_data
  join (
    select payload ->> 'date' as duplicate_date
    from ingest.import_rows
    where batch_id = p_batch_id
      and ingest.is_iso_date(payload ->> 'date')
    group by payload ->> 'date'
    having count(*) > 1
  ) duplicates on duplicates.duplicate_date = row_data.payload ->> 'date'
  where row_data.batch_id = p_batch_id;

  update ingest.import_rows row_data
  set accepted = not exists (
    select 1
    from ingest.import_errors error
    where error.batch_id = row_data.batch_id
      and error.sheet_name = row_data.sheet_name
      and error.row_number = row_data.row_number
  )
  where row_data.batch_id = p_batch_id;

  select
    count(*)::integer,
    count(distinct (sheet_name, row_number))::integer
  into v_error_count, v_rejected_rows
  from ingest.import_errors
  where batch_id = p_batch_id;

  if v_error_count > 0 then
    update ingest.import_batches
    set status = 'failed',
        input_rows = v_input_rows,
        accepted_rows = v_input_rows - v_rejected_rows,
        rejected_rows = v_rejected_rows,
        error_summary = v_error_count || ' validation errors',
        finished_at = timezone('utc', now())
    where id = p_batch_id;

    insert into ingest.import_events (batch_id, status, message, details, created_by)
    values (
      p_batch_id,
      'failed',
      'Market batch validation failed',
      jsonb_build_object('error_count', v_error_count, 'rejected_rows', v_rejected_rows),
      v_user_id
    );

    return jsonb_build_object(
      'batch_id', p_batch_id,
      'status', 'failed',
      'input_rows', v_input_rows,
      'accepted_rows', v_input_rows - v_rejected_rows,
      'rejected_rows', v_rejected_rows,
      'error_count', v_error_count
    );
  end if;

  insert into analytics.market_daily_versions (
    batch_id,
    date,
    market_ordered_amount,
    own_ordered_amount,
    market_orders,
    own_orders,
    reported_amount_share,
    reported_orders_share,
    reported_own_avg_check,
    reported_market_avg_check
  )
  select
    p_batch_id,
    (row_data.payload ->> 'date')::date,
    (row_data.payload ->> 'market_ordered_amount')::numeric,
    (row_data.payload ->> 'own_ordered_amount')::numeric,
    (row_data.payload ->> 'market_orders')::bigint,
    (row_data.payload ->> 'own_orders')::bigint,
    nullif(row_data.payload ->> 'amount_share', '')::numeric,
    nullif(row_data.payload ->> 'orders_share', '')::numeric,
    nullif(row_data.payload ->> 'own_avg_check', '')::numeric,
    nullif(row_data.payload ->> 'market_avg_check', '')::numeric
  from ingest.import_rows row_data
  where row_data.batch_id = p_batch_id
    and row_data.accepted
  on conflict (batch_id, date) do update
  set market_ordered_amount = excluded.market_ordered_amount,
      own_ordered_amount = excluded.own_ordered_amount,
      market_orders = excluded.market_orders,
      own_orders = excluded.own_orders,
      reported_amount_share = excluded.reported_amount_share,
      reported_orders_share = excluded.reported_orders_share,
      reported_own_avg_check = excluded.reported_own_avg_check,
      reported_market_avg_check = excluded.reported_market_avg_check;

  select min((payload ->> 'date')::date), max((payload ->> 'date')::date)
  into v_period_start, v_period_end
  from ingest.import_rows
  where batch_id = p_batch_id
    and accepted;

  update ingest.import_batches
  set status = 'published',
      period_start = v_period_start,
      period_end = v_period_end,
      input_rows = v_input_rows,
      accepted_rows = v_input_rows,
      rejected_rows = 0,
      error_summary = null,
      validated_at = timezone('utc', now()),
      published_at = timezone('utc', now()),
      finished_at = timezone('utc', now())
  where id = p_batch_id;

  insert into ingest.import_events (batch_id, status, message, details, created_by)
  values (
    p_batch_id,
    'published',
    'Market batch published',
    jsonb_build_object(
      'rows', v_input_rows,
      'period_start', v_period_start,
      'period_end', v_period_end
    ),
    v_user_id
  );

  return jsonb_build_object(
    'batch_id', p_batch_id,
    'status', 'published',
    'input_rows', v_input_rows,
    'accepted_rows', v_input_rows,
    'rejected_rows', 0,
    'period_start', v_period_start,
    'period_end', v_period_end
  );
end
$$;

revoke all on function public.v5_market_publish_batch(uuid) from public, anon;
grant execute on function public.v5_market_publish_batch(uuid) to authenticated;

create or replace function public.v5_market_rollback_batch(
  p_batch_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_affected_dates integer;
begin
  if v_user_id is null or not app.is_admin() then
    raise exception 'V5 administrator access is required';
  end if;

  perform 1
  from ingest.import_batches batch
  where batch.id = p_batch_id
    and batch.source_code = 'market_dynamics'
    and batch.status = 'published'
  for update;

  if not found then
    raise exception 'Published market batch % does not exist', p_batch_id;
  end if;

  select count(*)::integer
  into v_affected_dates
  from analytics.market_daily_versions
  where batch_id = p_batch_id;

  update ingest.import_batches
  set status = 'cancelled',
      error_summary = nullif(btrim(p_reason), ''),
      finished_at = timezone('utc', now())
  where id = p_batch_id;

  insert into ingest.import_events (batch_id, status, message, details, created_by)
  values (
    p_batch_id,
    'cancelled',
    'Published market batch rolled back',
    jsonb_build_object('reason', nullif(btrim(p_reason), ''), 'affected_dates', v_affected_dates),
    v_user_id
  );

  return jsonb_build_object(
    'batch_id', p_batch_id,
    'status', 'cancelled',
    'affected_dates', v_affected_dates
  );
end
$$;

revoke all on function public.v5_market_rollback_batch(uuid, text) from public, anon;
grant execute on function public.v5_market_rollback_batch(uuid, text) to authenticated;

create or replace function public.v5_market_date_bounds()
returns table (min_date date, max_date date, day_count bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not app.can_read() then
    raise exception 'V5 read access is required';
  end if;

  return query
  select min(data.date), max(data.date), count(*)
  from analytics.market_daily_current data;
end
$$;

revoke all on function public.v5_market_date_bounds() from public, anon;
grant execute on function public.v5_market_date_bounds() to authenticated;

create or replace function public.v5_market_series(
  p_start date,
  p_end date,
  p_granularity text default 'day'
)
returns table (
  period_date date,
  market_ordered_amount numeric,
  own_ordered_amount numeric,
  amount_share numeric,
  market_orders bigint,
  own_orders bigint,
  orders_share numeric,
  own_avg_check numeric,
  market_avg_check numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not app.can_read() then
    raise exception 'V5 read access is required';
  end if;

  if p_start is null or p_end is null or p_end < p_start then
    raise exception 'A valid inclusive date range is required';
  end if;

  if p_end - p_start > 1826 then
    raise exception 'Market series range cannot exceed five years';
  end if;

  if p_granularity not in ('day', 'week', 'month') then
    raise exception 'Granularity must be day, week or month';
  end if;

  return query
  with grouped as (
    select
      case p_granularity
        when 'month' then date_trunc('month', data.date)::date
        when 'week' then date_trunc('week', data.date)::date
        else data.date
      end as bucket_date,
      sum(data.market_ordered_amount) as market_amount,
      sum(data.own_ordered_amount) as own_amount,
      sum(data.market_orders)::bigint as market_order_count,
      sum(data.own_orders)::bigint as own_order_count,
      max(data.reported_own_avg_check) filter (where p_granularity = 'day') as daily_own_check,
      max(data.reported_market_avg_check) filter (where p_granularity = 'day') as daily_market_check
    from analytics.market_daily_current data
    where data.date between p_start and p_end
    group by bucket_date
  )
  select
    grouped.bucket_date,
    grouped.market_amount,
    grouped.own_amount,
    grouped.own_amount / nullif(grouped.market_amount, 0) * 100,
    grouped.market_order_count,
    grouped.own_order_count,
    grouped.own_order_count::numeric / nullif(grouped.market_order_count, 0) * 100,
    coalesce(
      nullif(grouped.daily_own_check, 0),
      grouped.own_amount / nullif(grouped.own_order_count, 0)
    ),
    coalesce(
      nullif(grouped.daily_market_check, 0),
      grouped.market_amount / nullif(grouped.market_order_count, 0)
    )
  from grouped
  order by grouped.bucket_date;
end
$$;

revoke all on function public.v5_market_series(date, date, text) from public, anon;
grant execute on function public.v5_market_series(date, date, text) to authenticated;

insert into analytics.metric_definitions (
  code,
  name,
  description,
  unit,
  grain,
  formula_version,
  formula,
  source_fields,
  supported_filters,
  limitations,
  owner,
  valid_from
)
values
  (
    'market_amount_share',
    'Доля рынка по сумме',
    'Доля наших заказов в денежном объёме рынка.',
    'percent',
    'selected_period',
    1,
    'sum(own_ordered_amount) / nullif(sum(market_ordered_amount), 0) * 100',
    '["own_ordered_amount", "market_ordered_amount"]'::jsonb,
    '["period", "granularity"]'::jsonb,
    'Источник агрегирован по датам и не поддерживает кабинет, категорию, бренд или товар.',
    'Analytics owner',
    date '2026-09-06'
  ),
  (
    'market_orders_share',
    'Доля рынка в штуках',
    'Доля наших заказанных единиц в количестве заказов рынка.',
    'percent',
    'selected_period',
    1,
    'sum(own_orders) / nullif(sum(market_orders), 0) * 100',
    '["own_orders", "market_orders"]'::jsonb,
    '["period", "granularity"]'::jsonb,
    'Источник агрегирован по датам и не поддерживает кабинет, категорию, бренд или товар.',
    'Analytics owner',
    date '2026-09-06'
  ),
  (
    'market_average_check',
    'Средний чек рынка',
    'Средняя сумма заказов рынка на заказанную единицу.',
    'rubles',
    'selected_period',
    1,
    'sum(market_ordered_amount) / nullif(sum(market_orders), 0)',
    '["market_ordered_amount", "market_orders", "reported_market_avg_check"]'::jsonb,
    '["period", "granularity"]'::jsonb,
    'Для дневной точки сохраняется готовое значение источника; агрегаты периода пересчитываются из сумм и количества.',
    'Analytics owner',
    date '2026-09-06'
  ),
  (
    'own_market_average_check',
    'Наш средний чек в отчёте рынка',
    'Средняя сумма наших заказов на заказанную единицу в агрегированном отчёте рынка.',
    'rubles',
    'selected_period',
    1,
    'sum(own_ordered_amount) / nullif(sum(own_orders), 0)',
    '["own_ordered_amount", "own_orders", "reported_own_avg_check"]'::jsonb,
    '["period", "granularity"]'::jsonb,
    'Может отличаться от собственных товарных метрик при разном покрытии источников.',
    'Analytics owner',
    date '2026-09-06'
  );

create or replace function public.v5_health()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'environment', 'analytics-v5',
    'schema_version', '20260906002000',
    'status', 'ok'
  )
$$;

revoke all on function public.v5_health() from public;
grant execute on function public.v5_health() to anon, authenticated;

comment on table analytics.market_daily_versions is 'Versioned daily market facts. Current rows are selected only from published batches.';
comment on view analytics.market_daily_current is 'Latest published market row per date; cancelling a batch reveals the previous published version.';

commit;
