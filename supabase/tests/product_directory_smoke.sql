begin;

do $$
declare
  v_user_id uuid;
  v_cabinet_id uuid := gen_random_uuid();
  v_product_id uuid := gen_random_uuid();
  v_group_a uuid := gen_random_uuid();
  v_group_b uuid := gen_random_uuid();
  v_ungrouped uuid := gen_random_uuid();
  v_result jsonb;
begin
  select access.user_id
  into v_user_id
  from app.user_access access
  where access.access_role = 'admin'
    and access.is_active
  order by access.created_at
  limit 1;

  if v_user_id is null then
    raise exception 'Product directory smoke requires the bootstrapped V5 admin';
  end if;

  perform set_config('request.jwt.claim.sub', v_user_id::text, true);

  insert into core.cabinets (id, external_key, name)
  values (v_cabinet_id, '__v5_directory_smoke__', 'V5 directory smoke');

  insert into core.products (id, cabinet_id, external_key, seller_sku, wb_sku, name)
  values (v_product_id, v_cabinet_id, '__v5_directory_product__', 'SKU-SMOKE', '900000001', 'Smoke product');

  insert into core.product_aliases (product_id, cabinet_id, alias_value, alias_type)
  values (v_product_id, v_cabinet_id, 'SKU-SMOKE-OLD', 'historical');

  insert into core.product_groups (id, cabinet_id, external_key, name, is_ungrouped)
  values
    (v_group_a, v_cabinet_id, 'SMOKE-A', 'Smoke group A', false),
    (v_group_b, v_cabinet_id, 'SMOKE-B', 'Smoke group B', false),
    (v_ungrouped, v_cabinet_id, '__ungrouped__', 'Без склейки', true);

  insert into core.group_membership_versions (product_id, cabinet_id, effective_date, group_id, source, created_by)
  values
    (v_product_id, v_cabinet_id, date '2026-08-25', v_group_a, 'import', v_user_id),
    (v_product_id, v_cabinet_id, date '2026-08-28', v_group_b, 'import', v_user_id),
    (v_product_id, v_cabinet_id, date '2026-08-30', v_ungrouped, 'import', v_user_id);

  v_result := public.v5_group_membership_at(v_product_id, date '2026-08-24');
  if (v_result ->> 'known')::boolean then
    raise exception 'State before the first group row must be unknown: %', v_result;
  end if;

  v_result := public.v5_group_membership_at(v_product_id, date '2026-08-27');
  if (v_result ->> 'group_id')::uuid <> v_group_a or (v_result ->> 'effective_date')::date <> date '2026-08-25' then
    raise exception 'Last-known group resolution failed: %', v_result;
  end if;

  v_result := public.v5_group_membership_at(v_product_id, date '2026-08-29');
  if (v_result ->> 'group_id')::uuid <> v_group_b then
    raise exception 'Group transition resolution failed: %', v_result;
  end if;

  v_result := public.v5_group_membership_at(v_product_id, date '2026-08-31');
  if not (v_result ->> 'known')::boolean or not (v_result ->> 'is_ungrouped')::boolean then
    raise exception 'Explicit ungrouped state must remain known: %', v_result;
  end if;
end
$$;

select jsonb_build_object(
  'cabinet_scoped_products', true,
  'cabinet_scoped_aliases', true,
  'unknown_before_first_membership', true,
  'last_known_membership_applied', true,
  'explicit_ungrouped_distinct', true,
  'transaction_will_rollback', true
) as product_directory_smoke;

rollback;
