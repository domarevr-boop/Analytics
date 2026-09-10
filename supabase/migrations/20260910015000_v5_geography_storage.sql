begin;

create or replace function ingest.normalize_geography_level(p_value text, p_empty_label text)
returns text
language sql
immutable
security invoker
set search_path = ''
as $$
  select coalesce(nullif(btrim(replace(coalesce(p_value, ''), chr(160), ' ')), ''), p_empty_label)
$$;

revoke all on function ingest.normalize_geography_level(text, text) from public, anon, authenticated;

create table analytics.geography_order_versions (
  batch_id uuid not null references ingest.import_batches(id) on delete restrict,
  date date not null,
  source_product_id text not null,
  product_id uuid not null,
  cabinet_id uuid not null,
  region text not null,
  normalized_region text not null,
  area text not null,
  normalized_area text not null,
  city text not null,
  normalized_city text not null,
  delivery_hours numeric(12, 4),
  orders_total bigint not null,
  product_local_orders bigint not null,
  product_nonlocal_orders bigint not null,
  wb_local_orders bigint not null,
  wb_nonlocal_orders bigint not null,
  marketplace_local_orders bigint not null,
  marketplace_nonlocal_orders bigint not null,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (batch_id, date, product_id, normalized_region, normalized_area, normalized_city),
  foreign key (product_id, cabinet_id) references core.products(id, cabinet_id) on delete restrict,
  constraint geography_source_product_present check (btrim(source_product_id) <> '' and length(source_product_id) <= 500),
  constraint geography_region_present check (btrim(region) <> '' and btrim(normalized_region) <> ''),
  constraint geography_levels_bounded check (
    length(region) <= 1000 and length(normalized_region) <= 1000
    and length(area) <= 1000 and length(normalized_area) <= 1000
    and length(city) <= 1000 and length(normalized_city) <= 1000
  ),
  constraint geography_delivery_nonnegative check (delivery_hours is null or delivery_hours >= 0),
  constraint geography_orders_nonnegative check (
    orders_total >= 0
    and product_local_orders >= 0 and product_nonlocal_orders >= 0
    and wb_local_orders >= 0 and wb_nonlocal_orders >= 0
    and marketplace_local_orders >= 0 and marketplace_nonlocal_orders >= 0
  ),
  constraint geography_product_split_balanced check (
    orders_total = product_local_orders + product_nonlocal_orders
  ),
  constraint geography_fulfillment_balanced check (
    orders_total = wb_local_orders + wb_nonlocal_orders + marketplace_local_orders + marketplace_nonlocal_orders
  )
);

create index geography_versions_batch_date_idx
on analytics.geography_order_versions (batch_id, date);

create index geography_versions_cabinet_date_idx
on analytics.geography_order_versions (cabinet_id, date, batch_id);

create index geography_versions_region_date_idx
on analytics.geography_order_versions (normalized_region, normalized_area, normalized_city, date, batch_id);

create index geography_versions_product_date_idx
on analytics.geography_order_versions (product_id, date, batch_id);

alter table analytics.geography_order_versions enable row level security;

create policy geography_order_versions_read_allowed
on analytics.geography_order_versions for select to authenticated
using (app.can_access_cabinet(cabinet_id) and app.can_read_batch(batch_id));

revoke all on analytics.geography_order_versions from public, anon, authenticated;

create or replace function public.v5_geography_snapshot_bounds()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_batch_id uuid;
  v_result jsonb;
begin
  if auth.uid() is null or not app.can_read() then
    raise exception 'V5 read access is required';
  end if;

  select batch.id
  into v_batch_id
  from ingest.import_batches batch
  where batch.source_code = 'geography'
    and batch.status = 'published'
    and exists (
      select 1
      from analytics.geography_order_versions row_data
      where row_data.batch_id = batch.id
        and app.can_access_cabinet(row_data.cabinet_id)
    )
  order by batch.published_at desc nulls last, batch.id desc
  limit 1;

  if v_batch_id is null then
    return jsonb_build_object(
      'batch_id', null,
      'min_date', null,
      'max_date', null,
      'row_count', 0,
      'order_count', 0,
      'product_count', 0,
      'region_count', 0,
      'area_count', 0,
      'city_count', 0,
      'delivery_row_count', 0,
      'delivery_order_count', 0
    );
  end if;

  select jsonb_build_object(
    'batch_id', v_batch_id,
    'min_date', min(row_data.date),
    'max_date', max(row_data.date),
    'row_count', count(*),
    'order_count', coalesce(sum(row_data.orders_total), 0),
    'product_count', count(distinct row_data.product_id),
    'region_count', count(distinct row_data.normalized_region),
    'area_count', count(distinct (row_data.normalized_region, row_data.normalized_area))
      filter (where row_data.normalized_area <> 'Без региона'),
    'city_count', count(distinct (row_data.normalized_region, row_data.normalized_area, row_data.normalized_city))
      filter (where row_data.normalized_city <> 'Без населённого пункта'),
    'delivery_row_count', count(*) filter (where row_data.delivery_hours is not null),
    'delivery_order_count', coalesce(sum(row_data.orders_total) filter (where row_data.delivery_hours is not null), 0)
  )
  into v_result
  from analytics.geography_order_versions row_data
  where row_data.batch_id = v_batch_id
    and app.can_access_cabinet(row_data.cabinet_id);

  return v_result;
end
$$;

revoke all on function public.v5_geography_snapshot_bounds() from public, anon;
grant execute on function public.v5_geography_snapshot_bounds() to authenticated;

create or replace function public.v5_health()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object('environment', 'analytics-v5', 'schema_version', '20260910015000', 'status', 'ok')
$$;

revoke all on function public.v5_health() from public;
grant execute on function public.v5_health() to anon, authenticated;

comment on table analytics.geography_order_versions is 'Versioned geography order facts. Only one latest published batch is read by bounded RPCs.';
comment on function public.v5_geography_snapshot_bounds() is 'Returns bounded coverage metadata for the latest published geography batch visible to the current user.';

commit;
