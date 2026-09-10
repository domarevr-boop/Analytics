begin;

create or replace function app.v5_current_geography_batches()
returns table (batch_id uuid, cabinet_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select selected.id, selected.cabinet_id
  from (
    select distinct on (batch.cabinet_id) batch.id, batch.cabinet_id
    from ingest.import_batches batch
    where batch.source_code = 'geography'
      and batch.status = 'published'
      and batch.cabinet_id is not null
      and app.can_access_cabinet(batch.cabinet_id)
    order by batch.cabinet_id, batch.published_at desc nulls last, batch.id desc
  ) selected
$$;

revoke all on function app.v5_current_geography_batches() from public, anon, authenticated;

create or replace function app.v5_assert_geography_read(
  p_start date,
  p_end date,
  p_cabinet_ids uuid[] default null,
  p_product_ids uuid[] default null
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not app.can_read() then raise exception 'V5 read access is required'; end if;
  if p_start is null or p_end is null or p_end < p_start or p_end - p_start > 731 then
    raise exception 'Geography range is invalid or exceeds 731 days';
  end if;
  if coalesce(cardinality(p_cabinet_ids), 0) > 100 then raise exception 'At most 100 cabinets are allowed'; end if;
  if coalesce(cardinality(p_product_ids), 0) > 500 then raise exception 'At most 500 products are allowed'; end if;
  if exists (select 1 from unnest(coalesce(p_cabinet_ids, array[]::uuid[])) cabinet_id where not app.can_access_cabinet(cabinet_id)) then
    raise exception 'One or more requested cabinets are not accessible';
  end if;
end
$$;

revoke all on function app.v5_assert_geography_read(date, date, uuid[], uuid[]) from public, anon, authenticated;

create or replace function public.v5_geography_filter_options(
  p_start date,
  p_end date,
  p_region text default null,
  p_area text default null,
  p_limit integer default 500
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  perform app.v5_assert_geography_read(p_start, p_end, null, null);
  if p_limit is null or p_limit < 1 or p_limit > 500 then raise exception 'Geography filter limit must be between 1 and 500'; end if;
  if length(coalesce(p_region, '')) > 1000 or length(coalesce(p_area, '')) > 1000 then
    raise exception 'Geography filter value must not exceed 1000 characters';
  end if;

  with current_batches as (select * from app.v5_current_geography_batches()),
  base as (
    select row_data.*
    from analytics.geography_order_versions row_data
    join current_batches batch on batch.batch_id = row_data.batch_id and batch.cabinet_id = row_data.cabinet_id
    where row_data.date between p_start and p_end
  )
  select jsonb_build_object(
    'min_date', min(base.date),
    'max_date', max(base.date),
    'cabinet_count', count(distinct base.cabinet_id),
    'product_count', count(distinct base.product_id),
    'regions', coalesce((select jsonb_agg(item.value order by item.value) from
      (select distinct source.normalized_region as value from base source order by value limit p_limit) item), '[]'::jsonb),
    'areas', coalesce((select jsonb_agg(item.value order by item.value) from
      (select distinct source.normalized_area as value from base source
       where source.normalized_area <> 'Без региона'
         and (nullif(btrim(p_region), '') is null or source.normalized_region = p_region)
       order by value limit p_limit) item), '[]'::jsonb),
    'cities', coalesce((select jsonb_agg(item.value order by item.value) from
      (select distinct source.normalized_city as value from base source
       where source.normalized_city <> 'Без населённого пункта'
         and (nullif(btrim(p_region), '') is null or source.normalized_region = p_region)
         and (nullif(btrim(p_area), '') is null or source.normalized_area = p_area)
       order by value limit p_limit) item), '[]'::jsonb)
  ) into v_result from base;
  return v_result;
end
$$;

revoke all on function public.v5_geography_filter_options(date, date, text, text, integer) from public, anon;
grant execute on function public.v5_geography_filter_options(date, date, text, text, integer) to authenticated;

create or replace function public.v5_geography_summary(
  p_start date,
  p_end date,
  p_cabinet_ids uuid[] default null,
  p_product_ids uuid[] default null,
  p_region text default null,
  p_area text default null,
  p_city text default null
)
returns table (
  fulfillment text,
  orders bigint,
  delivery_hours numeric,
  covered_orders bigint,
  row_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.v5_assert_geography_read(p_start, p_end, p_cabinet_ids, p_product_ids);
  return query
  with current_batches as (select * from app.v5_current_geography_batches()),
  base as (
    select row_data.*
    from analytics.geography_order_versions row_data
    join current_batches batch on batch.batch_id = row_data.batch_id and batch.cabinet_id = row_data.cabinet_id
    where row_data.date between p_start and p_end
      and (p_cabinet_ids is null or row_data.cabinet_id = any(p_cabinet_ids))
      and (p_product_ids is null or row_data.product_id = any(p_product_ids))
      and (nullif(btrim(p_region), '') is null or row_data.normalized_region = p_region)
      and (nullif(btrim(p_area), '') is null or row_data.normalized_area = p_area)
      and (nullif(btrim(p_city), '') is null or row_data.normalized_city = p_city)
  ), expanded as (
    select scope.fulfillment, base.delivery_hours,
      case scope.fulfillment
        when 'fbo' then base.wb_local_orders + base.wb_nonlocal_orders
        when 'fbs' then base.marketplace_local_orders + base.marketplace_nonlocal_orders
        else base.orders_total
      end as selected_orders
    from base cross join (values ('all'), ('fbo'), ('fbs')) scope(fulfillment)
  )
  select expanded.fulfillment,
    coalesce(sum(expanded.selected_orders), 0)::bigint,
    sum(expanded.delivery_hours * expanded.selected_orders) / nullif(sum(expanded.selected_orders) filter (where expanded.delivery_hours is not null), 0),
    coalesce(sum(expanded.selected_orders) filter (where expanded.delivery_hours is not null), 0)::bigint,
    count(*)::bigint
  from expanded
  group by expanded.fulfillment
  order by case expanded.fulfillment when 'all' then 1 when 'fbo' then 2 else 3 end;
end
$$;

revoke all on function public.v5_geography_summary(date, date, uuid[], uuid[], text, text, text) from public, anon;
grant execute on function public.v5_geography_summary(date, date, uuid[], uuid[], text, text, text) to authenticated;

create or replace function public.v5_geography_series(
  p_start date,
  p_end date,
  p_cabinet_ids uuid[] default null,
  p_product_ids uuid[] default null,
  p_region text default null,
  p_area text default null,
  p_city text default null
)
returns table (
  period_date date,
  all_orders bigint,
  fbo_orders bigint,
  fbs_orders bigint,
  all_delivery_hours numeric,
  fbo_delivery_hours numeric,
  fbs_delivery_hours numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.v5_assert_geography_read(p_start, p_end, p_cabinet_ids, p_product_ids);
  return query
  with current_batches as (select * from app.v5_current_geography_batches()),
  base as (
    select row_data.*,
      row_data.wb_local_orders + row_data.wb_nonlocal_orders as fbo,
      row_data.marketplace_local_orders + row_data.marketplace_nonlocal_orders as fbs
    from analytics.geography_order_versions row_data
    join current_batches batch on batch.batch_id = row_data.batch_id and batch.cabinet_id = row_data.cabinet_id
    where row_data.date between p_start and p_end
      and (p_cabinet_ids is null or row_data.cabinet_id = any(p_cabinet_ids))
      and (p_product_ids is null or row_data.product_id = any(p_product_ids))
      and (nullif(btrim(p_region), '') is null or row_data.normalized_region = p_region)
      and (nullif(btrim(p_area), '') is null or row_data.normalized_area = p_area)
      and (nullif(btrim(p_city), '') is null or row_data.normalized_city = p_city)
  )
  select base.date,
    sum(base.orders_total)::bigint, sum(base.fbo)::bigint, sum(base.fbs)::bigint,
    sum(base.delivery_hours * base.orders_total) / nullif(sum(base.orders_total) filter (where base.delivery_hours is not null), 0),
    sum(base.delivery_hours * base.fbo) / nullif(sum(base.fbo) filter (where base.delivery_hours is not null), 0),
    sum(base.delivery_hours * base.fbs) / nullif(sum(base.fbs) filter (where base.delivery_hours is not null), 0)
  from base group by base.date order by base.date;
end
$$;

revoke all on function public.v5_geography_series(date, date, uuid[], uuid[], text, text, text) from public, anon;
grant execute on function public.v5_geography_series(date, date, uuid[], uuid[], text, text, text) to authenticated;

create or replace function public.v5_geography_locations(
  p_start date,
  p_end date,
  p_level text default 'region',
  p_fulfillment text default 'all',
  p_cabinet_ids uuid[] default null,
  p_product_ids uuid[] default null,
  p_region text default null,
  p_area text default null,
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

revoke all on function public.v5_geography_locations(date, date, text, text, uuid[], uuid[], text, text, integer, integer) from public, anon;
grant execute on function public.v5_geography_locations(date, date, text, text, uuid[], uuid[], text, text, integer, integer) to authenticated;

create or replace function public.v5_geography_product_leaders(
  p_start date,
  p_end date,
  p_fulfillment text default 'all',
  p_region text default null,
  p_area text default null,
  p_city text default null,
  p_limit integer default 20
)
returns table (
  product_id uuid,
  cabinet_id uuid,
  seller_sku text,
  wb_sku text,
  product_name text,
  orders bigint,
  delivery_hours numeric,
  covered_orders bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.v5_assert_geography_read(p_start, p_end, null, null);
  if p_fulfillment not in ('all', 'fbo', 'fbs') then raise exception 'Geography fulfillment must be all, fbo or fbs'; end if;
  if p_limit is null or p_limit < 1 or p_limit > 100 then raise exception 'Geography product limit must be between 1 and 100'; end if;
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
      and (nullif(btrim(p_region), '') is null or row_data.normalized_region = p_region)
      and (nullif(btrim(p_area), '') is null or row_data.normalized_area = p_area)
      and (nullif(btrim(p_city), '') is null or row_data.normalized_city = p_city)
  )
  select product.id, product.cabinet_id, product.seller_sku, product.wb_sku, product.name,
    sum(base.selected_orders)::bigint,
    sum(base.delivery_hours * base.selected_orders) / nullif(sum(base.selected_orders) filter (where base.delivery_hours is not null), 0),
    coalesce(sum(base.selected_orders) filter (where base.delivery_hours is not null), 0)::bigint
  from base join core.products product on product.id = base.product_id and product.cabinet_id = base.cabinet_id
  group by product.id, product.cabinet_id, product.seller_sku, product.wb_sku, product.name
  order by sum(base.selected_orders) desc, product.id
  limit p_limit;
end
$$;

revoke all on function public.v5_geography_product_leaders(date, date, text, text, text, text, integer) from public, anon;
grant execute on function public.v5_geography_product_leaders(date, date, text, text, text, text, integer) to authenticated;

create or replace function public.v5_health()
returns jsonb language sql stable security invoker set search_path = ''
as $$ select jsonb_build_object('environment', 'analytics-v5', 'schema_version', '20260910018000', 'status', 'ok') $$;

revoke all on function public.v5_health() from public;
grant execute on function public.v5_health() to anon, authenticated;

commit;
