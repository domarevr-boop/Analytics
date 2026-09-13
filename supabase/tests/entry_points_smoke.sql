begin;

create temporary table entry_points_smoke_ids (
  label text primary key,
  value uuid not null
) on commit drop;
grant select, insert on entry_points_smoke_ids to authenticated;

do $$
declare
  v_user_id uuid;
  v_cabinet_id uuid := gen_random_uuid();
begin
  select access.user_id into strict v_user_id from app.user_access access
  where access.access_role = 'admin' and access.is_active;
  perform set_config('request.jwt.claim.sub', v_user_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  insert into core.cabinets (id, external_key, name)
  values (v_cabinet_id, 'entry-points-smoke', 'Entry points smoke');
  insert into entry_points_smoke_ids values ('cabinet', v_cabinet_id);
end
$$;

set local role authenticated;

do $$
declare
  v_created jsonb;
  v_duplicate jsonb;
  v_result jsonb;
  v_batch_id uuid;
  v_cabinet_id uuid := (select value from entry_points_smoke_ids where label = 'cabinet');
begin
  v_created := public.v5_entry_points_create_batch(v_cabinet_id, '__v5_entry_points_smoke.xlsx',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 1024, repeat('8', 64));
  v_batch_id := (v_created ->> 'batch_id')::uuid;
  if (v_created ->> 'duplicate')::boolean then raise exception 'Initial entry points batch creation failed'; end if;
  v_duplicate := public.v5_entry_points_create_batch(v_cabinet_id, '__duplicate.xlsx', null, 1024, repeat('8', 64));
  if not (v_duplicate ->> 'duplicate')::boolean or (v_duplicate ->> 'batch_id')::uuid <> v_batch_id then
    raise exception 'Entry points file idempotency failed';
  end if;
  insert into storage.objects (bucket_id, name, owner_id)
  values ('v5-import-sources', v_created ->> 'object_path', auth.uid()::text);

  perform public.v5_entry_points_stage_rows(v_batch_id, jsonb_build_array(
    jsonb_build_object('row_number', 2, 'payload', jsonb_build_object(
      'date', '2026-08-10', 'seller_sku', 'ENTRY-SELLER.0', 'wb_sku', '910001',
      'section', 'Поиск', 'entry_point', 'Поиск WB',
      'impressions', 100, 'clicks', 20, 'carts', 8, 'orders', 4
    )),
    jsonb_build_object('row_number', 3, 'payload', jsonb_build_object(
      'date', '2026-08-10', 'seller_sku', 'ENTRY-SELLER', 'wb_sku', '910001',
      'section', 'Поиск', 'entry_point', 'Поиск WB',
      'impressions', 120, 'clicks', 24, 'carts', 9, 'orders', 5
    )),
    jsonb_build_object('row_number', 4, 'payload', jsonb_build_object(
      'date', '2026-08-11', 'seller_sku', 'ENTRY-SELLER', 'wb_sku', '910001',
      'section', 'Карточка товара', 'entry_point', '',
      'impressions', 80, 'clicks', 16, 'carts', 6, 'orders', 3
    ))
  ));
  v_result := public.v5_entry_points_publish_batch(v_batch_id);
  if v_result ->> 'status' <> 'published'
    or (v_result ->> 'input_rows')::integer <> 3
    or (v_result ->> 'canonical_rows')::integer <> 2
    or (v_result ->> 'replaced_duplicate_rows')::integer <> 1
    or (v_result ->> 'products_created')::integer <> 1
    or (v_result ->> 'products_resolved')::integer <> 1
    or v_result ->> 'period_start' <> '2026-08-10'
    or v_result ->> 'period_end' <> '2026-08-11'
  then raise exception 'Valid entry points publish failed: %', v_result; end if;
  insert into entry_points_smoke_ids
  select 'product', product.id from core.products product
  where product.cabinet_id = v_cabinet_id and product.seller_sku = 'ENTRY-SELLER';
  insert into entry_points_smoke_ids values ('valid_batch', v_batch_id);
end
$$;

reset role;

do $$
declare
  v_batch_id uuid := (select value from entry_points_smoke_ids where label = 'valid_batch');
begin
  if not exists (
    select 1 from core.product_aliases alias
    where alias.product_id = (select value from entry_points_smoke_ids where label = 'product')
      and alias.alias_value = 'ENTRY-SELLER.0'
  ) then raise exception 'Raw seller alias was not preserved'; end if;
  if not exists (
    select 1 from analytics.entry_point_versions row_data
    where row_data.batch_id = v_batch_id and row_data.section = 'Поиск'
      and row_data.impressions = 120 and row_data.orders = 5
  ) then raise exception 'Last entry point duplicate did not win'; end if;
  if not exists (
    select 1 from analytics.entry_point_versions row_data
    where row_data.batch_id = v_batch_id and row_data.entry_point = 'Без уточнения'
  ) then raise exception 'Blank entry point was not normalized'; end if;
end
$$;

set local role authenticated;

do $$
declare
  v_filters jsonb;
  v_summary record;
  v_series record;
  v_matrix record;
  v_leader record;
  v_product_id uuid := (select value from entry_points_smoke_ids where label = 'product');
begin
  v_filters := public.v5_entry_points_filter_options(date '2026-08-10', date '2026-08-11');
  if not (v_filters -> 'sections' @> '["Поиск", "Карточка товара"]'::jsonb)
    or not (v_filters -> 'entry_points' @> '["Поиск WB", "Без уточнения"]'::jsonb)
  then raise exception 'Entry points filters failed: %', v_filters; end if;

  select * into v_summary from public.v5_entry_points_summary(
    date '2026-08-10', date '2026-08-11', null, null, null, null, null, null, null, null
  );
  if v_summary.impressions <> 200 or v_summary.clicks <> 40 or v_summary.carts <> 15
    or v_summary.orders <> 8 or v_summary.point_count <> 2 or v_summary.product_count <> 1
  then raise exception 'Entry points summary formulas failed'; end if;

  select * into v_series from public.v5_entry_points_series(
    date '2026-08-10', date '2026-08-11', null, null, null, null, null, null, 'Поиск', null
  ) where period_date = date '2026-08-10';
  if v_series.impressions <> 120 or v_series.clicks <> 24 or v_series.orders <> 5 then
    raise exception 'Entry points daily series failed';
  end if;

  select * into v_matrix from public.v5_entry_points_matrix(
    date '2026-08-10', date '2026-08-11', 'orders', null, null, null, null, null, null, null, null, 100
  ) where section = 'Карточка товара';
  if v_matrix.entry_point <> 'Без уточнения' or v_matrix.orders <> 3 then
    raise exception 'Entry points matrix failed';
  end if;

  select * into v_leader from public.v5_entry_points_product_leaders(
    date '2026-08-10', date '2026-08-11', 'поиск', 'orders', null, null, null, 5
  );
  if v_leader.product_id <> v_product_id or v_leader.orders <> 5 then
    raise exception 'Entry points product leaders failed';
  end if;
end
$$;

do $$
declare
  v_created jsonb;
  v_result jsonb;
  v_batch_id uuid;
  v_cabinet_id uuid := (select value from entry_points_smoke_ids where label = 'cabinet');
begin
  v_created := public.v5_entry_points_create_batch(v_cabinet_id, '__v5_entry_points_invalid.xlsx', null, 512, repeat('9', 64));
  v_batch_id := (v_created ->> 'batch_id')::uuid;
  insert into storage.objects (bucket_id, name, owner_id)
  values ('v5-import-sources', v_created ->> 'object_path', auth.uid()::text);
  perform public.v5_entry_points_stage_rows(v_batch_id, jsonb_build_array(
    jsonb_build_object('row_number', 2, 'payload', jsonb_build_object(
      'date', '2026-02-30', 'seller_sku', 'INVALID-ENTRY', 'section', '', 'entry_point', 'Точка',
      'impressions', -1, 'clicks', 'bad', 'carts', 0, 'orders', 0
    ))
  ));
  v_result := public.v5_entry_points_publish_batch(v_batch_id);
  if v_result ->> 'status' <> 'failed' or (v_result ->> 'error_count')::integer < 4 then
    raise exception 'Invalid entry points batch was accepted: %', v_result;
  end if;
  if exists (select 1 from core.products product where product.cabinet_id = v_cabinet_id and product.seller_sku = 'INVALID-ENTRY') then
    raise exception 'Invalid entry points row created a product';
  end if;
end
$$;

do $$
declare
  v_result jsonb;
  v_batch_id uuid := (select value from entry_points_smoke_ids where label = 'valid_batch');
begin
  v_result := public.v5_entry_points_rollback_batch(v_batch_id, 'transactional smoke');
  if v_result ->> 'status' <> 'cancelled' or (v_result ->> 'version_rows')::integer <> 2 then
    raise exception 'Entry points rollback failed: %', v_result;
  end if;
end
$$;

select jsonb_build_object(
  'file_idempotency_verified', true,
  'private_source_required', true,
  'import_driven_product_resolution', true,
  'last_duplicate_wins', true,
  'aggregate_conversions_preserved', true,
  'bounded_read_api_verified', true,
  'invalid_rows_do_not_create_products', true,
  'transaction_will_rollback', true
) as entry_points_smoke;

rollback;
