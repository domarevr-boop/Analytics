begin;

create or replace view analytics.funnel_current_enriched as
with current_metrics as (
  select version.date, version.product_id, version.cabinet_id,
    (array_agg(version.impressions order by version.version_order desc) filter (where version.impressions is not null))[1] as impressions,
    (array_agg(version.clicks order by version.version_order desc) filter (where version.clicks is not null))[1] as clicks,
    (array_agg(version.carts order by version.version_order desc) filter (where version.carts is not null))[1] as carts,
    (array_agg(version.orders order by version.version_order desc) filter (where version.orders is not null))[1] as orders,
    (array_agg(version.ordered_amount order by version.version_order desc) filter (where version.ordered_amount is not null))[1] as ordered_amount,
    (array_agg(version.ad_impressions order by version.version_order desc) filter (where version.ad_impressions is not null))[1] as ad_impressions,
    (array_agg(version.ad_clicks order by version.version_order desc) filter (where version.ad_clicks is not null))[1] as ad_clicks,
    (array_agg(version.ad_orders_qty order by version.version_order desc) filter (where version.ad_orders_qty is not null))[1] as ad_orders_qty,
    (array_agg(version.ad_ordered_amount order by version.version_order desc) filter (where version.ad_ordered_amount is not null))[1] as ad_ordered_amount,
    (array_agg(version.ad_spend order by version.version_order desc) filter (where version.ad_spend is not null))[1] as ad_spend
  from analytics.funnel_metric_versions version
  join ingest.import_batches batch on batch.id = version.batch_id
  where batch.status = 'published'
  group by version.date, version.product_id, version.cabinet_id
)
select metric.date, metric.product_id, metric.cabinet_id, cabinet.name as cabinet_name,
  product.category_id, category.name as category_name, product.brand_id, brand.name as brand_name,
  membership.group_id, product_group.name as group_name,
  product.seller_sku, product.wb_sku, product.name as product_name,
  coalesce(metric.impressions, 0) as impressions, coalesce(metric.clicks, 0) as clicks,
  coalesce(metric.carts, 0) as carts, coalesce(metric.orders, 0) as orders,
  coalesce(metric.ordered_amount, 0) as ordered_amount,
  coalesce(metric.ad_impressions, 0) as ad_impressions, coalesce(metric.ad_clicks, 0) as ad_clicks,
  coalesce(metric.ad_orders_qty, 0) as ad_orders_qty, coalesce(metric.ad_ordered_amount, 0) as ad_ordered_amount,
  coalesce(metric.ad_spend, 0) as ad_spend
from current_metrics metric
join core.products product on product.id = metric.product_id and product.cabinet_id = metric.cabinet_id
join core.cabinets cabinet on cabinet.id = metric.cabinet_id
left join core.categories category on category.id = product.category_id
left join core.brands brand on brand.id = product.brand_id
left join lateral (
  select version.group_id from core.group_membership_versions version
  where version.product_id = metric.product_id and version.effective_date <= metric.date
  order by version.effective_date desc, version.id desc limit 1
) membership on true
left join core.product_groups product_group on product_group.id = membership.group_id;

revoke all on analytics.funnel_current_enriched from public, anon, authenticated;

create or replace function public.v5_funnel_filter_options(p_start date, p_end date, p_limit integer default 500)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_result jsonb;
begin
  perform app.v5_assert_funnel_read(p_start, p_end, null, null, null, null, null, null);
  if p_limit is null or p_limit < 1 or p_limit > 500 then raise exception 'Funnel filter limit must be between 1 and 500'; end if;
  with base as (
    select * from analytics.funnel_current_enriched source
    where source.date between p_start and p_end and app.can_access_cabinet(source.cabinet_id)
  ),
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

