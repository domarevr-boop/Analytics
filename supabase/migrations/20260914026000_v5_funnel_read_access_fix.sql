begin;

create or replace function app.v5_funnel_current(p_start date, p_end date)
returns table (
  date date, product_id uuid, cabinet_id uuid,
  impressions bigint, clicks bigint, carts bigint, orders bigint, ordered_amount numeric,
  ad_impressions bigint, ad_clicks bigint, ad_orders_qty bigint, ad_ordered_amount numeric, ad_spend numeric
)
language sql
stable
security definer
set search_path = ''
as $$
  select version.date, version.product_id, version.cabinet_id,
    (array_agg(version.impressions order by version.version_order desc) filter (where version.impressions is not null))[1],
    (array_agg(version.clicks order by version.version_order desc) filter (where version.clicks is not null))[1],
    (array_agg(version.carts order by version.version_order desc) filter (where version.carts is not null))[1],
    (array_agg(version.orders order by version.version_order desc) filter (where version.orders is not null))[1],
    (array_agg(version.ordered_amount order by version.version_order desc) filter (where version.ordered_amount is not null))[1],
    (array_agg(version.ad_impressions order by version.version_order desc) filter (where version.ad_impressions is not null))[1],
    (array_agg(version.ad_clicks order by version.version_order desc) filter (where version.ad_clicks is not null))[1],
    (array_agg(version.ad_orders_qty order by version.version_order desc) filter (where version.ad_orders_qty is not null))[1],
    (array_agg(version.ad_ordered_amount order by version.version_order desc) filter (where version.ad_ordered_amount is not null))[1],
    (array_agg(version.ad_spend order by version.version_order desc) filter (where version.ad_spend is not null))[1]
  from analytics.funnel_metric_versions version
  join ingest.import_batches batch on batch.id = version.batch_id
  where batch.status = 'published' and version.date between p_start and p_end
  group by version.date, version.product_id, version.cabinet_id
$$;

revoke all on function app.v5_funnel_current(date, date) from public, anon, authenticated;

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
  date date, product_id uuid, cabinet_id uuid, cabinet_name text,
  category_id uuid, category_name text, brand_id uuid, brand_name text,
  group_id uuid, group_name text, seller_sku text, wb_sku text, product_name text,
  impressions bigint, clicks bigint, carts bigint, orders bigint, ordered_amount numeric,
  ad_impressions bigint, ad_clicks bigint, ad_orders_qty bigint, ad_ordered_amount numeric, ad_spend numeric
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
  where app.can_access_cabinet(metric.cabinet_id)
    and (p_cabinet_ids is null or metric.cabinet_id = any(p_cabinet_ids))
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

create or replace function public.v5_health()
returns jsonb language sql stable security invoker set search_path = ''
as $$ select jsonb_build_object('environment', 'analytics-v5', 'schema_version', '20260914026000', 'status', 'ok') $$;

revoke all on function public.v5_health() from public;
grant execute on function public.v5_health() to anon, authenticated;

comment on function app.v5_funnel_current(date, date) is 'Private source-version resolver; cabinet authorization is enforced by app.v5_funnel_filtered before any public result.';

commit;
