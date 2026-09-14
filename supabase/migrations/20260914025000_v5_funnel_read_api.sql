begin;

create or replace function app.v5_assert_funnel_read(
  p_start date,
  p_end date,
  p_cabinet_ids uuid[] default null,
  p_product_ids uuid[] default null,
  p_category_ids uuid[] default null,
  p_brand_ids uuid[] default null,
  p_group_ids uuid[] default null,
  p_search text default null
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
    raise exception 'Funnel range is invalid or exceeds 731 days';
  end if;
  if coalesce(cardinality(p_cabinet_ids), 0) > 100 or coalesce(cardinality(p_category_ids), 0) > 100
    or coalesce(cardinality(p_brand_ids), 0) > 100 then raise exception 'Funnel directory filter is too large'; end if;
  if coalesce(cardinality(p_product_ids), 0) > 500 or coalesce(cardinality(p_group_ids), 0) > 500 then
    raise exception 'Funnel product or group filter is too large';
  end if;
  if length(coalesce(p_search, '')) > 100 then raise exception 'Funnel search must not exceed 100 characters'; end if;
  if exists (select 1 from unnest(coalesce(p_cabinet_ids, array[]::uuid[])) cabinet_id where not app.can_access_cabinet(cabinet_id)) then
    raise exception 'One or more requested cabinets are not accessible';
  end if;
end
$$;

revoke all on function app.v5_assert_funnel_read(date, date, uuid[], uuid[], uuid[], uuid[], uuid[], text) from public, anon, authenticated;

create or replace function app.v5_funnel_filtered(
  p_start date,
  p_end date,
  p_cabinet_ids uuid[] default null,
  p_product_ids uuid[] default null,
  p_category_ids uuid[] default null,
  p_brand_ids uuid[] default null,
  p_group_ids uuid[] default null,
  p_search text default null
)
returns table (
  date date,
  product_id uuid,
  cabinet_id uuid,
  cabinet_name text,
  category_id uuid,
  category_name text,
  brand_id uuid,
  brand_name text,
  group_id uuid,
  group_name text,
  seller_sku text,
  wb_sku text,
  product_name text,
  impressions bigint,
  clicks bigint,
  carts bigint,
  orders bigint,
  ordered_amount numeric,
  ad_impressions bigint,
  ad_clicks bigint,
  ad_orders_qty bigint,
  ad_ordered_amount numeric,
  ad_spend numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.v5_assert_funnel_read(p_start, p_end, p_cabinet_ids, p_product_ids, p_category_ids, p_brand_ids, p_group_ids, p_search);
  return query
  select metric.date, metric.product_id, metric.cabinet_id, cabinet.name,
    product.category_id, category.name, product.brand_id, brand.name,
    membership.group_id, product_group.name, product.seller_sku, product.wb_sku, product.name,
    coalesce(metric.impressions, 0), coalesce(metric.clicks, 0), coalesce(metric.carts, 0),
    coalesce(metric.orders, 0), coalesce(metric.ordered_amount, 0),
    coalesce(metric.ad_impressions, 0), coalesce(metric.ad_clicks, 0), coalesce(metric.ad_orders_qty, 0),
    coalesce(metric.ad_ordered_amount, 0), coalesce(metric.ad_spend, 0)
  from app.v5_funnel_current(p_start, p_end) metric
  join core.products product on product.id = metric.product_id and product.cabinet_id = metric.cabinet_id
  join core.cabinets cabinet on cabinet.id = metric.cabinet_id
  left join core.categories category on category.id = product.category_id
  left join core.brands brand on brand.id = product.brand_id
  left join lateral (
    select version.group_id from core.group_membership_versions version
    where version.product_id = metric.product_id and version.effective_date <= metric.date
    order by version.effective_date desc, version.id desc limit 1
  ) membership on true
  left join core.product_groups product_group on product_group.id = membership.group_id
  where (p_cabinet_ids is null or metric.cabinet_id = any(p_cabinet_ids))
    and (p_product_ids is null or metric.product_id = any(p_product_ids))
    and (p_category_ids is null or product.category_id = any(p_category_ids))
    and (p_brand_ids is null or product.brand_id = any(p_brand_ids))
    and (p_group_ids is null or membership.group_id = any(p_group_ids))
    and (nullif(btrim(p_search), '') is null or product.name ilike '%' || btrim(p_search) || '%'
      or product.seller_sku ilike '%' || btrim(p_search) || '%' or product.wb_sku ilike '%' || btrim(p_search) || '%'
      or exists (select 1 from core.product_aliases alias where alias.product_id = product.id and alias.alias_value ilike '%' || btrim(p_search) || '%'));
end
$$;

revoke all on function app.v5_funnel_filtered(date, date, uuid[], uuid[], uuid[], uuid[], uuid[], text) from public, anon, authenticated;

create or replace function public.v5_funnel_bounds()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_result jsonb;
begin
  if auth.uid() is null or not app.can_read() then raise exception 'V5 read access is required'; end if;
  select jsonb_build_object('min_date', min(version.date), 'max_date', max(version.date)) into v_result
  from analytics.funnel_metric_versions version join ingest.import_batches batch on batch.id = version.batch_id
  where batch.status = 'published' and app.can_access_cabinet(version.cabinet_id);
  return v_result;
end
$$;

revoke all on function public.v5_funnel_bounds() from public, anon;
grant execute on function public.v5_funnel_bounds() to authenticated;

create or replace function public.v5_funnel_filter_options(p_start date, p_end date, p_limit integer default 500)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_result jsonb;
begin
  perform app.v5_assert_funnel_read(p_start, p_end, null, null, null, null, null, null);
  if p_limit is null or p_limit < 1 or p_limit > 500 then raise exception 'Funnel filter limit must be between 1 and 500'; end if;
  with base as (select * from app.v5_funnel_filtered(p_start, p_end)),
  cabinets as (select distinct base.cabinet_id as id, base.cabinet_name as name from base order by name, id limit p_limit),
  categories as (select distinct base.category_id as id, base.category_name as name from base where base.category_id is not null order by name, id limit p_limit),
  brands as (select distinct base.brand_id as id, base.brand_name as name from base where base.brand_id is not null order by name, id limit p_limit),
  groups as (select distinct base.group_id as id, base.group_name as name from base where base.group_id is not null order by name, id limit p_limit)
  select jsonb_build_object(
    'cabinets', coalesce((select jsonb_agg(jsonb_build_object('id', item.id, 'name', item.name) order by item.name, item.id) from cabinets item), '[]'::jsonb),
    'categories', coalesce((select jsonb_agg(jsonb_build_object('id', item.id, 'name', item.name) order by item.name, item.id) from categories item), '[]'::jsonb),
    'brands', coalesce((select jsonb_agg(jsonb_build_object('id', item.id, 'name', item.name) order by item.name, item.id) from brands item), '[]'::jsonb),
    'groups', coalesce((select jsonb_agg(jsonb_build_object('id', item.id, 'name', item.name) order by item.name, item.id) from groups item), '[]'::jsonb)
  ) into v_result;
  return v_result;
end
$$;

revoke all on function public.v5_funnel_filter_options(date, date, integer) from public, anon;
grant execute on function public.v5_funnel_filter_options(date, date, integer) to authenticated;

create or replace function public.v5_funnel_summary(
  p_start date, p_end date, p_cabinet_ids uuid[] default null, p_product_ids uuid[] default null,
  p_category_ids uuid[] default null, p_brand_ids uuid[] default null, p_group_ids uuid[] default null, p_search text default null
)
returns table (
  impressions bigint, clicks bigint, carts bigint, orders bigint, ordered_amount numeric,
  ad_impressions bigint, ad_clicks bigint, ad_orders_qty bigint, ad_ordered_amount numeric, ad_spend numeric,
  product_count bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(base.impressions), 0)::bigint, coalesce(sum(base.clicks), 0)::bigint,
    coalesce(sum(base.carts), 0)::bigint, coalesce(sum(base.orders), 0)::bigint, coalesce(sum(base.ordered_amount), 0),
    coalesce(sum(base.ad_impressions), 0)::bigint, coalesce(sum(base.ad_clicks), 0)::bigint,
    coalesce(sum(base.ad_orders_qty), 0)::bigint, coalesce(sum(base.ad_ordered_amount), 0), coalesce(sum(base.ad_spend), 0),
    count(distinct base.product_id)::bigint
  from app.v5_funnel_filtered(p_start, p_end, p_cabinet_ids, p_product_ids, p_category_ids, p_brand_ids, p_group_ids, p_search) base
$$;

revoke all on function public.v5_funnel_summary(date, date, uuid[], uuid[], uuid[], uuid[], uuid[], text) from public, anon;
grant execute on function public.v5_funnel_summary(date, date, uuid[], uuid[], uuid[], uuid[], uuid[], text) to authenticated;

create or replace function public.v5_funnel_series(
  p_start date, p_end date, p_cabinet_ids uuid[] default null, p_product_ids uuid[] default null,
  p_category_ids uuid[] default null, p_brand_ids uuid[] default null, p_group_ids uuid[] default null, p_search text default null
)
returns table (
  period_date date, impressions bigint, clicks bigint, carts bigint, orders bigint, ordered_amount numeric,
  ad_impressions bigint, ad_clicks bigint, ad_orders_qty bigint, ad_ordered_amount numeric, ad_spend numeric
)
language sql
stable
security definer
set search_path = ''
as $$
  select base.date, sum(base.impressions)::bigint, sum(base.clicks)::bigint, sum(base.carts)::bigint,
    sum(base.orders)::bigint, sum(base.ordered_amount), sum(base.ad_impressions)::bigint,
    sum(base.ad_clicks)::bigint, sum(base.ad_orders_qty)::bigint, sum(base.ad_ordered_amount), sum(base.ad_spend)
  from app.v5_funnel_filtered(p_start, p_end, p_cabinet_ids, p_product_ids, p_category_ids, p_brand_ids, p_group_ids, p_search) base
  group by base.date order by base.date
$$;

revoke all on function public.v5_funnel_series(date, date, uuid[], uuid[], uuid[], uuid[], uuid[], text) from public, anon;
grant execute on function public.v5_funnel_series(date, date, uuid[], uuid[], uuid[], uuid[], uuid[], text) to authenticated;

create or replace function public.v5_funnel_rows(
  p_start date, p_end date, p_cabinet_ids uuid[] default null, p_product_ids uuid[] default null,
  p_category_ids uuid[] default null, p_brand_ids uuid[] default null, p_group_ids uuid[] default null, p_search text default null,
  p_sort text default 'ordered_amount', p_offset integer default 0, p_limit integer default 100
)
returns table (
  product_id uuid, cabinet_id uuid, cabinet_name text, group_id uuid, group_name text,
  seller_sku text, wb_sku text, product_name text,
  impressions bigint, clicks bigint, carts bigint, orders bigint, ordered_amount numeric,
  ad_impressions bigint, ad_clicks bigint, ad_orders_qty bigint, ad_ordered_amount numeric, ad_spend numeric,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.v5_assert_funnel_read(p_start, p_end, p_cabinet_ids, p_product_ids, p_category_ids, p_brand_ids, p_group_ids, p_search);
  if p_sort not in ('impressions', 'clicks', 'carts', 'orders', 'ordered_amount', 'ctr', 'cart_cr', 'order_cr', 'ad_spend', 'ad_orders_qty', 'ad_ordered_amount', 'cpo', 'drr') then
    raise exception 'Funnel sort is invalid';
  end if;
  if p_offset is null or p_offset < 0 or p_offset > 100000 then raise exception 'Funnel offset is invalid'; end if;
  if p_limit is null or p_limit < 1 or p_limit > 1000 then raise exception 'Funnel limit must be between 1 and 1000'; end if;
  return query
  with grouped as (
    select base.product_id, base.cabinet_id, min(base.cabinet_name) as cabinet_name,
      base.group_id, min(base.group_name) as group_name,
      min(base.seller_sku) as seller_sku, min(base.wb_sku) as wb_sku, min(base.product_name) as product_name,
      sum(base.impressions)::bigint as impressions, sum(base.clicks)::bigint as clicks,
      sum(base.carts)::bigint as carts, sum(base.orders)::bigint as orders, sum(base.ordered_amount) as ordered_amount,
      sum(base.ad_impressions)::bigint as ad_impressions, sum(base.ad_clicks)::bigint as ad_clicks,
      sum(base.ad_orders_qty)::bigint as ad_orders_qty, sum(base.ad_ordered_amount) as ad_ordered_amount,
      sum(base.ad_spend) as ad_spend
    from app.v5_funnel_filtered(p_start, p_end, p_cabinet_ids, p_product_ids, p_category_ids, p_brand_ids, p_group_ids, p_search) base
    group by base.product_id, base.cabinet_id, base.group_id
  ), counted as (select grouped.*, count(*) over () as total_count from grouped)
  select counted.product_id, counted.cabinet_id, counted.cabinet_name, counted.group_id, counted.group_name,
    counted.seller_sku, counted.wb_sku, counted.product_name,
    counted.impressions, counted.clicks, counted.carts, counted.orders, counted.ordered_amount,
    counted.ad_impressions, counted.ad_clicks, counted.ad_orders_qty, counted.ad_ordered_amount, counted.ad_spend,
    counted.total_count
  from counted
  order by case p_sort
    when 'impressions' then counted.impressions::numeric
    when 'clicks' then counted.clicks::numeric
    when 'carts' then counted.carts::numeric
    when 'orders' then counted.orders::numeric
    when 'ordered_amount' then counted.ordered_amount
    when 'ctr' then counted.clicks::numeric / nullif(counted.impressions, 0)
    when 'cart_cr' then counted.carts::numeric / nullif(counted.clicks, 0)
    when 'order_cr' then counted.orders::numeric / nullif(counted.carts, 0)
    when 'ad_spend' then counted.ad_spend
    when 'ad_orders_qty' then counted.ad_orders_qty::numeric
    when 'ad_ordered_amount' then counted.ad_ordered_amount
    when 'cpo' then counted.ad_spend / nullif(counted.ad_orders_qty, 0)
    when 'drr' then counted.ad_spend / nullif(counted.ad_ordered_amount, 0)
  end desc nulls last, counted.product_id, counted.group_id nulls first
  offset p_offset limit p_limit;
end
$$;

revoke all on function public.v5_funnel_rows(date, date, uuid[], uuid[], uuid[], uuid[], uuid[], text, text, integer, integer) from public, anon;
grant execute on function public.v5_funnel_rows(date, date, uuid[], uuid[], uuid[], uuid[], uuid[], text, text, integer, integer) to authenticated;

create or replace function public.v5_health()
returns jsonb language sql stable security invoker set search_path = ''
as $$ select jsonb_build_object('environment', 'analytics-v5', 'schema_version', '20260914025000', 'status', 'ok') $$;

revoke all on function public.v5_health() from public;
grant execute on function public.v5_health() to anon, authenticated;

comment on function public.v5_funnel_summary(date, date, uuid[], uuid[], uuid[], uuid[], uuid[], text) is 'Returns bounded aggregate funnel and corrected XWay measures; ratios are calculated only from aggregate totals.';
comment on function public.v5_funnel_rows(date, date, uuid[], uuid[], uuid[], uuid[], uuid[], text, text, integer, integer) is 'Returns at most 1000 product + dated-group aggregates with server sorting and total count.';

commit;
