begin;

create temporary table funnel_smoke_ids (label text primary key, value uuid not null) on commit drop;
grant select, insert on funnel_smoke_ids to authenticated;

do $$
declare v_user_id uuid; v_cabinet_id uuid := gen_random_uuid();
begin
  select access.user_id into strict v_user_id from app.user_access access
  where access.access_role = 'admin' and access.is_active limit 1;
  perform set_config('request.jwt.claim.sub', v_user_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  insert into core.cabinets (id, external_key, name) values (v_cabinet_id, 'funnel-smoke', 'Funnel smoke');
  insert into funnel_smoke_ids values ('cabinet', v_cabinet_id);
end
$$;

set local role authenticated;

do $$
declare v_created jsonb; v_result jsonb; v_batch_id uuid;
  v_cabinet_id uuid := (select value from funnel_smoke_ids where label = 'cabinet');
begin
  v_created := public.v5_funnel_create_batch('wb_funnel', v_cabinet_id, '__funnel_wb.xlsx', null, 100, repeat('a', 64));
  v_batch_id := (v_created ->> 'batch_id')::uuid;
  insert into storage.objects (bucket_id, name, owner_id) values ('v5-import-sources', v_created ->> 'object_path', auth.uid()::text);
  perform public.v5_funnel_stage_rows(v_batch_id, jsonb_build_array(jsonb_build_object('row_number', 2, 'payload', jsonb_build_object(
    'date', '2026-08-01', 'seller_sku', 'FUNNEL-SKU.0', 'wb_sku', '990001',
    'impressions', 1000, 'clicks', 100, 'carts', 30, 'orders', 10, 'ordered_amount', 5000
  ))));
  v_result := public.v5_funnel_publish_batch(v_batch_id);
  if v_result ->> 'status' <> 'published' or (v_result ->> 'canonical_rows')::integer <> 1 then
    raise exception 'WB funnel publish failed: %', v_result;
  end if;
  insert into funnel_smoke_ids values ('wb_batch', v_batch_id);
end
$$;

do $$
declare v_created jsonb; v_result jsonb; v_batch_id uuid;
  v_cabinet_id uuid := (select value from funnel_smoke_ids where label = 'cabinet');
begin
  v_created := public.v5_funnel_create_batch('xway', v_cabinet_id, '__funnel_xway.xlsx', null, 100, repeat('b', 64));
  v_batch_id := (v_created ->> 'batch_id')::uuid;
  insert into storage.objects (bucket_id, name, owner_id) values ('v5-import-sources', v_created ->> 'object_path', auth.uid()::text);
  perform public.v5_funnel_stage_rows(v_batch_id, jsonb_build_array(jsonb_build_object('row_number', 2, 'payload', jsonb_build_object(
    'date', '2026-08-01', 'seller_sku', 'FUNNEL-SKU', 'wb_sku', '990001',
    'ad_impressions', 500, 'ad_clicks', 50, 'ad_orders_qty', 10, 'ad_ordered_amount', 1000, 'ad_spend', 200
  ))));
  v_result := public.v5_funnel_publish_batch(v_batch_id);
  if v_result ->> 'status' <> 'published' then raise exception 'XWay publish failed: %', v_result; end if;
  insert into funnel_smoke_ids values ('xway_batch', v_batch_id);
end
$$;

do $$
declare v_created jsonb; v_result jsonb; v_batch_id uuid;
  v_cabinet_id uuid := (select value from funnel_smoke_ids where label = 'cabinet');
begin
  v_created := public.v5_funnel_create_batch('xway', v_cabinet_id, '__funnel_xway_patch.xlsx', null, 100, repeat('c', 64));
  v_batch_id := (v_created ->> 'batch_id')::uuid;
  insert into storage.objects (bucket_id, name, owner_id) values ('v5-import-sources', v_created ->> 'object_path', auth.uid()::text);
  perform public.v5_funnel_stage_rows(v_batch_id, jsonb_build_array(jsonb_build_object('row_number', 2, 'payload', jsonb_build_object(
    'date', '2026-08-01', 'seller_sku', 'FUNNEL-SKU', 'ad_spend', 250
  ))));
  v_result := public.v5_funnel_publish_batch(v_batch_id);
  if v_result ->> 'status' <> 'published' then raise exception 'XWay partial patch failed: %', v_result; end if;
  insert into funnel_smoke_ids values ('patch_batch', v_batch_id);
end
$$;

reset role;

do $$
declare v_row record; v_current_count integer; v_filtered_count integer; v_product_count integer;
begin
  select * into strict v_row from app.v5_funnel_current(date '2026-08-01', date '2026-08-01');
  if v_row.impressions <> 1000 or v_row.orders <> 10 or v_row.ordered_amount <> 5000
    or v_row.ad_orders_qty <> 10 or v_row.ad_ordered_amount <> 1000 or v_row.ad_spend <> 250
    or v_row.ad_spend / nullif(v_row.ad_orders_qty, 0) <> 25
  then raise exception 'Nullable patch or corrected CPO assertion failed: %', row_to_json(v_row); end if;
  select count(*) into v_current_count from app.v5_funnel_current(date '2026-08-01', date '2026-08-01');
  select count(*) into v_filtered_count from app.v5_funnel_filtered(date '2026-08-01', date '2026-08-01');
  select count(*) into v_product_count from core.products product where product.cabinet_id = v_row.cabinet_id;
  if v_filtered_count <> 1 then raise exception 'Funnel enrichment failed: current %, filtered %, products %', v_current_count, v_filtered_count, v_product_count; end if;
end
$$;

set local role authenticated;

do $$
declare v_options jsonb; v_summary record; v_series record; v_row record;
begin
  if not app.can_access_cabinet((select value from funnel_smoke_ids where label = 'cabinet')) then
    raise exception 'Authenticated smoke administrator lost cabinet access';
  end if;
  v_options := public.v5_funnel_filter_options(date '2026-08-01', date '2026-08-01', 20);
  select * into strict v_summary from public.v5_funnel_summary(date '2026-08-01', date '2026-08-01');
  if v_summary.impressions <> 1000 or v_summary.orders <> 10 or v_summary.ordered_amount <> 5000
    or v_summary.ad_orders_qty <> 10 or v_summary.ad_ordered_amount <> 1000 or v_summary.ad_spend <> 250
    or v_summary.product_count <> 1 then raise exception 'Funnel summary failed: %', row_to_json(v_summary); end if;
  if jsonb_array_length(v_options -> 'cabinets') <> 1 then raise exception 'Funnel filter options failed: %, summary %', v_options, row_to_json(v_summary); end if;
  select * into strict v_series from public.v5_funnel_series(date '2026-08-01', date '2026-08-01');
  if v_series.period_date <> date '2026-08-01' or v_series.clicks <> 100 or v_series.ad_clicks <> 50 then
    raise exception 'Funnel series failed'; end if;
  select * into strict v_row from public.v5_funnel_rows(date '2026-08-01', date '2026-08-01',
    null, null, null, null, null, 'FUNNEL-SKU', 'cpo', 0, 10);
  if v_row.total_count <> 1 or v_row.orders <> 10 or v_row.ad_orders_qty <> 10 or v_row.ad_spend <> 250 then
    raise exception 'Funnel paginated rows failed'; end if;
end
$$;

do $$
declare v_created jsonb; v_result jsonb; v_batch_id uuid;
  v_cabinet_id uuid := (select value from funnel_smoke_ids where label = 'cabinet');
begin
  v_created := public.v5_funnel_create_batch('xway', v_cabinet_id, '__funnel_invalid.xlsx', null, 100, repeat('d', 64));
  v_batch_id := (v_created ->> 'batch_id')::uuid;
  insert into storage.objects (bucket_id, name, owner_id) values ('v5-import-sources', v_created ->> 'object_path', auth.uid()::text);
  perform public.v5_funnel_stage_rows(v_batch_id, jsonb_build_array(jsonb_build_object('row_number', 2, 'payload', jsonb_build_object(
    'date', '2026-02-30', 'seller_sku', 'INVALID-FUNNEL', 'ad_orders_qty', -1, 'ordered_amount', 500
  ))));
  v_result := public.v5_funnel_publish_batch(v_batch_id);
  if v_result ->> 'status' <> 'failed' or (v_result ->> 'error_count')::integer < 3 then
    raise exception 'Invalid funnel batch was accepted: %', v_result;
  end if;
  if exists (select 1 from core.products product where product.cabinet_id = v_cabinet_id and product.seller_sku = 'INVALID-FUNNEL') then
    raise exception 'Invalid funnel row created a product';
  end if;
end
$$;

do $$
declare v_result jsonb; v_batch_id uuid := (select value from funnel_smoke_ids where label = 'patch_batch');
begin
  v_result := public.v5_funnel_rollback_batch(v_batch_id, 'transactional smoke');
  if v_result ->> 'status' <> 'cancelled' or (v_result ->> 'version_rows')::integer <> 1 then
    raise exception 'Funnel rollback failed: %', v_result;
  end if;
end
$$;

reset role;

do $$
declare v_row record;
begin
  select * into strict v_row from app.v5_funnel_current(date '2026-08-01', date '2026-08-01');
  if v_row.ad_spend <> 200 or v_row.ad_orders_qty <> 10
    or v_row.ad_spend / nullif(v_row.ad_orders_qty, 0) <> 20
  then raise exception 'Rollback did not restore prior XWay version'; end if;
end
$$;

select jsonb_build_object(
  'source_fields_isolated', true,
  'nullable_patch_preserved', true,
  'cpo_uses_order_quantity', true,
  'bounded_read_api_verified', true,
  'invalid_rows_do_not_create_products', true,
  'rollback_restores_prior_patch', true,
  'transaction_will_rollback', true
) as funnel_smoke;

rollback;
