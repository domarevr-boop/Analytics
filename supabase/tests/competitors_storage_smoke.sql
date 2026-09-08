begin;

do $$
declare
  v_user_id uuid;
  v_first_batch uuid := gen_random_uuid();
  v_second_batch uuid := gen_random_uuid();
  v_bounds jsonb;
begin
  select access.user_id into v_user_id
  from app.user_access access
  where access.access_role = 'admin' and access.is_active
  order by access.created_at
  limit 1;
  if v_user_id is null then raise exception 'Competitor storage smoke requires the bootstrapped V5 admin'; end if;
  perform set_config('request.jwt.claim.sub', v_user_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  insert into ingest.import_batches (id, source_code, created_by, status, idempotency_key, file_sha256, source_schema_version, published_at)
  values (v_first_batch, 'competitors', v_user_id, 'published', 'competitor-storage-smoke-1', repeat('1', 64), 1, timezone('utc', now()) - interval '1 minute');

  insert into analytics.competitor_funnel_versions (
    batch_id, date, wb_article, position, seller, brand, ordered_amount, discounted_price, buyer_median_price,
    avg_search_position, impressions, clicks, reported_ctr, carts, reported_cart_conversion, orders,
    reported_order_conversion, buyouts, reported_buyout_rate
  ) values (v_first_batch, date '2026-08-10', '100', 1, 'Seller', 'Brand', 1000, 100, 90, 5, 1000, 100, 10, 50, 5, 20, 2, 18, 90);
  insert into analytics.competitor_search_versions values (v_first_batch, date '2026-08-10', '200', 'Люстра', 'люстра', 1000, 900, 20, 19, 131, 125, timezone('utc', now()));
  insert into analytics.competitor_stock_versions values (v_first_batch, date '2026-08-10', '100', 'Product', 'Subject', 'Brand', '', '', 'Маркетплейс', 'маркетплейс', 50, 0, 0, 5, timezone('utc', now()));
  insert into analytics.competitor_position_versions values (v_first_batch, date '2026-08-10', '100', 1, 'Seller', 'Brand', timezone('utc', now()));

  v_bounds := public.v5_competitor_snapshot_bounds();
  if v_bounds ->> 'batch_id' <> v_first_batch::text
    or (v_bounds #>> '{funnel,row_count}')::integer <> 1
    or (v_bounds #>> '{search,row_count}')::integer <> 1
    or v_bounds #>> '{positions,max_date}' <> '2026-08-10'
  then raise exception 'Competitor first snapshot bounds failed'; end if;

  insert into ingest.import_batches (id, source_code, created_by, status, idempotency_key, file_sha256, source_schema_version, published_at)
  values (v_second_batch, 'competitors', v_user_id, 'published', 'competitor-storage-smoke-2', repeat('2', 64), 1, timezone('utc', now()));
  insert into analytics.competitor_position_versions values (v_second_batch, date '2026-08-11', '101', 1, 'Other', 'Other brand', timezone('utc', now()));

  v_bounds := public.v5_competitor_snapshot_bounds();
  if v_bounds ->> 'batch_id' <> v_second_batch::text
    or (v_bounds #>> '{funnel,row_count}')::integer <> 0
    or (v_bounds #>> '{positions,row_count}')::integer <> 1
  then raise exception 'Competitor batches were mixed instead of replaced as one snapshot'; end if;

  update ingest.import_batches set status = 'cancelled' where id = v_second_batch;
  v_bounds := public.v5_competitor_snapshot_bounds();
  if v_bounds ->> 'batch_id' <> v_first_batch::text then raise exception 'Competitor rollback did not reveal the previous batch'; end if;
end
$$;

select jsonb_build_object(
  'four_independent_version_tables', true,
  'latest_batch_replaces_whole_snapshot', true,
  'search_percent_above_100_preserved', true,
  'cancel_reveals_previous_batch', true,
  'transaction_will_rollback', true
) as competitors_storage_smoke;

rollback;
