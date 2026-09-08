begin;

insert into ingest.sources (code, display_name, description, schema_version)
values ('product_registry', 'Справочник товаров', 'Кабинетные товары, алиасы и датированная история склеек', 1)
on conflict (code) do update
set display_name = excluded.display_name,
    description = excluded.description,
    schema_version = excluded.schema_version,
    updated_at = timezone('utc', now());

update storage.buckets
set allowed_mime_types = array[
  'text/csv',
  'text/plain',
  'application/csv',
  'application/json',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
]
where id = 'v5-import-sources';

alter table core.brands
add column source_batch_id uuid references ingest.import_batches(id) on delete restrict;

alter table core.categories
add column source_batch_id uuid references ingest.import_batches(id) on delete restrict;

alter table core.products
add column source_batch_id uuid references ingest.import_batches(id) on delete restrict;

alter table core.product_groups
add column source_batch_id uuid references ingest.import_batches(id) on delete restrict;

create table ingest.legacy_product_map (
  batch_id uuid not null references ingest.import_batches(id) on delete restrict,
  source_backup_sha256 text not null,
  legacy_product_id text not null,
  product_id uuid not null,
  cabinet_id uuid not null,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (batch_id, legacy_product_id),
  foreign key (product_id, cabinet_id) references core.products(id, cabinet_id) on delete restrict,
  constraint legacy_product_map_hash_format check (source_backup_sha256 ~ '^[0-9a-f]{64}$'),
  constraint legacy_product_map_id_not_blank check (btrim(legacy_product_id) <> '')
);

create index legacy_product_map_product_idx
on ingest.legacy_product_map (product_id, batch_id);

create table ingest.directory_review_items (
  id bigint generated always as identity primary key,
  batch_id uuid not null references ingest.import_batches(id) on delete restrict,
  item_index integer not null,
  item_type text not null,
  legacy_product_ids jsonb not null default '[]'::jsonb,
  reasons jsonb not null default '[]'::jsonb,
  effective_date date,
  legacy_group_id text,
  payload jsonb not null,
  status text not null default 'pending',
  resolution jsonb,
  resolved_by uuid references auth.users(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  unique (batch_id, item_index),
  constraint directory_review_index_positive check (item_index > 0),
  constraint directory_review_type_not_blank check (btrim(item_type) <> ''),
  constraint directory_review_legacy_ids_array check (jsonb_typeof(legacy_product_ids) = 'array'),
  constraint directory_review_reasons_array check (jsonb_typeof(reasons) = 'array' and jsonb_array_length(reasons) > 0),
  constraint directory_review_payload_object check (jsonb_typeof(payload) = 'object'),
  constraint directory_review_status_allowed check (status in ('pending', 'resolved', 'ignored')),
  constraint directory_review_resolution_consistent check (
    (status = 'pending' and resolution is null and resolved_by is null and resolved_at is null)
    or (status in ('resolved', 'ignored') and resolution is not null and resolved_by is not null and resolved_at is not null)
  )
);

create index directory_review_items_status_idx
on ingest.directory_review_items (status, batch_id, item_index);

alter table ingest.legacy_product_map enable row level security;
alter table ingest.directory_review_items enable row level security;

create policy legacy_product_map_read_admin
on ingest.legacy_product_map for select to authenticated
using (app.is_admin());

create policy directory_review_items_read_admin
on ingest.directory_review_items for select to authenticated
using (app.is_admin());

grant select on ingest.legacy_product_map, ingest.directory_review_items to authenticated;

create or replace function public.v5_directory_create_batch(
  p_original_filename text,
  p_size_bytes bigint,
  p_file_sha256 text,
  p_source_backup_sha256 text
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
  if v_user_id is null or not app.is_admin() then
    raise exception 'V5 administrator access is required';
  end if;

  if p_original_filename is null
    or btrim(p_original_filename) = ''
    or lower(p_original_filename) not like '%.json'
  then
    raise exception 'Directory bootstrap source must be a JSON file';
  end if;

  if p_size_bytes is null or p_size_bytes <= 0 or p_size_bytes > 5242880 then
    raise exception 'Directory bootstrap source must be between 1 byte and 5 MiB';
  end if;

  if p_file_sha256 is null or p_file_sha256 !~ '^[0-9a-f]{64}$'
    or p_source_backup_sha256 is null or p_source_backup_sha256 !~ '^[0-9a-f]{64}$'
  then
    raise exception 'Lowercase SHA-256 hashes are required';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('v5-directory:' || p_file_sha256, 0));

  select batch.id, batch.status, file.object_path
  into v_existing_id, v_existing_status, v_existing_path
  from ingest.import_batches batch
  join ingest.import_files file on file.batch_id = batch.id
  where batch.source_code = 'product_registry'
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

  v_object_path := v_user_id::text || '/' || v_batch_id::text || '/directory-bootstrap.json';

  insert into ingest.import_batches (
    id,
    source_code,
    created_by,
    status,
    idempotency_key,
    file_sha256,
    source_schema_version,
    metadata
  )
  values (
    v_batch_id,
    'product_registry',
    v_user_id,
    'created',
    'directory:' || p_file_sha256,
    p_file_sha256,
    1,
    jsonb_build_object('source_backup_sha256', p_source_backup_sha256)
  );

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
    'application/json',
    p_size_bytes,
    p_file_sha256
  );

  insert into ingest.import_events (batch_id, status, message, created_by)
  values (v_batch_id, 'created', 'Directory bootstrap batch created', v_user_id);

  return jsonb_build_object(
    'batch_id', v_batch_id,
    'object_path', v_object_path,
    'status', 'created',
    'duplicate', false
  );
