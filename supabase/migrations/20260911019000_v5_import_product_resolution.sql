begin;

create or replace function core.canonical_seller_sku(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select regexp_replace(btrim(replace(coalesce(p_value, ''), chr(160), ' ')), '\.0+$', '')
$$;

create or replace function core.resolve_or_create_import_product(
  p_cabinet_id uuid,
  p_seller_sku text,
  p_wb_sku text,
  p_source_batch_id uuid,
  p_effective_date date
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seller_sku text := nullif(btrim(replace(coalesce(p_seller_sku, ''), chr(160), ' ')), '');
  v_canonical_seller_sku text := nullif(core.canonical_seller_sku(p_seller_sku), '');
  v_wb_sku text := nullif(btrim(replace(coalesce(p_wb_sku, ''), chr(160), ' ')), '');
  v_candidate_ids uuid[];
  v_product_id uuid;
  v_product core.products%rowtype;
  v_group_id uuid;
begin
  if p_cabinet_id is null or (v_seller_sku is null and v_wb_sku is null) then
    raise exception 'Cabinet and at least one product identity are required';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'v5-product:' || p_cabinet_id::text || ':' || coalesce(v_canonical_seller_sku, '') || ':' || coalesce(v_wb_sku, ''),
      0
    )
  );

  select array_agg(distinct candidate.product_id order by candidate.product_id)
  into v_candidate_ids
  from (
    select product.id as product_id
    from core.products product
    where product.cabinet_id = p_cabinet_id
      and (
        (v_seller_sku is not null and product.seller_sku = v_seller_sku)
        or (v_canonical_seller_sku is not null and core.canonical_seller_sku(product.seller_sku) = v_canonical_seller_sku)
        or (v_wb_sku is not null and (product.wb_sku = v_wb_sku or product.seller_sku = v_wb_sku))
        or (v_seller_sku is not null and product.wb_sku = v_seller_sku)
      )
    union
    select alias.product_id
    from core.product_aliases alias
    where alias.cabinet_id = p_cabinet_id
      and (
        (v_seller_sku is not null and alias.alias_value = v_seller_sku)
        or (v_canonical_seller_sku is not null and core.canonical_seller_sku(alias.alias_value) = v_canonical_seller_sku)
        or (v_wb_sku is not null and alias.alias_value = v_wb_sku)
      )
  ) candidate;

  if coalesce(cardinality(v_candidate_ids), 0) > 1 then
    raise exception 'Product identities resolve to multiple products in cabinet %', p_cabinet_id;
  end if;

  if coalesce(cardinality(v_candidate_ids), 0) = 1 then
    v_product_id := v_candidate_ids[1];
    select product.* into strict v_product from core.products product where product.id = v_product_id for update;

    update core.products product
    set seller_sku = coalesce(nullif(btrim(product.seller_sku), ''), v_canonical_seller_sku, v_seller_sku),
        wb_sku = coalesce(nullif(btrim(product.wb_sku), ''), v_wb_sku),
        data_source = case when product.data_source = 'seed' then product.data_source else 'import' end
    where product.id = v_product_id;
  else
    insert into core.products (
      cabinet_id,
      external_key,
      seller_sku,
      wb_sku,
      name,
      data_source,
      source_batch_id
    ) values (
      p_cabinet_id,
      'import:' || encode(extensions.digest(
        p_cabinet_id::text || ':' || coalesce(v_canonical_seller_sku, v_seller_sku, '') || ':' || coalesce(v_wb_sku, ''),
        'sha256'
      ), 'hex'),
      coalesce(v_canonical_seller_sku, v_seller_sku),
      v_wb_sku,
      coalesce(v_canonical_seller_sku, v_seller_sku, v_wb_sku),
      'import',
      p_source_batch_id
    )
    returning id into v_product_id;

    insert into core.product_groups (cabinet_id, external_key, name, is_ungrouped)
    values (p_cabinet_id, 'ungrouped', 'Без склейки', true)
    on conflict (cabinet_id, external_key) do update
    set name = excluded.name,
        is_ungrouped = true,
        is_active = true;

    select product_group.id into strict v_group_id
    from core.product_groups product_group
    where product_group.cabinet_id = p_cabinet_id and product_group.is_ungrouped;

    insert into core.group_membership_versions (
      product_id,
      cabinet_id,
      effective_date,
      group_id,
      source,
      source_batch_id,
      created_by
    ) values (
      v_product_id,
      p_cabinet_id,
      coalesce(p_effective_date, current_date),
      v_group_id,
      'import',
      p_source_batch_id,
      auth.uid()
    );
  end if;

  select product.* into strict v_product from core.products product where product.id = v_product_id;

  insert into core.product_aliases (product_id, cabinet_id, alias_value, alias_type, source_batch_id)
  select v_product_id, p_cabinet_id, identity.alias_value, identity.alias_type, p_source_batch_id
  from (values
    (v_seller_sku, 'seller_sku'::text),
    (v_wb_sku, 'wb_sku'::text)
  ) identity(alias_value, alias_type)
  where identity.alias_value is not null
    and identity.alias_value <> coalesce(v_product.seller_sku, '')
    and identity.alias_value <> coalesce(v_product.wb_sku, '')
  on conflict (cabinet_id, alias_value) do nothing;

  return v_product_id;
