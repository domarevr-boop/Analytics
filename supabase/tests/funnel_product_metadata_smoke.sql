begin;

do $$
declare v_user_id uuid; v_cabinet_id uuid := gen_random_uuid();
  v_created jsonb; v_result jsonb; v_batch_id uuid;
  v_product_name text; v_category_name text; v_brand_name text;
begin
  select access.user_id into strict v_user_id from app.user_access access
  where access.access_role = 'admin' and access.is_active limit 1;
  perform set_config('request.jwt.claim.sub', v_user_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  insert into core.cabinets (id, external_key, name)
  values (v_cabinet_id, 'funnel-metadata-smoke', 'Funnel metadata smoke');
  v_created := public.v5_funnel_create_batch('wb_funnel', v_cabinet_id,
    '__funnel_metadata.xlsx', null, 100, repeat('d', 64));
  v_batch_id := (v_created ->> 'batch_id')::uuid;
  insert into storage.objects (bucket_id, name, owner_id)
  values ('v5-import-sources', v_created ->> 'object_path', auth.uid()::text);
  perform public.v5_funnel_stage_rows(v_batch_id, jsonb_build_array(jsonb_build_object(
    'row_number', 2, 'payload', jsonb_build_object(
      'date', '2026-09-24', 'seller_sku', '49999', 'wb_sku', '990002',
      'product_name', 'Люстра для теста', 'category_name', 'Люстры', 'brand_name', 'LEDCITY',
      'impressions', 100, 'clicks', 10, 'carts', 2, 'orders', 1, 'ordered_amount', 1000
    )
  )));
  v_result := public.v5_funnel_publish_batch(v_batch_id);
  if v_result ->> 'status' <> 'published' then raise exception 'Metadata source batch was not published'; end if;

  select product.name, category.name, brand.name
  into v_product_name, v_category_name, v_brand_name
  from core.products product
    left join core.categories category on category.id = product.category_id
    left join core.brands brand on brand.id = product.brand_id
  where product.cabinet_id = v_cabinet_id and product.seller_sku = '49999';
  if v_product_name <> 'Люстра для теста' or v_category_name <> 'Люстры' or v_brand_name <> 'LEDCITY' then
    raise exception 'Published report metadata did not enrich the directory';
  end if;
  raise notice 'funnel_product_metadata_enriched';
end
$$;

rollback;
