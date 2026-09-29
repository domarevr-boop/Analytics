-- Publish monthly entry-point workbooks without resolving the same product on
-- every daily/traffic row. Validation remains row-addressable, while product
-- identity work is bounded by the number of distinct raw SKU pairs.
begin;

create or replace function public.v5_entry_points_publish_batch(p_batch_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '180s'
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
  v_product_map jsonb := '{}'::jsonb;
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

  with identities as materialized (
    select
      btrim(coalesce(row_data.payload ->> 'seller_sku', '')) as seller_sku,
      btrim(coalesce(row_data.payload ->> 'wb_sku', '')) as wb_sku
    from ingest.import_rows row_data
    where row_data.batch_id = p_batch_id
    group by 1, 2
  ), ambiguous as materialized (
    select identity.seller_sku, identity.wb_sku
    from identities identity
    cross join lateral (
      select count(distinct candidate.product_id)::integer as match_count
      from (
        select product.id as product_id
        from core.products product
        where product.cabinet_id = v_batch.cabinet_id
          and (
            (identity.seller_sku <> '' and (
              product.seller_sku = identity.seller_sku
              or core.canonical_seller_sku(product.seller_sku) = core.canonical_seller_sku(identity.seller_sku)
              or product.wb_sku = identity.seller_sku
            ))
            or (identity.wb_sku <> '' and (
              product.wb_sku = identity.wb_sku
              or product.seller_sku = identity.wb_sku
            ))
          )
        union
        select alias.product_id
        from core.product_aliases alias
        where alias.cabinet_id = v_batch.cabinet_id
          and (
            alias.alias_value = nullif(identity.seller_sku, '')
            or core.canonical_seller_sku(alias.alias_value) = nullif(core.canonical_seller_sku(identity.seller_sku), '')
            or alias.alias_value = nullif(identity.wb_sku, '')
          )
      ) candidate
    ) matched
    where matched.match_count > 1
  )
  insert into ingest.import_errors (batch_id, sheet_name, row_number, error_code, message)
  select row_data.batch_id, row_data.sheet_name, row_data.row_number, 'ambiguous_product',
    'Артикулы строки соответствуют нескольким товарам справочника'
  from ingest.import_rows row_data
  join ambiguous identity
    on identity.seller_sku = btrim(coalesce(row_data.payload ->> 'seller_sku', ''))
   and identity.wb_sku = btrim(coalesce(row_data.payload ->> 'wb_sku', ''))
  where row_data.batch_id = p_batch_id;

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
    select distinct on (source_seller_sku, source_wb_sku)
      source_seller_sku,
      source_wb_sku,
      effective_date,
      encode(extensions.digest(
        coalesce(source_seller_sku, '') || chr(0) || coalesce(source_wb_sku, ''),
        'sha256'
      ), 'hex') as identity_key
    from (
      select
        row_data.payload ->> 'seller_sku' as source_seller_sku,
        row_data.payload ->> 'wb_sku' as source_wb_sku,
        (row_data.payload ->> 'date')::date as effective_date,
        row_data.sheet_name,
        row_data.row_number
      from ingest.import_rows row_data
      where row_data.batch_id = p_batch_id and row_data.accepted
    ) source_identity
    order by source_seller_sku, source_wb_sku, sheet_name, row_number
  loop
    v_product_id := core.resolve_or_create_import_product(
      v_batch.cabinet_id,
      v_row.source_seller_sku,
      v_row.source_wb_sku,
      p_batch_id,
      v_row.effective_date
    );
    select product.* into strict v_product from core.products product where product.id = v_product_id;
    v_product_map := v_product_map || jsonb_build_object(
      v_row.identity_key,
      jsonb_build_object(
        'product_id', v_product_id,
        'seller_sku', v_product.seller_sku,
        'wb_sku', v_product.wb_sku
      )
    );
  end loop;

  with resolved_rows as materialized (
    select
      row_data.batch_id,
      row_data.sheet_name,
      row_data.row_number,
      row_data.payload,
      v_product_map -> encode(extensions.digest(
        coalesce(row_data.payload ->> 'seller_sku', '') || chr(0) || coalesce(row_data.payload ->> 'wb_sku', ''),
        'sha256'
      ), 'hex') as resolved_product
    from ingest.import_rows row_data
    where row_data.batch_id = p_batch_id and row_data.accepted
  ), enriched_rows as materialized (
    select
      resolved.batch_id,
      resolved.sheet_name,
      resolved.row_number,
      resolved.payload || jsonb_build_object(
        'source_seller_sku', resolved.payload ->> 'seller_sku',
        'source_wb_sku', resolved.payload ->> 'wb_sku',
        'product_id', resolved.resolved_product ->> 'product_id',
        'seller_sku', resolved.resolved_product ->> 'seller_sku',
        'wb_sku', resolved.resolved_product ->> 'wb_sku'
      ) as payload
    from resolved_rows resolved
  )
  update ingest.import_rows row_data
  set payload = enriched.payload,
      row_hash = encode(extensions.digest(enriched.payload::text, 'sha256'), 'hex')
  from enriched_rows enriched
  where row_data.batch_id = enriched.batch_id
    and row_data.sheet_name = enriched.sheet_name
    and row_data.row_number = enriched.row_number;

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

comment on function public.v5_entry_points_publish_batch(uuid) is
  'Publishes one retained V5 entry-points batch. Product resolution is bounded by distinct raw SKU pairs and the RPC has a 180-second function-local timeout.';

commit;
