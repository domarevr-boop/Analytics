begin;

alter table analytics.market_daily_versions
add column version_order bigint generated always as identity;

create index market_daily_versions_current_idx
on analytics.market_daily_versions (date, version_order desc);

create or replace view analytics.market_daily_current
with (security_invoker = true)
as
select
  selected.batch_id,
  selected.date,
  selected.market_ordered_amount,
  selected.own_ordered_amount,
  selected.market_orders,
  selected.own_orders,
  selected.reported_amount_share,
  selected.reported_orders_share,
  selected.reported_own_avg_check,
  selected.reported_market_avg_check
from (
  select
    row_data.*,
    row_number() over (
      partition by row_data.date
      order by row_data.version_order desc
    ) as version_rank
  from analytics.market_daily_versions row_data
  join ingest.import_batches batch on batch.id = row_data.batch_id
  where batch.source_code = 'market_dynamics'
    and batch.status = 'published'
) selected
where selected.version_rank = 1;

revoke all on analytics.market_daily_current from public, anon, authenticated;

create or replace function public.v5_health()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'environment', 'analytics-v5',
    'schema_version', '20260906004000',
    'status', 'ok'
  )
$$;

revoke all on function public.v5_health() from public;
grant execute on function public.v5_health() to anon, authenticated;

comment on column analytics.market_daily_versions.version_order is 'Monotonic version precedence used for deterministic reimport and rollback.';

commit;
