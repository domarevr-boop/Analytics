begin;

alter table ingest.import_batches
add constraint import_batches_id_cabinet_uq unique (id, cabinet_id);

alter table analytics.geography_order_versions
add constraint geography_batch_cabinet_fk
foreign key (batch_id, cabinet_id) references ingest.import_batches(id, cabinet_id) on delete restrict;

create or replace function public.v5_geography_snapshot_bounds()
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

  with latest_batches as (
    select distinct on (batch.cabinet_id)
      batch.id,
      batch.cabinet_id
    from ingest.import_batches batch
    where batch.source_code = 'geography'
      and batch.status = 'published'
      and batch.cabinet_id is not null
      and app.can_access_cabinet(batch.cabinet_id)
    order by batch.cabinet_id, batch.published_at desc nulls last, batch.id desc
  ), visible_rows as (
    select row_data.*
    from analytics.geography_order_versions row_data
    join latest_batches batch on batch.id = row_data.batch_id and batch.cabinet_id = row_data.cabinet_id
  )
  select jsonb_build_object(
    'batch_ids', coalesce((select jsonb_agg(batch.id order by batch.id) from latest_batches batch), '[]'::jsonb),
    'cabinet_count', (select count(*) from latest_batches),
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
  from visible_rows row_data;

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
  select jsonb_build_object('environment', 'analytics-v5', 'schema_version', '20260910016000', 'status', 'ok')
$$;

revoke all on function public.v5_health() from public;
grant execute on function public.v5_health() to anon, authenticated;

comment on function public.v5_geography_snapshot_bounds() is 'Returns aggregate coverage for the latest published geography batch of every cabinet visible to the current user.';

commit;
