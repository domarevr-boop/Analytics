begin;

do $$
declare
  v_user_id uuid;
  v_cabinet_id uuid := gen_random_uuid();
  v_batch_id uuid := gen_random_uuid();
  v_filters jsonb;
  v_stock jsonb;
  v_top jsonb;
  v_overview record;
  v_brand record;
  v_article record;
  v_query record;
  v_movement record;
begin
  select access.user_id into v_user_id
  from app.user_access access
  where access.access_role = 'admin' and access.is_active
  order by access.created_at
  limit 1;
  if v_user_id is null then raise exception 'Competitor read smoke requires the bootstrapped V5 admin'; end if;
  perform set_config('request.jwt.claim.sub', v_user_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  insert into core.cabinets (id, external_key, name)
  values (v_cabinet_id, '__v5_competitor_read_smoke__', 'Competitor read smoke');
  insert into core.products (cabinet_id, external_key, seller_sku, wb_sku, name, data_source)
  values (v_cabinet_id, '__v5_competitor_read_own__', 'OWN-100', '100', 'Own test article', 'seed');

  insert into ingest.import_batches (
    id, source_code, created_by, status, idempotency_key, file_sha256, source_schema_version, published_at
  ) values (
    v_batch_id, 'competitors', v_user_id, 'published', '__v5_competitor_read_smoke__', repeat('e', 64), 1,
    timezone('utc', now()) + interval '1 day'
  );

  insert into analytics.competitor_funnel_versions (
    batch_id, date, wb_article, position, seller, brand, ordered_amount, discounted_price, buyer_median_price,
    avg_search_position, impressions, clicks, reported_ctr, carts, reported_cart_conversion, orders,
    reported_order_conversion, buyouts, reported_buyout_rate
  ) values
    (v_batch_id, date '2026-08-10', '100', 1, 'Seller A', 'Brand A', 100, 10, 9, 1, 100, 20, 20, 15, 15, 10, 10, 8, 80),
    (v_batch_id, date '2026-08-10', '200', 2, 'Seller B', 'Brand B', 300, 10, 9, 2, 300, 30, 10, 60, 20, 30, 10, 24, 80),
    (v_batch_id, date '2026-08-11', '100', 2, 'Seller A', 'Brand A', 200, 10, 9, 2, 200, 40, 20, 30, 15, 20, 10, 18, 90);

  insert into analytics.competitor_search_versions (
    batch_id, date, wb_article, query, normalized_query, requests, requests_previous,
    reported_cart_conversion, reported_cart_conversion_previous, reported_order_conversion, reported_order_conversion_previous
  ) values
    (v_batch_id, date '2026-08-10', '100', 'Люстра', 'люстра', 100, 90, 10, 9, 5, 4),
    (v_batch_id, date '2026-08-10', '200', 'Люстра', 'люстра', 150, 120, 11, 10, 6, 5);

  insert into analytics.competitor_stock_versions (
    batch_id, date, wb_article, name, subject, brand, region, normalized_region, warehouse, normalized_warehouse,
    stock, in_transit_to_customer, in_transit_from_customer, avg_daily_orders
  ) values
    (v_batch_id, date '2026-08-10', '100', 'Own product', 'Lights', 'Brand A', '', '', 'Маркетплейс', 'маркетплейс', 40, 0, 0, 4),
    (v_batch_id, date '2026-08-10', '100', 'Own product', 'Lights', 'Brand A', 'R1', 'r1', 'WH1', 'wh1', 30, 0, 0, 3),
    (v_batch_id, date '2026-08-10', '100', 'Own product', 'Lights', 'Brand A', 'R1', 'r1', 'WH2', 'wh2', 20, 0, 0, 2),
    (v_batch_id, date '2026-08-10', '200', 'Other product', 'Lights', 'Brand B', '', '', 'Маркетплейс', 'маркетплейс', 50, 0, 0, 5),
    (v_batch_id, date '2026-08-11', '100', 'Own product', 'Lights', 'Brand A', '', '', 'Маркетплейс', 'маркетплейс', 60, 0, 0, 6),
    (v_batch_id, date '2026-08-11', '100', 'Own product', 'Lights', 'Brand A', 'R1', 'r1', 'WH1', 'wh1', 10, 0, 0, 1),
    (v_batch_id, date '2026-08-11', '100', 'Own product', 'Lights', 'Brand A', 'R1', 'r1', 'WH2', 'wh2', 20, 0, 0, 2),
    (v_batch_id, date '2026-08-11', '200', 'Other product', 'Lights', 'Brand B', '', '', 'Маркетплейс', 'маркетплейс', 30, 0, 0, 3);

  insert into analytics.competitor_position_versions (batch_id, date, wb_article, position, seller, brand) values
    (v_batch_id, date '2026-08-10', '100', 1, 'Seller A', 'Brand A'),
    (v_batch_id, date '2026-08-10', '200', 2, 'Seller B', 'Brand B'),
    (v_batch_id, date '2026-08-11', '100', 2, 'Seller A', 'Brand A'),
    (v_batch_id, date '2026-08-11', '300', 1, 'Seller C', 'Brand C');

  v_filters := public.v5_competitor_filters();
  if v_filters ->> 'batch_id' <> v_batch_id::text
    or v_filters #>> '{funnel,min_date}' <> '2026-08-10'
    or (v_filters #>> '{funnel,day_count}')::integer <> 2
    or jsonb_array_length(v_filters -> 'brands') <> 2
  then raise exception 'Competitor filters are not bound to the current batch: %', v_filters; end if;

  select * into v_overview
  from public.v5_competitor_overview_series(date '2026-08-10', date '2026-08-11')
  where period_date = date '2026-08-10';
  if v_overview.ordered_amount <> 400 or v_overview.orders <> 40
    or v_overview.leader_share <> 75 or v_overview.own_share <> 25
    or v_overview.own_ordered_amount <> 100
  then raise exception 'Competitor overview aggregation changed: %', row_to_json(v_overview); end if;

  select * into v_brand
  from public.v5_competitor_brand_summary(date '2026-08-10', date '2026-08-11', null, null, 10, 0)
  where brand_key = '__own__';
  if v_brand.total_count <> 2 or v_brand.ordered_amount <> 300 or v_brand.share <> 50 or not v_brand.is_own
  then raise exception 'Competitor brand aggregation changed: %', row_to_json(v_brand); end if;

  select * into v_article
  from public.v5_competitor_article_page(date '2026-08-10', date '2026-08-11', null, null, 10, 0)
  where wb_article = '100';
  if v_article.total_count <> 2 or v_article.stock <> 60 or v_article.stock_coverage <> 10
    or v_article.top_query <> 'Люстра' or v_article.latest_position <> 2 or v_article.position_delta <> -1
  then raise exception 'Competitor article page changed: %', row_to_json(v_article); end if;

  select * into v_query
  from public.v5_competitor_query_leaders(date '2026-08-10', date '2026-08-11', 10)
  limit 1;
  if v_query.query <> 'Люстра' or v_query.requests <> 150 or v_query.articles <> 2
  then raise exception 'Competitor query maximum was summed or lost: %', row_to_json(v_query); end if;

  v_stock := public.v5_competitor_stock_slice(date '2026-08-10', date '2026-08-11');
  if (v_stock ->> 'total_previous')::integer <> 100 or (v_stock ->> 'total_current')::integer <> 60
    or jsonb_array_length(v_stock -> 'warehouses') <> 3
  then raise exception 'Competitor stock precedence changed: %', v_stock; end if;

  v_top := public.v5_competitor_top_summary(date '2026-08-10', date '2026-08-11', 50);
  if (v_top ->> 'stability_rate')::numeric <> 50 or (v_top ->> 'entrants')::integer <> 1
    or (v_top ->> 'exits')::integer <> 1 or (v_top ->> 'average_movement')::numeric <> 1
  then raise exception 'Competitor TOP summary changed: %', v_top; end if;

  select * into v_movement
  from public.v5_competitor_top_movements(date '2026-08-10', date '2026-08-11', 50, 'retained', 10, 0);
  if v_movement.total_count <> 1 or v_movement.wb_article <> '100' or v_movement.position_delta <> -1
  then raise exception 'Competitor TOP movement page changed: %', row_to_json(v_movement); end if;

  begin
    perform public.v5_competitor_article_page(date '2026-08-10', date '2026-08-11', null, null, 101, 0);
    raise exception 'Competitor article limit guard did not reject an oversized page';
  exception when others then
    if sqlerrm not like 'Competitor article page limit%' then raise; end if;
  end;
end
$$;

select jsonb_build_object(
  'filters_bounded_to_current_batch', true,
  'overview_and_brand_formulas_verified', true,
  'article_and_query_pages_bounded', true,
  'stock_snapshot_precedence_verified', true,
  'top_summary_and_movement_verified', true,
  'transaction_will_rollback', true
) as competitors_read_smoke;

rollback;