end
$$;

revoke all on function public.v5_directory_create_batch(text, bigint, text, text) from public, anon;
grant execute on function public.v5_directory_create_batch(text, bigint, text, text) to authenticated;

create or replace function public.v5_directory_publish_bootstrap(
  p_batch_id uuid,
  p_manifest jsonb
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
  v_source_backup_sha256 text;
  v_section text;
  v_sections text[] := array[
    'cabinets', 'brands', 'categories', 'groups', 'products',
    'aliases', 'groupHistory', 'legacyProductMap', 'reviewQueue'
  ];
  v_total integer := 0;
  v_rejected integer := 0;
  v_period_start date;
  v_period_end date;
begin
  if v_user_id is null or not app.is_admin() then
    raise exception 'V5 administrator access is required';
  end if;

  select *
  into v_batch
  from ingest.import_batches batch
  where batch.id = p_batch_id
  for update;

  if v_batch.id is null or v_batch.source_code <> 'product_registry' then
    raise exception 'Directory bootstrap batch was not found';
  end if;

  if v_batch.status = 'published' then
    return jsonb_build_object(
      'batch_id', v_batch.id,
      'status', v_batch.status,
      'accepted_rows', v_batch.accepted_rows,
      'rejected_rows', v_batch.rejected_rows,
      'duplicate', true
    );
  end if;

  if v_batch.status not in ('created', 'uploaded', 'failed') then
    raise exception 'Directory bootstrap batch cannot be published from status %', v_batch.status;
  end if;

  select file.object_path
  into v_object_path
  from ingest.import_files file
  where file.batch_id = v_batch.id
  order by file.created_at
  limit 1;

  if v_object_path is null or not exists (
    select 1
    from storage.objects object
    where object.bucket_id = 'v5-import-sources'
      and object.name = v_object_path
  ) then
    raise exception 'Directory bootstrap source file must be uploaded before publication';
  end if;

  if p_manifest is null or jsonb_typeof(p_manifest) is distinct from 'object'
    or p_manifest ->> 'schemaVersion' is distinct from '1'
    or p_manifest #>> '{source,version}' is distinct from 'v4.0'
  then
    raise exception 'Unsupported directory bootstrap manifest';
  end if;

  v_source_backup_sha256 := p_manifest #>> '{source,sha256}';
  if v_source_backup_sha256 is null
    or v_source_backup_sha256 !~ '^[0-9a-f]{64}$'
    or v_source_backup_sha256 <> (v_batch.metadata ->> 'source_backup_sha256')
  then
    raise exception 'Directory bootstrap source hash does not match its batch';
  end if;

  foreach v_section in array v_sections loop
    if jsonb_typeof(p_manifest -> v_section) is distinct from 'array' then
      raise exception 'Directory bootstrap section % must be an array', v_section;
    end if;
  end loop;

  if jsonb_array_length(p_manifest -> 'cabinets') > 100
    or jsonb_array_length(p_manifest -> 'brands') > 10000
    or jsonb_array_length(p_manifest -> 'categories') > 10000
    or jsonb_array_length(p_manifest -> 'groups') > 100000
    or jsonb_array_length(p_manifest -> 'products') > 100000
    or jsonb_array_length(p_manifest -> 'aliases') > 500000
    or jsonb_array_length(p_manifest -> 'groupHistory') > 1000000
    or jsonb_array_length(p_manifest -> 'legacyProductMap') > 500000
    or jsonb_array_length(p_manifest -> 'reviewQueue') > 100000
  then
    raise exception 'Directory bootstrap manifest exceeds bounded section limits';
  end if;

  foreach v_section in array v_sections loop
    v_total := v_total + jsonb_array_length(p_manifest -> v_section);
  end loop;
  v_rejected := jsonb_array_length(p_manifest -> 'reviewQueue');

  delete from ingest.import_rows where batch_id = v_batch.id;
  delete from ingest.import_errors where batch_id = v_batch.id;
  delete from ingest.directory_review_items where batch_id = v_batch.id;

  foreach v_section in array v_sections loop
    insert into ingest.import_rows (
      batch_id,
      sheet_name,
      row_number,
      row_hash,
      payload,
      accepted
    )
    select
      v_batch.id,
      v_section,
      item.row_number::integer,
      encode(extensions.digest(pg_catalog.convert_to(item.payload::text, 'UTF8'), 'sha256'), 'hex'),
      item.payload,
      v_section <> 'reviewQueue'
    from jsonb_array_elements(p_manifest -> v_section) with ordinality as item(payload, row_number);
  end loop;

  insert into core.cabinets (external_key, name)
  select btrim(item."externalKey"), btrim(item.name)
  from jsonb_to_recordset(p_manifest -> 'cabinets') as item("externalKey" text, name text)
  on conflict (external_key) do nothing;

  if exists (
    select 1
    from jsonb_to_recordset(p_manifest -> 'cabinets') as item("externalKey" text, name text)
    left join core.cabinets cabinet on cabinet.external_key = btrim(item."externalKey")
    where cabinet.id is null or cabinet.name <> btrim(item.name)
  ) then
    raise exception 'Directory bootstrap cabinet conflicts with existing data';
  end if;

  insert into core.brands (external_key, name, source_batch_id)
  select btrim(item."externalKey"), btrim(item.name), v_batch.id
  from jsonb_to_recordset(p_manifest -> 'brands') as item("externalKey" text, name text)
  on conflict (external_key) do nothing;

  if exists (
    select 1
    from jsonb_to_recordset(p_manifest -> 'brands') as item("externalKey" text, name text)
    left join core.brands brand on brand.external_key = btrim(item."externalKey")
    where brand.id is null or brand.name <> btrim(item.name)
  ) then
    raise exception 'Directory bootstrap brand conflicts with existing data';
  end if;

  insert into core.categories (external_key, name, source_batch_id)
  select btrim(item."externalKey"), btrim(item.name), v_batch.id
  from jsonb_to_recordset(p_manifest -> 'categories') as item("externalKey" text, name text)
  on conflict (external_key) do nothing;

  if exists (
    select 1
    from jsonb_to_recordset(p_manifest -> 'categories') as item("externalKey" text, name text)
    left join core.categories category on category.external_key = btrim(item."externalKey")
    where category.id is null or category.name <> btrim(item.name)
  ) then
    raise exception 'Directory bootstrap category conflicts with existing data';
  end if;

  insert into core.product_groups (
    cabinet_id,
    external_key,
    name,
    is_ungrouped,
    source_batch_id
  )
  select
    cabinet.id,
    btrim(item."externalKey"),
    btrim(item.name),
    coalesce(item."isUngrouped", false),
    v_batch.id
  from jsonb_to_recordset(p_manifest -> 'groups') as item(
    "externalKey" text,
    "cabinetExternalKey" text,
    name text,
    "isUngrouped" boolean
  )
  join core.cabinets cabinet on cabinet.external_key = btrim(item."cabinetExternalKey")
  on conflict (cabinet_id, external_key) do nothing;

  if exists (
    select 1
    from jsonb_to_recordset(p_manifest -> 'groups') as item(
      "externalKey" text,
      "cabinetExternalKey" text,
      name text,
      "isUngrouped" boolean
    )
    left join core.cabinets cabinet on cabinet.external_key = btrim(item."cabinetExternalKey")
    left join core.product_groups product_group
      on product_group.cabinet_id = cabinet.id
      and product_group.external_key = btrim(item."externalKey")
    where product_group.id is null
      or product_group.name <> btrim(item.name)
      or product_group.is_ungrouped <> coalesce(item."isUngrouped", false)
  ) then
    raise exception 'Directory bootstrap group conflicts with existing data';
  end if;

  insert into core.products (
    cabinet_id,
    external_key,
    seller_sku,
    wb_sku,
    name,
    category_id,
    brand_id,
    status,
    data_source,
    source_batch_id
  )
  select
    cabinet.id,
    btrim(item."externalKey"),
    nullif(btrim(item."sellerSku"), ''),
    nullif(btrim(item."wbSku"), ''),
    btrim(item.name),
    category.id,
    brand.id,
    item.status,
    'seed',
    v_batch.id
  from jsonb_to_recordset(p_manifest -> 'products') as item(
    "externalKey" text,
    "cabinetExternalKey" text,
    "sellerSku" text,
    "wbSku" text,
    name text,
    "categoryExternalKey" text,
    "brandExternalKey" text,
    status text
  )
  join core.cabinets cabinet on cabinet.external_key = btrim(item."cabinetExternalKey")
  left join core.categories category on category.external_key = nullif(btrim(item."categoryExternalKey"), '')
  left join core.brands brand on brand.external_key = nullif(btrim(item."brandExternalKey"), '')
  on conflict (cabinet_id, external_key) do nothing;

  if exists (
    select 1
    from jsonb_to_recordset(p_manifest -> 'products') as item(
      "externalKey" text,
      "cabinetExternalKey" text,
      "sellerSku" text,
      "wbSku" text,
      name text,
      "categoryExternalKey" text,
      "brandExternalKey" text,
      status text
    )
    left join core.cabinets cabinet on cabinet.external_key = btrim(item."cabinetExternalKey")
    left join core.products product
      on product.cabinet_id = cabinet.id
      and product.external_key = btrim(item."externalKey")
    left join core.categories category on category.id = product.category_id
    left join core.brands brand on brand.id = product.brand_id
    where product.id is null
      or product.seller_sku is distinct from nullif(btrim(item."sellerSku"), '')
      or product.wb_sku is distinct from nullif(btrim(item."wbSku"), '')
      or product.name <> btrim(item.name)
      or category.external_key is distinct from nullif(btrim(item."categoryExternalKey"), '')
      or brand.external_key is distinct from nullif(btrim(item."brandExternalKey"), '')
      or product.status <> item.status
  ) then
    raise exception 'Directory bootstrap product conflicts with existing data';
  end if;

  insert into core.product_aliases (
    product_id,
    cabinet_id,
    alias_value,
    alias_type,
    source_batch_id
  )
  select
    product.id,
    cabinet.id,
    btrim(item.value),
    item.type,
    v_batch.id
  from jsonb_to_recordset(p_manifest -> 'aliases') as item(
    "productExternalKey" text,
    "cabinetExternalKey" text,
    value text,
    type text
  )
  join core.cabinets cabinet on cabinet.external_key = btrim(item."cabinetExternalKey")
  join core.products product
    on product.cabinet_id = cabinet.id
    and product.external_key = btrim(item."productExternalKey")
  on conflict (cabinet_id, alias_value) do nothing;

  if exists (
    select 1
    from jsonb_to_recordset(p_manifest -> 'aliases') as item(
      "productExternalKey" text,
      "cabinetExternalKey" text,
      value text,
      type text
    )
    left join core.cabinets cabinet on cabinet.external_key = btrim(item."cabinetExternalKey")
    left join core.products product
      on product.cabinet_id = cabinet.id
      and product.external_key = btrim(item."productExternalKey")
    left join core.product_aliases alias
      on alias.cabinet_id = cabinet.id
      and alias.alias_value = btrim(item.value)
    where alias.id is null or alias.product_id <> product.id or alias.alias_type <> item.type
  ) then
    raise exception 'Directory bootstrap alias conflicts with existing data';
  end if;

  insert into core.group_membership_versions (
    product_id,
    cabinet_id,
    effective_date,
    group_id,
    source,
    source_batch_id,
    created_by
  )
  select
    product.id,
    cabinet.id,
    item."effectiveDate"::date,
    product_group.id,
    item.source,
    v_batch.id,
    v_user_id
  from jsonb_to_recordset(p_manifest -> 'groupHistory') as item(
    "productExternalKey" text,
    "cabinetExternalKey" text,
    "effectiveDate" text,
    "groupExternalKey" text,
    source text
  )
  join core.cabinets cabinet on cabinet.external_key = btrim(item."cabinetExternalKey")
  join core.products product
    on product.cabinet_id = cabinet.id
    and product.external_key = btrim(item."productExternalKey")
  join core.product_groups product_group
    on product_group.cabinet_id = cabinet.id
    and product_group.external_key = btrim(item."groupExternalKey")
  on conflict (product_id, effective_date) do nothing;

  if exists (
    select 1
    from jsonb_to_recordset(p_manifest -> 'groupHistory') as item(
      "productExternalKey" text,
      "cabinetExternalKey" text,
      "effectiveDate" text,
      "groupExternalKey" text,
      source text
    )
    left join core.cabinets cabinet on cabinet.external_key = btrim(item."cabinetExternalKey")
    left join core.products product
      on product.cabinet_id = cabinet.id
      and product.external_key = btrim(item."productExternalKey")
    left join core.product_groups product_group
      on product_group.cabinet_id = cabinet.id
      and product_group.external_key = btrim(item."groupExternalKey")
    left join core.group_membership_versions membership
      on membership.product_id = product.id
      and membership.effective_date = item."effectiveDate"::date
    where membership.id is null or membership.group_id <> product_group.id
  ) then
    raise exception 'Directory bootstrap group history conflicts with existing data';
  end if;

  insert into ingest.legacy_product_map (
    batch_id,
    source_backup_sha256,
    legacy_product_id,
    product_id,
    cabinet_id
  )
  select
    v_batch.id,
    v_source_backup_sha256,
    btrim(item."legacyProductId"),
    product.id,
    product.cabinet_id
  from jsonb_to_recordset(p_manifest -> 'legacyProductMap') as item(
    "legacyProductId" text,
    "productExternalKey" text,
    "cabinetExternalKey" text
  )
  join core.cabinets cabinet on cabinet.external_key = btrim(item."cabinetExternalKey")
  join core.products product
    on product.cabinet_id = cabinet.id
    and product.external_key = btrim(item."productExternalKey");

  insert into ingest.directory_review_items (
    batch_id,
    item_index,
    item_type,
    legacy_product_ids,
    reasons,
    effective_date,
    legacy_group_id,
    payload
  )
  select
    v_batch.id,
    item.item_index::integer,
    btrim(item.payload ->> 'type'),
    coalesce(item.payload -> 'legacyProductIds', '[]'::jsonb),
    coalesce(item.payload -> 'reasons', '[]'::jsonb),
    nullif(item.payload ->> 'date', '')::date,
    nullif(btrim(item.payload ->> 'legacyGroupId'), ''),
    item.payload
  from jsonb_array_elements(p_manifest -> 'reviewQueue') with ordinality as item(payload, item_index);

  insert into ingest.import_errors (
    batch_id,
    sheet_name,
    row_number,
    error_code,
    message
  )
  select
    v_batch.id,
    'reviewQueue',
    item.item_index::integer,
    btrim(item.payload ->> 'type'),
    'Directory bootstrap item requires explicit review'
  from jsonb_array_elements(p_manifest -> 'reviewQueue') with ordinality as item(payload, item_index);

  select min(membership.effective_date), max(membership.effective_date)
  into v_period_start, v_period_end
  from core.group_membership_versions membership
  where membership.source_batch_id = v_batch.id;

  update ingest.import_batches
  set status = 'published',
      period_start = v_period_start,
      period_end = v_period_end,
      input_rows = v_total,
      accepted_rows = v_total - v_rejected,
      rejected_rows = v_rejected,
      metadata = metadata || jsonb_build_object(
        'bootstrap_summary', coalesce(p_manifest -> 'summary', '{}'::jsonb),
        'manifest_schema_version', 1
      ),
      uploaded_at = coalesce(uploaded_at, timezone('utc', now())),
      validated_at = timezone('utc', now()),
      published_at = timezone('utc', now()),
      finished_at = timezone('utc', now()),
      error_summary = case when v_rejected > 0 then v_rejected::text || ' items require review' else null end
  where id = v_batch.id;

  insert into ingest.import_events (batch_id, status, message, details, created_by)
  values (
    v_batch.id,
    'published',
    'Directory bootstrap published',
    jsonb_build_object('accepted_rows', v_total - v_rejected, 'review_items', v_rejected),
    v_user_id
  );

  return jsonb_build_object(
    'batch_id', v_batch.id,
    'status', 'published',
    'accepted_rows', v_total - v_rejected,
    'rejected_rows', v_rejected,
    'period_start', v_period_start,
    'period_end', v_period_end,
    'duplicate', false
  );
end
$$;

revoke all on function public.v5_directory_publish_bootstrap(uuid, jsonb) from public, anon;
grant execute on function public.v5_directory_publish_bootstrap(uuid, jsonb) to authenticated;

create or replace function public.v5_health()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'environment', 'analytics-v5',
    'schema_version', '20260908009000',
    'status', 'ok'
  )
$$;

revoke all on function public.v5_health() from public;
grant execute on function public.v5_health() to anon, authenticated;

comment on function public.v5_directory_publish_bootstrap(uuid, jsonb) is 'Atomically publishes a retained and validated V4-to-V5 directory bootstrap manifest; conflicting existing directory values abort the transaction.';

commit;
