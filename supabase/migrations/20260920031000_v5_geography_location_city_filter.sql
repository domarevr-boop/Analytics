drop function if exists public.v5_geography_locations(date, date, text, text, uuid[], uuid[], text, text, integer, integer);

create or replace function public.v5_geography_locations(
  p_start date,
  p_end date,
  p_level text default 'region',
  p_fulfillment text default 'all',
  p_cabinet_ids uuid[] default null,
  p_product_ids uuid[] default null,
  p_region text default null,
  p_area text default null,
  p_city text default null,
  p_limit integer default 100,
  p_offset integer default 0
)
returns table (
  total_count bigint,
  region text,
  area text,
  city text,
  orders bigint,
  delivery_hours numeric,
  covered_orders bigint,
  product_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.v5_assert_geography_read(p_start, p_end, p_cabinet_ids, p_product_ids);
  if p_level not in ('region', 'area', 'city') then raise exception 'Geography level must be region, area or city'; end if;
  if p_fulfillment not in ('all', 'fbo', 'fbs') then raise exception 'Geography fulfillment must be all, fbo or fbs'; end if;
  if p_limit is null or p_limit < 1 or p_limit > 200 then raise exception 'Geography location limit must be between 1 and 200'; end if;
  if p_offset is null or p_offset < 0 or p_offset > 100000 then raise exception 'Geography location offset must be between 0 and 100000'; end if;

  return query
  with current_batches as (select * from app.v5_current_geography_batches()),
  base as (
    select row_data.*,
      case p_fulfillment when 'fbo' then row_data.wb_local_orders + row_data.wb_nonlocal_orders
        when 'fbs' then row_data.marketplace_local_orders + row_data.marketplace_nonlocal_orders
        else row_data.orders_total end as selected_orders
    from analytics.geography_order_versions row_data
    join current_batches batch on batch.batch_id = row_data.batch_id and batch.cabinet_id = row_data.cabinet_id
    where row_data.date between p_start and p_end
      and (p_cabinet_ids is null or row_data.cabinet_id = any(p_cabinet_ids))
      and (p_product_ids is null or row_data.product_id = any(p_product_ids))
      and (nullif(btrim(p_region), '') is null or row_data.normalized_region = p_region)
      and (nullif(btrim(p_area), '') is null or row_data.normalized_area = p_area)
      and (nullif(btrim(p_city), '') is null or row_data.normalized_city = p_city)
  ), grouped as (
    select base.normalized_region as region,
      case when p_level in ('area', 'city') then base.normalized_area else '' end as area,
      case when p_level = 'city' then base.normalized_city else '' end as city,
      sum(base.selected_orders)::bigint as orders,
      sum(base.delivery_hours * base.selected_orders) / nullif(sum(base.selected_orders) filter (where base.delivery_hours is not null), 0) as delivery_hours,
      coalesce(sum(base.selected_orders) filter (where base.delivery_hours is not null), 0)::bigint as covered_orders,
      count(distinct base.product_id)::bigint as product_count
    from base
    where (p_level <> 'area' or base.normalized_area <> 'Без региона')
      and (p_level <> 'city' or base.normalized_city <> 'Без населённого пункта')
    group by base.normalized_region,
      case when p_level in ('area', 'city') then base.normalized_area else '' end,
      case when p_level = 'city' then base.normalized_city else '' end
  )
  select count(*) over(), grouped.region, grouped.area, grouped.city, grouped.orders,
    grouped.delivery_hours, grouped.covered_orders, grouped.product_count
  from grouped
  order by grouped.orders desc, grouped.region, grouped.area, grouped.city
  limit p_limit offset p_offset;
end
$$;

revoke all on function public.v5_geography_locations(date, date, text, text, uuid[], uuid[], text, text, text, integer, integer) from public, anon;
grant execute on function public.v5_geography_locations(date, date, text, text, uuid[], uuid[], text, text, text, integer, integer) to authenticated;