end
$$;

revoke all on function core.resolve_or_create_import_product(uuid, text, text, uuid, date) from public, anon, authenticated;

alter function public.v5_geography_publish_batch(uuid)
rename to v5_geography_publish_batch_strict;

revoke all on function public.v5_geography_publish_batch_strict(uuid) from public, anon, authenticated;

create or replace function public.v5_geography_publish_batch(p_batch_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_batch ingest.import_batches%rowtype;
  v_row record;
  v_product core.products%rowtype;
  v_product_id uuid;
  v_non_resolvable_errors integer;
  v_resolved_products integer := 0;
  v_created_products integer := 0;
begin
  -- Reuse the established validation/publication contract first. A second pass
  -- is attempted only when every error means that a valid row needs product
  -- identity resolution, so malformed imports never create directory entries.
  v_result := public.v5_geography_publish_batch_strict(p_batch_id);
  if v_result ->> 'status' <> 'failed' then
    return v_result || jsonb_build_object('products_created', 0, 'products_resolved', 0);
  end if;

  select batch.* into strict v_batch
  from ingest.import_batches batch
  where batch.id = p_batch_id and batch.source_code = 'geography'
  for update;

  select count(*)::integer into v_non_resolvable_errors
  from ingest.import_errors error
  where error.batch_id = p_batch_id
    and error.error_code <> 'unknown_product';

  if v_non_resolvable_errors > 0 then
    return v_result;
  end if;

  for v_row in
    select row_data.sheet_name, row_data.row_number, row_data.payload,
      row_data.payload ->> 'seller_sku' as seller_sku,
      row_data.payload ->> 'wb_sku' as wb_sku,
      (row_data.payload ->> 'date')::date as effective_date
    from ingest.import_rows row_data
    where row_data.batch_id = p_batch_id
    order by row_data.sheet_name, row_data.row_number
  loop
    v_product_id := core.resolve_or_create_import_product(
      v_batch.cabinet_id,
      v_row.seller_sku,
      v_row.wb_sku,
      p_batch_id,
      v_row.effective_date
    );
    select product.* into strict v_product from core.products product where product.id = v_product_id;

    update ingest.import_rows row_data
    set payload = row_data.payload || jsonb_build_object(
          'source_seller_sku', v_row.seller_sku,
          'source_wb_sku', v_row.wb_sku,
          'seller_sku', v_product.seller_sku,
          'wb_sku', v_product.wb_sku
        ),
        row_hash = encode(extensions.digest((row_data.payload || jsonb_build_object(
          'source_seller_sku', v_row.seller_sku,
          'source_wb_sku', v_row.wb_sku,
          'seller_sku', v_product.seller_sku,
          'wb_sku', v_product.wb_sku
        ))::text, 'sha256'), 'hex'),
        accepted = null
    where row_data.batch_id = p_batch_id
      and row_data.sheet_name = v_row.sheet_name
      and row_data.row_number = v_row.row_number;
  end loop;

  select count(distinct product.id)::integer into v_resolved_products
  from core.products product
  join ingest.import_rows row_data on row_data.batch_id = p_batch_id
    and product.cabinet_id = v_batch.cabinet_id
    and (
      product.seller_sku = nullif(btrim(row_data.payload ->> 'seller_sku'), '')
      or product.wb_sku = nullif(btrim(row_data.payload ->> 'wb_sku'), '')
    );

  select count(*)::integer into v_created_products
  from core.products product
  where product.source_batch_id = p_batch_id;

  insert into ingest.import_events (batch_id, status, message, details, created_by)
  values (
    p_batch_id,
    'validating',
    'Geography product identities resolved from import',
    jsonb_build_object('products_created', v_created_products, 'products_resolved', v_resolved_products),
    auth.uid()
  );

  v_result := public.v5_geography_publish_batch_strict(p_batch_id);
  return v_result || jsonb_build_object(
    'products_created', v_created_products,
    'products_resolved', v_resolved_products
  );
end
$$;

revoke all on function public.v5_geography_publish_batch(uuid) from public, anon;
grant execute on function public.v5_geography_publish_batch(uuid) to authenticated;

create or replace function public.v5_health()
returns jsonb language sql stable security invoker set search_path = ''
as $$ select jsonb_build_object('environment', 'analytics-v5', 'schema_version', '20260911019000', 'status', 'ok') $$;

revoke all on function public.v5_health() from public;
grant execute on function public.v5_health() to anon, authenticated;

commit;
