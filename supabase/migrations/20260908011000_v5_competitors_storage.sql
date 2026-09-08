begin;

create table analytics.competitor_funnel_versions (
  batch_id uuid not null references ingest.import_batches(id) on delete restrict,
  date date not null,
  wb_article text not null,
  position integer not null,
  seller text not null,
  brand text not null,
  ordered_amount numeric(20, 2) not null,
  discounted_price numeric(20, 6) not null,
  buyer_median_price numeric(20, 6) not null,
  avg_search_position numeric(12, 6) not null,
  impressions bigint not null,
  clicks bigint not null,
  reported_ctr numeric(12, 6) not null,
  carts bigint not null,
  reported_cart_conversion numeric(12, 6) not null,
  orders bigint not null,
  reported_order_conversion numeric(12, 6) not null,
  buyouts bigint not null,
  reported_buyout_rate numeric(12, 6) not null,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (batch_id, date, wb_article),
  constraint competitor_funnel_article_present check (btrim(wb_article) <> '' and length(wb_article) <= 100),
  constraint competitor_funnel_text_bounded check (length(seller) <= 500 and length(brand) <= 500),
  constraint competitor_funnel_position_nonnegative check (position >= 0),
  constraint competitor_funnel_amounts_nonnegative check (ordered_amount >= 0 and discounted_price >= 0 and buyer_median_price >= 0),
  constraint competitor_funnel_counts_nonnegative check (impressions >= 0 and clicks >= 0 and carts >= 0 and orders >= 0 and buyouts >= 0),
  constraint competitor_funnel_metrics_nonnegative check (avg_search_position >= 0 and reported_ctr >= 0 and reported_cart_conversion >= 0 and reported_order_conversion >= 0 and reported_buyout_rate >= 0)
);

create table analytics.competitor_search_versions (
  batch_id uuid not null references ingest.import_batches(id) on delete restrict,
  date date not null,
  wb_article text not null,
  query text not null,
  normalized_query text not null,
  requests bigint not null,
  requests_previous bigint not null,
  reported_cart_conversion numeric(12, 6) not null,
  reported_cart_conversion_previous numeric(12, 6) not null,
  reported_order_conversion numeric(12, 6) not null,
  reported_order_conversion_previous numeric(12, 6) not null,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (batch_id, date, wb_article, normalized_query),
  constraint competitor_search_article_present check (btrim(wb_article) <> '' and length(wb_article) <= 100),
  constraint competitor_search_query_present check (btrim(query) <> '' and btrim(normalized_query) <> '' and length(query) <= 1000 and length(normalized_query) <= 1000),
  constraint competitor_search_counts_nonnegative check (requests >= 0 and requests_previous >= 0),
  constraint competitor_search_metrics_nonnegative check (reported_cart_conversion >= 0 and reported_cart_conversion_previous >= 0 and reported_order_conversion >= 0 and reported_order_conversion_previous >= 0)
);

create table analytics.competitor_stock_versions (
  batch_id uuid not null references ingest.import_batches(id) on delete restrict,
  date date not null,
  wb_article text not null,
  name text not null,
  subject text not null,
  brand text not null,
  region text not null,
  normalized_region text not null,
  warehouse text not null,
  normalized_warehouse text not null,
  stock bigint not null,
  in_transit_to_customer bigint not null,
  in_transit_from_customer bigint not null,
  avg_daily_orders numeric(20, 6) not null,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (batch_id, date, wb_article, normalized_region, normalized_warehouse),
  constraint competitor_stock_article_present check (btrim(wb_article) <> '' and length(wb_article) <= 100),
  constraint competitor_stock_text_bounded check (length(name) <= 2000 and length(subject) <= 500 and length(brand) <= 500 and length(region) <= 1000 and length(warehouse) <= 1000),
  constraint competitor_stock_normalized_bounded check (length(normalized_region) <= 1000 and length(normalized_warehouse) <= 1000),
  constraint competitor_stock_values_nonnegative check (stock >= 0 and in_transit_to_customer >= 0 and in_transit_from_customer >= 0 and avg_daily_orders >= 0)
);