create or replace function public.v5_funnel_summary(
  p_start date, p_end date, p_cabinet_ids uuid[] default null, p_product_ids uuid[] default null,
  p_category_ids uuid[] default null, p_brand_ids uuid[] default null, p_group_ids uuid[] default null, p_search text default null
)
returns table (
  impressions bigint, clicks bigint, carts bigint, orders bigint, ordered_amount numeric,
  ad_impressions bigint, ad_clicks bigint, ad_orders_qty bigint, ad_ordered_amount numeric, ad_spend numeric, product_count bigint
)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform app.v5_assert_funnel_read(p_start, p_end, p_cabinet_ids, p_product_ids, p_category_ids, p_brand_ids, p_group_ids, p_search);
  return query
  select coalesce(sum(base.impressions), 0)::bigint, coalesce(sum(base.clicks), 0)::bigint,
    coalesce(sum(base.carts), 0)::bigint, coalesce(sum(base.orders), 0)::bigint, coalesce(sum(base.ordered_amount), 0),
    coalesce(sum(base.ad_impressions), 0)::bigint, coalesce(sum(base.ad_clicks), 0)::bigint,
    coalesce(sum(base.ad_orders_qty), 0)::bigint, coalesce(sum(base.ad_ordered_amount), 0), coalesce(sum(base.ad_spend), 0),
    count(distinct base.product_id)::bigint
  from analytics.funnel_current_enriched base
  where base.date between p_start and p_end and app.can_access_cabinet(base.cabinet_id)
    and (p_cabinet_ids is null or base.cabinet_id = any(p_cabinet_ids))
    and (p_product_ids is null or base.product_id = any(p_product_ids))
    and (p_category_ids is null or base.category_id = any(p_category_ids))
    and (p_brand_ids is null or base.brand_id = any(p_brand_ids))
    and (p_group_ids is null or base.group_id = any(p_group_ids))
    and (nullif(btrim(p_search), '') is null or base.product_name ilike '%' || btrim(p_search) || '%'
      or base.seller_sku ilike '%' || btrim(p_search) || '%' or base.wb_sku ilike '%' || btrim(p_search) || '%');
end
$$;

create or replace function public.v5_funnel_series(
  p_start date, p_end date, p_cabinet_ids uuid[] default null, p_product_ids uuid[] default null,
  p_category_ids uuid[] default null, p_brand_ids uuid[] default null, p_group_ids uuid[] default null, p_search text default null
)
returns table (
  period_date date, impressions bigint, clicks bigint, carts bigint, orders bigint, ordered_amount numeric,
  ad_impressions bigint, ad_clicks bigint, ad_orders_qty bigint, ad_ordered_amount numeric, ad_spend numeric
)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform app.v5_assert_funnel_read(p_start, p_end, p_cabinet_ids, p_product_ids, p_category_ids, p_brand_ids, p_group_ids, p_search);
  return query
  select base.date, sum(base.impressions)::bigint, sum(base.clicks)::bigint, sum(base.carts)::bigint,
    sum(base.orders)::bigint, sum(base.ordered_amount), sum(base.ad_impressions)::bigint,
    sum(base.ad_clicks)::bigint, sum(base.ad_orders_qty)::bigint, sum(base.ad_ordered_amount), sum(base.ad_spend)
  from analytics.funnel_current_enriched base
  where base.date between p_start and p_end and app.can_access_cabinet(base.cabinet_id)
    and (p_cabinet_ids is null or base.cabinet_id = any(p_cabinet_ids))
    and (p_product_ids is null or base.product_id = any(p_product_ids))
    and (p_category_ids is null or base.category_id = any(p_category_ids))
    and (p_brand_ids is null or base.brand_id = any(p_brand_ids))
    and (p_group_ids is null or base.group_id = any(p_group_ids))
    and (nullif(btrim(p_search), '') is null or base.product_name ilike '%' || btrim(p_search) || '%'
      or base.seller_sku ilike '%' || btrim(p_search) || '%' or base.wb_sku ilike '%' || btrim(p_search) || '%')
  group by base.date order by base.date;
end
$$;

