-- Resolve current profitability versions in a private view so bounded RPCs work under authenticated RLS.

begin;

create or replace view analytics.profitability_current_enriched as
with current_metrics as (
  select distinct on (version.date, version.product_id)
    version.date, version.product_id, version.cabinet_id, version.quantity,
    version.revenue, version.cost, version.agent_fee, version.logistics_cost,
    version.marketing_cost, version.storage_cost, version.gross_profit, version.gross_margin
  from analytics.profitability_metric_versions version
  join ingest.import_batches batch on batch.id = version.batch_id
  where batch.status = 'published'
  order by version.date, version.product_id, version.version_order desc
)
select metric.date, metric.product_id, metric.cabinet_id, cabinet.name as cabinet_name,
  product.category_id, category.name as category_name, product.brand_id, brand.name as brand_name,
  membership.group_id, product_group.name as group_name,
  product.seller_sku, product.wb_sku, product.name as product_name,
  metric.quantity, metric.revenue, metric.cost, metric.agent_fee, metric.logistics_cost,
  metric.marketing_cost, metric.storage_cost, metric.gross_profit, metric.gross_margin,
  expense.expense_pct, metric.revenue * expense.expense_pct / 100 as expense_amount,
  case when expense.expense_pct is null then null else metric.gross_profit - metric.revenue * expense.expense_pct / 100 end as net_profit,
  case when expense.expense_pct is null or metric.revenue = 0 then null
    else (metric.gross_profit - metric.revenue * expense.expense_pct / 100) / metric.revenue * 100 end as profitability
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
left join core.product_groups product_group on product_group.id = membership.group_id
left join analytics.profitability_monthly_expenses expense
  on expense.cabinet_id = metric.cabinet_id and expense.month = date_trunc('month', metric.date)::date;

revoke all on analytics.profitability_current_enriched from public, anon, authenticated;

create or replace function app.v5_profitability_filtered(
  p_start date, p_end date, p_cabinet_ids uuid[] default null, p_product_ids uuid[] default null,
  p_category_ids uuid[] default null, p_brand_ids uuid[] default null, p_group_ids uuid[] default null,
  p_search text default null
)
returns table (
  date date, product_id uuid, cabinet_id uuid, cabinet_name text,
  category_id uuid, category_name text, brand_id uuid, brand_name text,
  group_id uuid, group_name text, seller_sku text, wb_sku text, product_name text,
  quantity numeric, revenue numeric, cost numeric, agent_fee numeric, logistics_cost numeric,
  marketing_cost numeric, storage_cost numeric, gross_profit numeric, gross_margin numeric,
  expense_pct numeric, expense_amount numeric, net_profit numeric, profitability numeric
)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform app.v5_assert_profitability_read(p_start, p_end, p_cabinet_ids, p_product_ids, p_category_ids, p_brand_ids, p_group_ids, p_search);
  return query
  select source.date, source.product_id, source.cabinet_id, source.cabinet_name,
    source.category_id, source.category_name, source.brand_id, source.brand_name,
    source.group_id, source.group_name, source.seller_sku, source.wb_sku, source.product_name,
    source.quantity, source.revenue, source.cost, source.agent_fee, source.logistics_cost,
    source.marketing_cost, source.storage_cost, source.gross_profit, source.gross_margin,
    source.expense_pct, source.expense_amount, source.net_profit, source.profitability
  from analytics.profitability_current_enriched source
  where source.date between p_start and p_end and app.can_access_cabinet(source.cabinet_id)
    and (p_cabinet_ids is null or source.cabinet_id = any(p_cabinet_ids))
    and (p_product_ids is null or source.product_id = any(p_product_ids))
    and (p_category_ids is null or source.category_id = any(p_category_ids))
    and (p_brand_ids is null or source.brand_id = any(p_brand_ids))
    and (p_group_ids is null or source.group_id = any(p_group_ids))
    and (nullif(btrim(p_search), '') is null or source.product_name ilike '%' || btrim(p_search) || '%'
      or source.seller_sku ilike '%' || btrim(p_search) || '%' or source.wb_sku ilike '%' || btrim(p_search) || '%'
      or exists (select 1 from core.product_aliases alias where alias.product_id = source.product_id and alias.alias_value ilike '%' || btrim(p_search) || '%'));
end
$$;

revoke all on function app.v5_profitability_filtered(date, date, uuid[], uuid[], uuid[], uuid[], uuid[], text) from public, anon, authenticated;

create or replace function public.v5_health()
returns jsonb language sql stable security invoker set search_path = ''
as $$ select jsonb_build_object('environment', 'analytics-v5', 'schema_version', '20260920033000', 'status', 'ok') $$;
revoke all on function public.v5_health() from public; grant execute on function public.v5_health() to anon, authenticated;

comment on view analytics.profitability_current_enriched is 'Private latest profitability facts with dated groups and optional monthly expenses; public access is only through bounded RPCs.';

commit;