create table analytics.competitor_position_versions (
  batch_id uuid not null references ingest.import_batches(id) on delete restrict,
  date date not null,
  wb_article text not null,
  position integer not null,
  seller text not null,
  brand text not null,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (batch_id, date, wb_article),
  constraint competitor_position_article_present check (btrim(wb_article) <> '' and length(wb_article) <= 100),
  constraint competitor_position_text_bounded check (length(seller) <= 500 and length(brand) <= 500),
  constraint competitor_position_top50 check (position between 1 and 50)
);

create index competitor_funnel_date_idx on analytics.competitor_funnel_versions (date, batch_id);
create index competitor_funnel_brand_idx on analytics.competitor_funnel_versions (brand, date, batch_id);
create index competitor_search_date_idx on analytics.competitor_search_versions (date, batch_id);
create index competitor_search_article_idx on analytics.competitor_search_versions (wb_article, date, batch_id);
create index competitor_stock_date_idx on analytics.competitor_stock_versions (date, batch_id);
create index competitor_stock_brand_warehouse_idx on analytics.competitor_stock_versions (brand, normalized_warehouse, date, batch_id);
create index competitor_position_date_position_idx on analytics.competitor_position_versions (date, position, batch_id);

alter table analytics.competitor_funnel_versions enable row level security;
alter table analytics.competitor_search_versions enable row level security;
alter table analytics.competitor_stock_versions enable row level security;
alter table analytics.competitor_position_versions enable row level security;

create policy competitor_funnel_versions_read_allowed on analytics.competitor_funnel_versions for select to authenticated using (app.can_read_batch(batch_id));
create policy competitor_search_versions_read_allowed on analytics.competitor_search_versions for select to authenticated using (app.can_read_batch(batch_id));
create policy competitor_stock_versions_read_allowed on analytics.competitor_stock_versions for select to authenticated using (app.can_read_batch(batch_id));
create policy competitor_position_versions_read_allowed on analytics.competitor_position_versions for select to authenticated using (app.can_read_batch(batch_id));

revoke all on analytics.competitor_funnel_versions from public, anon, authenticated;
revoke all on analytics.competitor_search_versions from public, anon, authenticated;
revoke all on analytics.competitor_stock_versions from public, anon, authenticated;
revoke all on analytics.competitor_position_versions from public, anon, authenticated;

create or replace function public.v5_competitor_snapshot_bounds()
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
  where batch.source_code = 'competitors'
    and batch.status = 'published'
  order by batch.published_at desc nulls last, batch.id desc
  limit 1;

  if v_batch_id is null then
    return jsonb_build_object(
      'batch_id', null,
      'funnel', jsonb_build_object('min_date', null, 'max_date', null, 'row_count', 0),
      'search', jsonb_build_object('min_date', null, 'max_date', null, 'row_count', 0),
      'stocks', jsonb_build_object('min_date', null, 'max_date', null, 'row_count', 0),
      'positions', jsonb_build_object('min_date', null, 'max_date', null, 'row_count', 0)
    );
  end if;

  select jsonb_build_object(
    'batch_id', v_batch_id,
    'funnel', (select jsonb_build_object('min_date', min(row_data.date), 'max_date', max(row_data.date), 'row_count', count(*)) from analytics.competitor_funnel_versions row_data where row_data.batch_id = v_batch_id),
    'search', (select jsonb_build_object('min_date', min(row_data.date), 'max_date', max(row_data.date), 'row_count', count(*)) from analytics.competitor_search_versions row_data where row_data.batch_id = v_batch_id),
    'stocks', (select jsonb_build_object('min_date', min(row_data.date), 'max_date', max(row_data.date), 'row_count', count(*)) from analytics.competitor_stock_versions row_data where row_data.batch_id = v_batch_id),
    'positions', (select jsonb_build_object('min_date', min(row_data.date), 'max_date', max(row_data.date), 'row_count', count(*)) from analytics.competitor_position_versions row_data where row_data.batch_id = v_batch_id)
  ) into v_result;

  return v_result;
end
$$;

revoke all on function public.v5_competitor_snapshot_bounds() from public, anon;
grant execute on function public.v5_competitor_snapshot_bounds() to authenticated;

create or replace function public.v5_health()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'environment', 'analytics-v5',
    'schema_version', '20260908011000',
    'status', 'ok'
  )
$$;

revoke all on function public.v5_health() from public;
grant execute on function public.v5_health() to anon, authenticated;

comment on function public.v5_competitor_snapshot_bounds() is 'Returns section bounds and row counts for one latest published four-sheet competitor batch.';

commit;
