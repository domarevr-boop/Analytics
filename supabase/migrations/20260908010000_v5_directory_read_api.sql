begin;

create or replace function public.v5_directory_snapshot(
  p_as_of date,
  p_cabinet_id uuid default null,
  p_search text default null,
  p_limit integer default 100,
  p_offset integer default 0
)
returns table (
  total_count bigint,
  product_id uuid,
  cabinet_id uuid,
  cabinet_external_key text,
  cabinet_name text,
  product_external_key text,
  seller_sku text,
  wb_sku text,
  product_name text,
  product_status text,
  category_id uuid,
  category_external_key text,
  category_name text,
  brand_id uuid,
  brand_external_key text,
  brand_name text,
  group_known boolean,
  group_id uuid,
  group_external_key text,
  group_name text,
  is_ungrouped boolean,
  group_effective_date date
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not app.can_read() then
    raise exception 'V5 read access is required';
  end if;
  if p_as_of is null then
    raise exception 'Directory snapshot date is required';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 500 then
    raise exception 'Directory snapshot limit must be between 1 and 500';
  end if;
  if p_offset is null or p_offset < 0 or p_offset > 100000 then
    raise exception 'Directory snapshot offset must be between 0 and 100000';
  end if;
  if p_search is not null and length(p_search) > 100 then
    raise exception 'Directory snapshot search must not exceed 100 characters';
  end if;
  if p_cabinet_id is not null and not app.can_access_cabinet(p_cabinet_id) then
    raise exception 'Cabinet is not available';
  end if;

  return query
  with visible_products as (
    select
      product.id,
      product.cabinet_id,
      product.external_key,
      product.seller_sku,
      product.wb_sku,
      product.name,
      product.status,
      product.category_id,
      product.brand_id
    from core.products product
    where app.can_access_cabinet(product.cabinet_id)
      and (p_cabinet_id is null or product.cabinet_id = p_cabinet_id)
      and (
        nullif(btrim(p_search), '') is null
        or product.name ilike '%' || btrim(p_search) || '%'
        or product.seller_sku ilike '%' || btrim(p_search) || '%'
        or product.wb_sku ilike '%' || btrim(p_search) || '%'
        or exists (
          select 1
          from core.product_aliases alias
          where alias.product_id = product.id
            and alias.alias_value ilike '%' || btrim(p_search) || '%'
        )
      )
  )
  select
    count(*) over() as total_count,
    product.id as product_id,
    product.cabinet_id,
    cabinet.external_key as cabinet_external_key,
    cabinet.name as cabinet_name,
    product.external_key as product_external_key,
    product.seller_sku,
    product.wb_sku,
    product.name as product_name,
    product.status as product_status,
    category.id as category_id,
    category.external_key as category_external_key,
    category.name as category_name,
    brand.id as brand_id,
    brand.external_key as brand_external_key,
    brand.name as brand_name,
    membership.id is not null as group_known,
    product_group.id as group_id,
    product_group.external_key as group_external_key,
    product_group.name as group_name,
    coalesce(product_group.is_ungrouped, false) as is_ungrouped,
    membership.effective_date as group_effective_date
  from visible_products product
  join core.cabinets cabinet on cabinet.id = product.cabinet_id
  left join core.categories category on category.id = product.category_id
  left join core.brands brand on brand.id = product.brand_id
  left join lateral (
    select version.id, version.group_id, version.effective_date
    from core.group_membership_versions version
    where version.product_id = product.id
      and version.effective_date <= p_as_of
    order by version.effective_date desc, version.id desc
    limit 1
  ) membership on true
  left join core.product_groups product_group on product_group.id = membership.group_id
  order by cabinet.name, product.name, product.id
  limit p_limit
  offset p_offset;
end
$$;

revoke all on function public.v5_directory_snapshot(date, uuid, text, integer, integer) from public, anon;
grant execute on function public.v5_directory_snapshot(date, uuid, text, integer, integer) to authenticated;

create or replace function public.v5_directory_filters()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if auth.uid() is null or not app.can_read() then
    raise exception 'V5 read access is required';
  end if;

  select jsonb_build_object(
    'cabinets', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', cabinet.id,
        'external_key', cabinet.external_key,
        'name', cabinet.name
      ) order by cabinet.name)
      from core.cabinets cabinet
      where cabinet.is_active
        and app.can_access_cabinet(cabinet.id)
    ), '[]'::jsonb),
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', category.id,
        'external_key', category.external_key,
        'name', category.name
      ) order by category.name)
      from core.categories category
      where category.is_active
        and exists (
          select 1
          from core.products product
          where product.category_id = category.id
            and app.can_access_cabinet(product.cabinet_id)
        )
    ), '[]'::jsonb),
    'brands', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', brand.id,
        'external_key', brand.external_key,
        'name', brand.name
      ) order by brand.name)
      from core.brands brand
      where brand.is_active
        and exists (
          select 1
          from core.products product
          where product.brand_id = brand.id
            and app.can_access_cabinet(product.cabinet_id)
        )
    ), '[]'::jsonb)
  )
  into v_result;

  return v_result;
end
$$;

revoke all on function public.v5_directory_filters() from public, anon;
grant execute on function public.v5_directory_filters() to authenticated;

create or replace function public.v5_health()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'environment', 'analytics-v5',
    'schema_version', '20260908010000',
    'status', 'ok'
  )
$$;

revoke all on function public.v5_health() from public;
grant execute on function public.v5_health() to anon, authenticated;

comment on function public.v5_directory_snapshot(date, uuid, text, integer, integer) is 'Returns a bounded cabinet-authorized product page with the last known dated group membership as of the requested date.';

commit;
