begin;

do $$
declare
  v_user_id uuid;
  v_cabinet_id uuid := gen_random_uuid();
  v_product_id uuid := gen_random_uuid();
  v_first_batch uuid := gen_random_uuid();
  v_second_batch uuid := gen_random_uuid();
  v_bounds jsonb;
begin
  select access.user_id into v_user_id
  from app.user_access access
  where access.access_role = 'admin' and access.is_active
  order by access.created_at
  limit 1;
  if v_user_id is null then raise exception 'Geography storage smoke requires the bootstrapped V5 admin'; end if;
  perform set_config('request.jwt.claim.sub', v_user_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  insert into core.cabinets (id, external_key, name)
  values (v_cabinet_id, 'geography-storage-smoke', 'Geography storage smoke');
  insert into core.products (id, cabinet_id, external_key, seller_sku, name, data_source)
  values (v_product_id, v_cabinet_id, 'geography-storage-product', 'GEO-SMOKE', 'Geography product', 'seed');

  insert into ingest.import_batches (
    id, source_code, cabinet_id, created_by, status, idempotency_key, file_sha256, source_schema_version, published_at
  ) values (
    v_first_batch, 'geography', v_cabinet_id, v_user_id, 'published', 'geography-storage-smoke-1', repeat('3', 64), 1,
    timezone('utc', now()) - interval '1 minute'
  );

  insert into analytics.geography_order_versions (
    batch_id, date, source_product_id, product_id, cabinet_id,
    region, normalized_region, area, normalized_area, city, normalized_city, delivery_hours,
    orders_total, product_local_orders, product_nonlocal_orders,
    wb_local_orders, wb_nonlocal_orders, marketplace_local_orders, marketplace_nonlocal_orders
  ) values (
    v_first_batch, date '2026-08-10', 'legacy-product', v_product_id, v_cabinet_id,
    'Центральный', 'Центральный', 'Москва', 'Москва', 'Москва', 'Москва', 24,
    10, 6, 4, 3, 2, 3, 2
  );

  v_bounds := public.v5_geography_snapshot_bounds();
  if not (v_bounds -> 'batch_ids' @> jsonb_build_array(v_first_batch))
    or (v_bounds ->> 'cabinet_count')::integer <> 1
    or (v_bounds ->> 'row_count')::integer <> 1
    or (v_bounds ->> 'order_count')::integer <> 10
    or (v_bounds ->> 'delivery_order_count')::integer <> 10
  then raise exception 'Geography first snapshot bounds failed'; end if;

  if ingest.normalize_geography_level('  Москва ', 'Без региона') <> 'Москва'
    or ingest.normalize_geography_level('', 'Без региона') <> 'Без региона'
  then raise exception 'Geography level normalization failed'; end if;

  insert into ingest.import_batches (
    id, source_code, cabinet_id, created_by, status, idempotency_key, file_sha256, source_schema_version, published_at
  ) values (
    v_second_batch, 'geography', v_cabinet_id, v_user_id, 'published', 'geography-storage-smoke-2', repeat('4', 64), 1,
    timezone('utc', now())
  );

  insert into analytics.geography_order_versions (
    batch_id, date, source_product_id, product_id, cabinet_id,
    region, normalized_region, area, normalized_area, city, normalized_city, delivery_hours,
    orders_total, product_local_orders, product_nonlocal_orders,
    wb_local_orders, wb_nonlocal_orders, marketplace_local_orders, marketplace_nonlocal_orders
  ) values (
    v_second_batch, date '2026-08-11', 'legacy-product', v_product_id, v_cabinet_id,
    'Центральный', 'Центральный', '', 'Без региона', '', 'Без населённого пункта', null,
    5, 3, 2, 2, 1, 1, 1
  );

  v_bounds := public.v5_geography_snapshot_bounds();
  if not (v_bounds -> 'batch_ids' @> jsonb_build_array(v_second_batch))
    or v_bounds -> 'batch_ids' @> jsonb_build_array(v_first_batch)
    or (v_bounds ->> 'row_count')::integer <> 1
    or (v_bounds ->> 'order_count')::integer <> 5
    or (v_bounds ->> 'delivery_row_count')::integer <> 0
  then raise exception 'Geography batches were mixed instead of replaced as one snapshot'; end if;

  update ingest.import_batches set status = 'cancelled' where id = v_second_batch;
  v_bounds := public.v5_geography_snapshot_bounds();
  if not (v_bounds -> 'batch_ids' @> jsonb_build_array(v_first_batch)) then
    raise exception 'Geography rollback did not reveal the previous batch';
  end if;

  begin
    insert into analytics.geography_order_versions (
      batch_id, date, source_product_id, product_id, cabinet_id,
      region, normalized_region, area, normalized_area, city, normalized_city,
      orders_total, product_local_orders, product_nonlocal_orders,
      wb_local_orders, wb_nonlocal_orders, marketplace_local_orders, marketplace_nonlocal_orders
    ) values (
      v_first_batch, date '2026-08-12', 'legacy-product', v_product_id, v_cabinet_id,
      'Центральный', 'Центральный', 'Москва', 'Москва', 'Москва', 'Москва',
      10, 5, 5, 2, 2, 2, 2
    );
    raise exception 'Geography fulfillment mismatch was accepted';
  exception when check_violation then
    null;
  end;
end
$$;

select jsonb_build_object(
  'versioned_storage', true,
  'v4_compatible_level_normalization', true,
  'latest_batch_replaces_snapshot', true,
  'cancel_reveals_previous_batch', true,
  'fulfillment_balance_enforced', true,
  'transaction_will_rollback', true
) as geography_storage_smoke;

rollback;