create or replace function public.v5_funnel_rows(
  p_start date, p_end date, p_cabinet_ids uuid[] default null, p_product_ids uuid[] default null,
  p_category_ids uuid[] default null, p_brand_ids uuid[] default null, p_group_ids uuid[] default null, p_search text default null,
  p_sort text default 'ordered_amount', p_offset integer default 0, p_limit integer default 100
)
returns table (
  product_id uuid, cabinet_id uuid, cabinet_name text, group_id uuid, group_name text,
  seller_sku text, wb_sku text, product_name text,
  impressions bigint, clicks bigint, carts bigint, orders bigint, ordered_amount numeric,
  ad_impressions bigint, ad_clicks bigint, ad_orders_qty bigint, ad_ordered_amount numeric, ad_spend numeric, total_count bigint
)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform app.v5_assert_funnel_read(p_start, p_end, p_cabinet_ids, p_product_ids, p_category_ids, p_brand_ids, p_group_ids, p_search);
  if p_sort not in ('impressions', 'clicks', 'carts', 'orders', 'ordered_amount', 'ctr', 'cart_cr', 'order_cr', 'ad_spend', 'ad_orders_qty', 'ad_ordered_amount', 'cpo', 'drr') then raise exception 'Funnel sort is invalid'; end if;
  if p_offset is null or p_offset < 0 or p_offset > 100000 then raise exception 'Funnel offset is invalid'; end if;
  if p_limit is null or p_limit < 1 or p_limit > 1000 then raise exception 'Funnel limit must be between 1 and 1000'; end if;
  return query
  with grouped as (
    select base.product_id, base.cabinet_id, min(base.cabinet_name) as cabinet_name,
      base.group_id, min(base.group_name) as group_name, min(base.seller_sku) as seller_sku,
      min(base.wb_sku) as wb_sku, min(base.product_name) as product_name,
      sum(base.impressions)::bigint as impressions, sum(base.clicks)::bigint as clicks,
      sum(base.carts)::bigint as carts, sum(base.orders)::bigint as orders, sum(base.ordered_amount) as ordered_amount,
      sum(base.ad_impressions)::bigint as ad_impressions, sum(base.ad_clicks)::bigint as ad_clicks,
      sum(base.ad_orders_qty)::bigint as ad_orders_qty, sum(base.ad_ordered_amount) as ad_ordered_amount, sum(base.ad_spend) as ad_spend
    from analytics.funnel_current_enriched base
    where base.date between p_start and p_end and app.can_access_cabinet(base.cabinet_id)
      and (p_cabinet_ids is null or base.cabinet_id = any(p_cabinet_ids))
      and (p_product_ids is null or base.product_id = any(p_product_ids))
      and (p_category_ids is null or base.category_id = any(p_category_ids))
      and (p_brand_ids is null or base.brand_id = any(p_brand_ids))
      and (p_group_ids is null or base.group_id = any(p_group_ids))
      and (nullif(btrim(p_search), '') is null or base.product_name ilike '%' || btrim(p_search) || '%'
        or base.seller_sku ilike '%' || btrim(p_search) || '%' or base.wb_sku ilike '%' || btrim(p_search) || '%')
    group by base.product_id, base.cabinet_id, base.group_id
  ), counted as (select grouped.*, count(*) over () as total_count from grouped)
  select counted.product_id, counted.cabinet_id, counted.cabinet_name, counted.group_id, counted.group_name,
    counted.seller_sku, counted.wb_sku, counted.product_name,
    counted.impressions, counted.clicks, counted.carts, counted.orders, counted.ordered_amount,
    counted.ad_impressions, counted.ad_clicks, counted.ad_orders_qty, counted.ad_ordered_amount, counted.ad_spend, counted.total_count
  from counted
  order by case p_sort when 'impressions' then counted.impressions::numeric when 'clicks' then counted.clicks::numeric
    when 'carts' then counted.carts::numeric when 'orders' then counted.orders::numeric when 'ordered_amount' then counted.ordered_amount
    when 'ctr' then counted.clicks::numeric / nullif(counted.impressions, 0)
    when 'cart_cr' then counted.carts::numeric / nullif(counted.clicks, 0)
    when 'order_cr' then counted.orders::numeric / nullif(counted.carts, 0)
    when 'ad_spend' then counted.ad_spend when 'ad_orders_qty' then counted.ad_orders_qty::numeric
    when 'ad_ordered_amount' then counted.ad_ordered_amount when 'cpo' then counted.ad_spend / nullif(counted.ad_orders_qty, 0)
    when 'drr' then counted.ad_spend / nullif(counted.ad_ordered_amount, 0) end desc nulls last,
    counted.product_id, counted.group_id nulls first
  offset p_offset limit p_limit;
end
$$;

revoke all on function public.v5_funnel_filter_options(date, date, integer) from public, anon;
grant execute on function public.v5_funnel_filter_options(date, date, integer) to authenticated;
revoke all on function public.v5_funnel_summary(date, date, uuid[], uuid[], uuid[], uuid[], uuid[], text) from public, anon;
grant execute on function public.v5_funnel_summary(date, date, uuid[], uuid[], uuid[], uuid[], uuid[], text) to authenticated;
revoke all on function public.v5_funnel_series(date, date, uuid[], uuid[], uuid[], uuid[], uuid[], text) from public, anon;
grant execute on function public.v5_funnel_series(date, date, uuid[], uuid[], uuid[], uuid[], uuid[], text) to authenticated;
revoke all on function public.v5_funnel_rows(date, date, uuid[], uuid[], uuid[], uuid[], uuid[], text, text, integer, integer) from public, anon;
grant execute on function public.v5_funnel_rows(date, date, uuid[], uuid[], uuid[], uuid[], uuid[], text, text, integer, integer) to authenticated;

create or replace function public.v5_health()
returns jsonb language sql stable security invoker set search_path = ''
as $$ select jsonb_build_object('environment', 'analytics-v5', 'schema_version', '20260914027000', 'status', 'ok') $$;
revoke all on function public.v5_health() from public;
grant execute on function public.v5_health() to anon, authenticated;

comment on view analytics.funnel_current_enriched is 'Private current metric resolution enriched with dated membership; public access is only through bounded RPCs.';

commit;
