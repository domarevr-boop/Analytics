begin;

create temporary table geography_import_smoke_ids (
  label text primary key,
  value uuid not null
) on commit drop;
grant select, insert on geography_import_smoke_ids to authenticated;

do $$
declare
  v_user_id uuid;
  v_cabinet_id uuid := gen_random_uuid();
  v_product_id uuid := gen_random_uuid();
begin
  select access.user_id into strict v_user_id from app.user_access access
  where access.access_role = 'admin' and access.is_active;
  perform set_config('request.jwt.claim.sub', v_user_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  insert into core.cabinets (id, external_key, name) values (v_cabinet_id, 'geography-import-smoke', 'Geography import smoke');
  insert into core.products (id, cabinet_id, external_key, seller_sku, wb_sku, name, data_source)
  values (v_product_id, v_cabinet_id, 'geography-import-product', 'GEO-SELLER', '900001', 'Geography product', 'seed');
  insert into geography_import_smoke_ids values ('cabinet', v_cabinet_id), ('product', v_product_id);
end
$$;

set local role authenticated;

do $$
declare
  v_created jsonb;
  v_duplicate jsonb;
  v_result jsonb;
  v_batch_id uuid;
  v_cabinet_id uuid := (select value from geography_import_smoke_ids where label = 'cabinet');
begin
  v_created := public.v5_geography_create_batch(v_cabinet_id, '__v5_geography_smoke.xlsx',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 1024, repeat('5', 64));
  v_batch_id := (v_created ->> 'batch_id')::uuid;
  if (v_created ->> 'duplicate')::boolean then raise exception 'Initial geography batch creation failed'; end if;
  v_duplicate := public.v5_geography_create_batch(v_cabinet_id, '__duplicate.xlsx', null, 1024, repeat('5', 64));
  if not (v_duplicate ->> 'duplicate')::boolean or (v_duplicate ->> 'batch_id')::uuid <> v_batch_id then
    raise exception 'Geography file idempotency failed';
  end if;
  insert into storage.objects (bucket_id, name, owner_id)
  values ('v5-import-sources', v_created ->> 'object_path', auth.uid()::text);

  perform public.v5_geography_stage_rows(v_batch_id, jsonb_build_array(
    jsonb_build_object('row_number', 2, 'payload', jsonb_build_object(
      'date', '2026-08-10', 'seller_sku', 'GEO-SELLER', 'wb_sku', '900001',
      'region', 'Центральный', 'area', ' Москва ', 'city', ' Москва ', 'delivery_hours', 24,
      'orders_total', 10, 'product_local_orders', 6, 'product_nonlocal_orders', 4,
      'wb_local_orders', 3, 'wb_nonlocal_orders', 2, 'marketplace_local_orders', 3, 'marketplace_nonlocal_orders', 2
    )),
    jsonb_build_object('row_number', 3, 'payload', jsonb_build_object(
      'date', '2026-08-10', 'seller_sku', 'GEO-SELLER', 'wb_sku', '900001',
      'region', 'Центральный', 'area', 'Москва', 'city', 'Москва', 'delivery_hours', 20,
      'orders_total', 5, 'product_local_orders', 3, 'product_nonlocal_orders', 2,
      'wb_local_orders', 2, 'wb_nonlocal_orders', 1, 'marketplace_local_orders', 1, 'marketplace_nonlocal_orders', 1
    )),
    jsonb_build_object('row_number', 4, 'payload', jsonb_build_object(
      'date', '2026-08-11', 'seller_sku', 'GEO-SELLER', 'wb_sku', '900001',
      'region', 'Приволжский', 'area', '', 'city', '', 'delivery_hours', null,
      'orders_total', 4, 'product_local_orders', 1, 'product_nonlocal_orders', 3,
      'wb_local_orders', 1, 'wb_nonlocal_orders', 2, 'marketplace_local_orders', 0, 'marketplace_nonlocal_orders', 1
    ))
  ));
  v_result := public.v5_geography_publish_batch(v_batch_id);
  if v_result ->> 'status' <> 'published'
    or (v_result ->> 'input_rows')::integer <> 3
    or (v_result ->> 'canonical_rows')::integer <> 2
    or (v_result ->> 'replaced_duplicate_rows')::integer <> 1
    or v_result ->> 'period_start' <> '2026-08-10'
    or v_result ->> 'period_end' <> '2026-08-11'
  then raise exception 'Valid geography publish failed: %', v_result; end if;
  insert into geography_import_smoke_ids values ('valid_batch', v_batch_id);
end
$$;

reset role;

do $$
declare
  v_batch_id uuid := (select value from geography_import_smoke_ids where label = 'valid_batch');
begin
  if not exists (
    select 1 from analytics.geography_order_versions row_data
    where row_data.batch_id = v_batch_id and row_data.normalized_area = 'Москва'
      and row_data.orders_total = 5 and row_data.delivery_hours = 20
  ) then raise exception 'Geography last normalized row did not win'; end if;
end
$$;

set local role authenticated;

do $$
declare
  v_created jsonb;
  v_result jsonb;
  v_batch_id uuid;
  v_cabinet_id uuid := (select value from geography_import_smoke_ids where label = 'cabinet');
begin
  v_created := public.v5_geography_create_batch(v_cabinet_id, '__v5_geography_invalid.xlsx', null, 512, repeat('6', 64));
  v_batch_id := (v_created ->> 'batch_id')::uuid;
  insert into storage.objects (bucket_id, name, owner_id)
  values ('v5-import-sources', v_created ->> 'object_path', auth.uid()::text);
  perform public.v5_geography_stage_rows(v_batch_id, jsonb_build_array(
    jsonb_build_object('row_number', 2, 'payload', jsonb_build_object(
      'date', '2026-02-30', 'seller_sku', 'UNKNOWN', 'region', '', 'delivery_hours', -1,
      'orders_total', 5, 'product_local_orders', 1, 'product_nonlocal_orders', 1,
      'wb_local_orders', 1, 'wb_nonlocal_orders', 1, 'marketplace_local_orders', 1, 'marketplace_nonlocal_orders', 1
    ))
  ));
  v_result := public.v5_geography_publish_batch(v_batch_id);
  if v_result ->> 'status' <> 'failed' or (v_result ->> 'error_count')::integer < 4 then
    raise exception 'Invalid geography batch was accepted: %', v_result;
  end if;
end
$$;

do $$
declare
  v_result jsonb;
  v_batch_id uuid := (select value from geography_import_smoke_ids where label = 'valid_batch');
begin
  v_result := public.v5_geography_rollback_batch(v_batch_id, 'transactional smoke');
  if v_result ->> 'status' <> 'cancelled' or (v_result ->> 'version_rows')::integer <> 2 then
    raise exception 'Geography rollback failed: %', v_result;
  end if;
end
$$;

select jsonb_build_object(
  'duplicate_file_reused', true,
  'private_source_required', true,
  'directory_identity_resolved', true,
  'last_normalized_row_wins', true,
  'invalid_batch_isolated', true,
  'published_batch_rolled_back', true,
  'transaction_will_rollback', true
) as geography_import_smoke;

rollback;
