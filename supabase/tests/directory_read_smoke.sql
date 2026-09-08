begin;

do $$
declare
  v_user_id uuid;
  v_cabinet_id uuid := gen_random_uuid();
  v_product_id uuid := gen_random_uuid();
  v_group_id uuid := gen_random_uuid();
  v_row record;
  v_filters jsonb;
begin
  select access.user_id
  into v_user_id
  from app.user_access access
  where access.access_role = 'admin'
    and access.is_active
  order by access.created_at
  limit 1;

  if v_user_id is null then
    raise exception 'Directory read smoke requires the bootstrapped V5 admin';
  end if;

  perform set_config('request.jwt.claim.sub', v_user_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  insert into core.cabinets (id, external_key, name)
  values (v_cabinet_id, '__v5_directory_read_cabinet__', 'Directory read cabinet');

  insert into core.products (id, cabinet_id, external_key, seller_sku, wb_sku, name)
  values (v_product_id, v_cabinet_id, '__v5_directory_read_product__', 'READ-SKU', '980000001', 'Directory read product');

  insert into core.product_aliases (product_id, cabinet_id, alias_value, alias_type)
  values (v_product_id, v_cabinet_id, 'READ-SKU-OLD', 'historical');

  insert into core.product_groups (id, cabinet_id, external_key, name)
  values (v_group_id, v_cabinet_id, '__v5_directory_read_group__', 'Directory read group');

  insert into core.group_membership_versions (product_id, cabinet_id, effective_date, group_id, source, created_by)
  values (v_product_id, v_cabinet_id, date '2026-08-25', v_group_id, 'manual', v_user_id);

  select *
  into strict v_row
  from public.v5_directory_snapshot(date '2026-08-24', v_cabinet_id, 'READ-SKU-OLD', 10, 0);

  if v_row.product_id <> v_product_id or v_row.group_known or v_row.total_count <> 1 then
    raise exception 'Directory snapshot before first membership failed';
  end if;

  select *
  into strict v_row
  from public.v5_directory_snapshot(date '2026-08-25', v_cabinet_id, '980000001', 10, 0);

  if not v_row.group_known
    or v_row.group_id <> v_group_id
    or v_row.group_effective_date <> date '2026-08-25'
  then
    raise exception 'Directory snapshot dated membership failed';
  end if;

  v_filters := public.v5_directory_filters();
  if not exists (
    select 1
    from jsonb_array_elements(v_filters -> 'cabinets') item
    where item ->> 'external_key' = '__v5_directory_read_cabinet__'
  ) then
    raise exception 'Directory filter dimensions omitted an accessible cabinet';
  end if;
end
$$;

select jsonb_build_object(
  'bounded_snapshot', true,
  'alias_search', true,
  'unknown_before_first_membership', true,
  'dated_membership_resolved', true,
  'authorized_filter_dimensions', true,
  'transaction_will_rollback', true
) as directory_read_smoke;

rollback;
