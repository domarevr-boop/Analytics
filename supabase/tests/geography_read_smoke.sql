begin;

do $$
declare
  v_user_id uuid;
  v_cabinet_id uuid := gen_random_uuid();
  v_product_id uuid := gen_random_uuid();
  v_batch_id uuid := gen_random_uuid();
  v_filters jsonb;
  v_all record;
  v_fbo record;
  v_series record;
  v_location record;
  v_product record;
begin
  select access.user_id into strict v_user_id from app.user_access access
  where access.access_role = 'admin' and access.is_active;
  perform set_config('request.jwt.claim.sub', v_user_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  insert into core.cabinets (id, external_key, name) values (v_cabinet_id, 'geography-read-smoke', 'Geography read smoke');
  insert into core.products (id, cabinet_id, external_key, seller_sku, wb_sku, name, data_source)
  values (v_product_id, v_cabinet_id, 'geography-read-product', 'GEO-READ', '900002', 'Geography read product', 'seed');
  insert into ingest.import_batches (id, source_code, cabinet_id, created_by, status, idempotency_key, file_sha256, source_schema_version, published_at)
  values (v_batch_id, 'geography', v_cabinet_id, v_user_id, 'published', 'geography-read-smoke', repeat('7', 64), 1, timezone('utc', now()));
  insert into analytics.geography_order_versions (
    batch_id, date, source_product_id, product_id, cabinet_id, region, normalized_region, area, normalized_area, city, normalized_city,
    delivery_hours, orders_total, product_local_orders, product_nonlocal_orders,
    wb_local_orders, wb_nonlocal_orders, marketplace_local_orders, marketplace_nonlocal_orders
  ) values
    (v_batch_id, date '2026-08-10', 'GEO-READ', v_product_id, v_cabinet_id, 'Центральный', 'Центральный', 'Москва', 'Москва', 'Москва', 'Москва', 10, 10, 6, 4, 3, 2, 3, 2),
    (v_batch_id, date '2026-08-11', 'GEO-READ', v_product_id, v_cabinet_id, 'Центральный', 'Центральный', 'Тверская область', 'Тверская область', 'Тверь', 'Тверь', null, 5, 2, 3, 1, 2, 1, 1);

  v_filters := public.v5_geography_filter_options(date '2026-08-10', date '2026-08-11');
  if not (v_filters -> 'regions' @> '["Центральный"]'::jsonb)
    or not (v_filters -> 'cities' @> '["Москва", "Тверь"]'::jsonb)
  then raise exception 'Geography filter options failed: %', v_filters; end if;

  select * into v_all from public.v5_geography_summary(date '2026-08-10', date '2026-08-11') where fulfillment = 'all';
  select * into v_fbo from public.v5_geography_summary(date '2026-08-10', date '2026-08-11') where fulfillment = 'fbo';
  if v_all.orders <> 15 or v_all.covered_orders <> 10 or v_all.delivery_hours <> 10
    or v_fbo.orders <> 8 or v_fbo.covered_orders <> 5 or v_fbo.delivery_hours <> 10
  then raise exception 'Geography summary formulas failed'; end if;

  select * into v_series from public.v5_geography_series(date '2026-08-10', date '2026-08-11') where period_date = date '2026-08-10';
  if v_series.all_orders <> 10 or v_series.fbo_orders <> 5 or v_series.fbs_orders <> 5 then
    raise exception 'Geography series formulas failed';
  end if;

  select * into v_location from public.v5_geography_locations(
    date '2026-08-10', date '2026-08-11', 'area', 'all', null, null, 'Центральный', null, 100, 0
  ) where area = 'Москва';
  if v_location.orders <> 10 or v_location.product_count <> 1 then raise exception 'Geography location aggregation failed'; end if;

  select * into v_product from public.v5_geography_product_leaders(
    date '2026-08-10', date '2026-08-11', 'all', 'Центральный', null, null, 20
  );
  if v_product.product_id <> v_product_id or v_product.orders <> 15 then raise exception 'Geography product leaders failed'; end if;
end
$$;

select jsonb_build_object(
  'filter_options_bounded', true,
  'summary_fulfillment_verified', true,
  'daily_series_verified', true,
  'location_pagination_verified', true,
  'product_leaders_verified', true,
  'transaction_will_rollback', true
) as geography_read_smoke;

rollback;
