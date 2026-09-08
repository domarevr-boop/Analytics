begin;

create temporary table competitor_import_smoke_batches (
  label text primary key,
  batch_id uuid not null
) on commit drop;

grant select, insert on competitor_import_smoke_batches to authenticated;

do $$
declare
  v_user_id uuid;
begin
  select access.user_id into strict v_user_id
  from app.user_access access
  where access.access_role = 'admin' and access.is_active;
  perform set_config('request.jwt.claim.sub', v_user_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
end
$$;

set local role authenticated;

do $$
declare
  v_created jsonb;
  v_duplicate jsonb;
  v_result jsonb;
  v_batch_id uuid;
  v_object_path text;
begin
  v_created := public.v5_competitor_create_batch(
    '__v5_competitor_import_smoke.xlsx',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    1024,
    repeat('c', 64)
  );
  v_batch_id := (v_created ->> 'batch_id')::uuid;
  v_object_path := v_created ->> 'object_path';
  if (v_created ->> 'duplicate')::boolean or v_created ->> 'status' <> 'created' then
    raise exception 'Initial competitor batch creation failed: %', v_created;
  end if;

  v_duplicate := public.v5_competitor_create_batch('__duplicate.xls', 'application/vnd.ms-excel', 1024, repeat('c', 64));
  if not (v_duplicate ->> 'duplicate')::boolean or (v_duplicate ->> 'batch_id')::uuid <> v_batch_id then
    raise exception 'Competitor file idempotency failed';
  end if;

  insert into storage.objects (bucket_id, name, owner_id)
  values ('v5-import-sources', v_object_path, auth.uid()::text);

  perform public.v5_competitor_stage_rows(v_batch_id, jsonb_build_array(
    jsonb_build_object('sheet_name', 'funnel', 'row_number', 999, 'payload', jsonb_build_object(
      'date', '2026-08-10', 'wb_article', '100', 'position', 1, 'seller', 'Seller', 'brand', 'Brand',
      'ordered_amount', 1000, 'discounted_price', 100, 'buyer_median_price', 90, 'avg_search_position', 5,
      'impressions', 1000, 'clicks', 100, 'reported_ctr', 10, 'carts', 50,
      'reported_cart_conversion', 5, 'orders', 20, 'reported_order_conversion', 2, 'buyouts', 18,
      'reported_buyout_rate', 90
    ))
  ));
  v_result := public.v5_competitor_reset_staging(v_batch_id);
  if v_result ->> 'status' <> 'uploaded' or (v_result ->> 'cleared_rows')::integer <> 1 then
    raise exception 'Competitor retry reset failed: %', v_result;
  end if;

  perform public.v5_competitor_stage_rows(v_batch_id, jsonb_build_array(
    jsonb_build_object('sheet_name', 'funnel', 'row_number', 2, 'payload', jsonb_build_object(
      'date', '2026-08-10', 'wb_article', '100', 'position', 1, 'seller', 'Seller', 'brand', 'Brand',
      'ordered_amount', 1000, 'discounted_price', 100, 'buyer_median_price', 90, 'avg_search_position', 5,
      'impressions', 1000, 'clicks', 100, 'reported_ctr', 10, 'carts', 50,
      'reported_cart_conversion', 5, 'orders', 20, 'reported_order_conversion', 2, 'buyouts', 18,
      'reported_buyout_rate', 90
    )),
    jsonb_build_object('sheet_name', 'search', 'row_number', 2, 'payload', jsonb_build_object(
      'date', '2026-08-10', 'wb_article', '200', 'query', ' Люстра  Потолочная ', 'requests', 1000,
      'requests_previous', 900, 'reported_cart_conversion', 20, 'reported_cart_conversion_previous', 19,
      'reported_order_conversion', 131, 'reported_order_conversion_previous', 125
    )),
    jsonb_build_object('sheet_name', 'stocks', 'row_number', 2, 'payload', jsonb_build_object(
      'date', '2026-08-10', 'wb_article', '100', 'name', 'Product', 'subject', 'Subject', 'brand', 'Brand',
      'region', '', 'warehouse', 'Маркетплейс', 'stock', 50, 'in_transit_to_customer', 0,
      'in_transit_from_customer', 0, 'avg_daily_orders', 5
    )),
    jsonb_build_object('sheet_name', 'positions', 'row_number', 2, 'payload', jsonb_build_object(
      'date', '2026-08-11', 'wb_article', '100', 'position', 1, 'seller', 'Seller', 'brand', 'Brand'
    ))
  ));

  v_result := public.v5_competitor_publish_batch(v_batch_id);
  if v_result ->> 'status' <> 'published'
    or (v_result ->> 'accepted_rows')::integer <> 4
    or v_result ->> 'period_start' <> '2026-08-10'
    or v_result ->> 'period_end' <> '2026-08-11'
    or (v_result #>> '{section_counts,search}')::integer <> 1
  then raise exception 'Valid competitor publish failed: %', v_result; end if;

  insert into competitor_import_smoke_batches (label, batch_id) values ('valid', v_batch_id);
end
$$;

reset role;

do $$
declare
  v_valid_id uuid := (select batch_id from competitor_import_smoke_batches where label = 'valid');
begin
  if not exists (
    select 1 from analytics.competitor_search_versions row_data
    where row_data.batch_id = v_valid_id and row_data.normalized_query = 'люстра потолочная'
      and row_data.reported_order_conversion = 131
  ) then raise exception 'Server normalization or source percentage preservation failed'; end if;
end
$$;

set local role authenticated;

do $$
declare
  v_created jsonb;
  v_result jsonb;
  v_batch_id uuid;
begin
  v_created := public.v5_competitor_create_batch('__v5_competitor_invalid.xlsx', null, 512, repeat('d', 64));
  v_batch_id := (v_created ->> 'batch_id')::uuid;
  insert into storage.objects (bucket_id, name, owner_id)
  values ('v5-import-sources', v_created ->> 'object_path', auth.uid()::text);
  perform public.v5_competitor_stage_rows(v_batch_id, jsonb_build_array(
    jsonb_build_object('sheet_name', 'search', 'row_number', 2, 'payload', jsonb_build_object(
      'date', '2026-02-30', 'wb_article', '', 'query', '', 'requests', 1.5, 'requests_previous', -1,
      'reported_cart_conversion', -1, 'reported_cart_conversion_previous', 0,
      'reported_order_conversion', 0, 'reported_order_conversion_previous', 0
    ))
  ));
  v_result := public.v5_competitor_publish_batch(v_batch_id);
  if v_result ->> 'status' <> 'failed'
    or (v_result ->> 'error_count')::integer < 7
    or (public.v5_competitor_snapshot_bounds() ->> 'batch_id')::uuid
      <> (select batch_id from competitor_import_smoke_batches where label = 'valid')
  then raise exception 'Invalid competitor batch was not isolated: %', v_result; end if;
  insert into competitor_import_smoke_batches (label, batch_id) values ('invalid', v_batch_id);
end
$$;

do $$
declare
  v_result jsonb;
  v_valid_id uuid := (select batch_id from competitor_import_smoke_batches where label = 'valid');
begin
  v_result := public.v5_competitor_rollback_batch(v_valid_id, 'transactional smoke');
  if v_result ->> 'status' <> 'cancelled' or (v_result ->> 'version_rows')::integer <> 4 then
    raise exception 'Competitor rollback failed: %', v_result;
  end if;
end
$$;

select jsonb_build_object(
  'duplicate_file_reused', true,
  'retry_reset_retained_source', true,
  'four_sections_published_atomically', true,
  'search_percent_above_100_preserved', true,
  'invalid_batch_did_not_replace_snapshot', true,
  'published_batch_rolled_back', true,
  'transaction_will_rollback', true
) as competitors_import_smoke;

rollback;
