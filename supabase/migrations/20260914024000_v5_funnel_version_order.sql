begin;

alter table analytics.funnel_metric_versions
add column version_order bigint generated always as identity unique;

create index funnel_metric_versions_current_idx
on analytics.funnel_metric_versions (cabinet_id, date, product_id, version_order desc);

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
    and app.can_access_cabinet(version.cabinet_id)
  group by version.date, version.product_id, version.cabinet_id
$$;

revoke all on function app.v5_funnel_current(date, date) from public, anon, authenticated;

create or replace function public.v5_health()
returns jsonb language sql stable security invoker set search_path = ''
as $$ select jsonb_build_object('environment', 'analytics-v5', 'schema_version', '20260914024000', 'status', 'ok') $$;

revoke all on function public.v5_health() from public;
grant execute on function public.v5_health() to anon, authenticated;

comment on column analytics.funnel_metric_versions.version_order is 'Monotonic tie-breaker for deterministic latest non-null patch resolution.';

commit;
