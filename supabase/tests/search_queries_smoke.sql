begin;

do $$
declare
  v_user_id uuid;
  v_batch jsonb;
  v_batch_id uuid;
  v_result jsonb;
  v_summary jsonb;
  v_rows integer;
begin
  select user_id into v_user_id from app.user_access where is_active and access_role = 'admin' limit 1;
  if v_user_id is null then raise exception 'Search queries smoke requires an existing V5 administrator'; end if;
  perform set_config('request.jwt.claim.sub', v_user_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  v_batch := public.v5_search_queries_create_batch('search-smoke.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 1024,
    encode(extensions.digest(gen_random_uuid()::text, 'sha256'), 'hex'));
  v_batch_id := (v_batch ->> 'batch_id')::uuid;
  insert into storage.objects (bucket_id, name, owner_id)
  values ('v5-import-sources', v_batch ->> 'object_path', v_user_id::text);

  perform public.v5_search_queries_stage_rows(v_batch_id, jsonb_build_array(
    jsonb_build_object('row_number', 2, 'payload', jsonb_build_object(
      'date', '2026-07-19', 'query', 'платье', 'category', 'Платья',
      'requests', 100, 'requests_previous', 80, 'avg_daily_requests', 14.3, 'avg_daily_requests_previous', 11.4,
      'card_clicks', 40, 'card_clicks_previous', 30, 'carts', 20, 'carts_previous', 12,
      'cart_conversion', 50, 'cart_conversion_previous', 40, 'orders', 10, 'orders_previous', 5,
      'order_conversion', 50, 'order_conversion_previous', 41.67,
      'ordered_subjects', 2, 'ordered_subjects_previous', 1, 'products', 500, 'products_previous', 450
    )),
    jsonb_build_object('row_number', 3, 'payload', jsonb_build_object(
      'date', '2026-07-20', 'query', 'платье', 'category', 'Платья',
      'requests', 120, 'requests_previous', 100, 'avg_daily_requests', 17.1, 'avg_daily_requests_previous', 14.3,
      'card_clicks', 60, 'card_clicks_previous', 40, 'carts', 30, 'carts_previous', 20,
      'cart_conversion', 50, 'cart_conversion_previous', 50, 'orders', 15, 'orders_previous', 10,
      'order_conversion', 50, 'order_conversion_previous', 50,
      'ordered_subjects', 3, 'ordered_subjects_previous', 2, 'products', 520, 'products_previous', 500
    ))
  ));
  v_result := public.v5_search_queries_publish_batch(v_batch_id);
  if v_result ->> 'status' <> 'published' or (v_result ->> 'canonical_rows')::integer <> 2 then
    raise exception 'search_queries_publish_failed';
  end if;
  v_summary := public.v5_search_queries_summary('2026-07-19', '2026-07-20', 'Платья', null);
  if (v_summary ->> 'requests')::bigint <> 220 or (v_summary ->> 'orders')::bigint <> 25 then
    raise exception 'search_queries_summary_formula_failed';
  end if;
  select count(*) into v_rows from public.v5_search_queries_rows('2026-07-19', '2026-07-20', 'Платья', null, 'opportunity', 0, 50);
  if v_rows <> 1 then raise exception 'search_queries_bounded_rows_failed'; end if;
  perform public.v5_search_queries_rollback_batch(v_batch_id, 'transaction_will_rollback');
  if exists (select 1 from analytics.search_queries_current where date between '2026-07-19' and '2026-07-20' and query = 'платье' and category = 'Платья' and batch_id = v_batch_id) then
    raise exception 'search_queries_rollback_failed';
  end if;
end
$$;

rollback;
