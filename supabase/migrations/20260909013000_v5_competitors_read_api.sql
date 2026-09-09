begin;

create or replace function app.v5_current_competitor_batch_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select batch.id
  from ingest.import_batches batch
  where batch.source_code = 'competitors'
    and batch.status = 'published'
  order by batch.published_at desc nulls last, batch.id desc
  limit 1
$$;

revoke all on function app.v5_current_competitor_batch_id() from public, anon, authenticated;

create or replace function app.v5_assert_competitor_read(
  p_start date default null,
  p_end date default null,
  p_max_days integer default 731
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not app.can_read() then
    raise exception 'V5 read access is required';
  end if;
  if (p_start is null) <> (p_end is null) then
    raise exception 'Both competitor range boundaries are required';
  end if;
  if p_start is not null and (p_end < p_start or p_end - p_start > p_max_days) then
    raise exception 'Competitor range is invalid or exceeds % days', p_max_days;
  end if;
end
$$;

revoke all on function app.v5_assert_competitor_read(date, date, integer) from public, anon, authenticated;

create or replace function public.v5_competitor_filters()
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
  perform app.v5_assert_competitor_read();
  v_batch_id := app.v5_current_competitor_batch_id();

  select jsonb_build_object(
    'batch_id', v_batch_id,
    'funnel', jsonb_build_object(
      'min_date', min(row_data.date),
      'max_date', max(row_data.date),
      'day_count', count(distinct row_data.date),
      'row_count', count(row_data.*)
    ),
    'brands', coalesce((
      select jsonb_agg(item.brand order by item.brand)
      from (
        select distinct funnel.brand
        from analytics.competitor_funnel_versions funnel
        where funnel.batch_id = v_batch_id and btrim(funnel.brand) <> ''
      ) item
    ), '[]'::jsonb),
    'stock_brands', coalesce((
      select jsonb_agg(item.brand order by item.brand)
      from (
        select distinct stock.brand
        from analytics.competitor_stock_versions stock
        where stock.batch_id = v_batch_id and btrim(stock.brand) <> ''
      ) item
    ), '[]'::jsonb),
    'warehouses', coalesce((
      select jsonb_agg(jsonb_build_object('key', item.normalized_warehouse, 'name', item.warehouse) order by item.warehouse)
      from (
        select stock.normalized_warehouse, min(stock.warehouse) as warehouse
        from analytics.competitor_stock_versions stock
        where stock.batch_id = v_batch_id and btrim(stock.warehouse) <> ''
        group by stock.normalized_warehouse
      ) item
    ), '[]'::jsonb),
    'positions', jsonb_build_object(
      'min_date', (select min(position.date) from analytics.competitor_position_versions position where position.batch_id = v_batch_id),
      'max_date', (select max(position.date) from analytics.competitor_position_versions position where position.batch_id = v_batch_id),
      'day_count', (select count(distinct position.date) from analytics.competitor_position_versions position where position.batch_id = v_batch_id)
    ),
    'stocks', jsonb_build_object(
      'min_date', (select min(stock.date) from analytics.competitor_stock_versions stock where stock.batch_id = v_batch_id),
      'max_date', (select max(stock.date) from analytics.competitor_stock_versions stock where stock.batch_id = v_batch_id),
      'day_count', (select count(distinct stock.date) from analytics.competitor_stock_versions stock where stock.batch_id = v_batch_id)
    )
  )
  into v_result
  from analytics.competitor_funnel_versions row_data
  where row_data.batch_id = v_batch_id;

  return v_result;
end
$$;

revoke all on function public.v5_competitor_filters() from public, anon;
grant execute on function public.v5_competitor_filters() to authenticated;

create or replace function public.v5_competitor_overview_series(
  p_start date,
  p_end date,
  p_brand text default null,
  p_search text default null
)
returns table (
  period_date date,
  ordered_amount numeric,
  orders bigint,
  weighted_price numeric,
  impressions bigint,
  order_conversion numeric,
  buyout_rate numeric,
  own_ordered_amount numeric,
  own_orders bigint,
  own_weighted_price numeric,
  own_impressions bigint,
  own_order_conversion numeric,
  own_buyout_rate numeric,
  leader_share numeric,
  own_share numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.v5_assert_competitor_read(p_start, p_end, 731);
  if p_search is not null and length(p_search) > 100 then
    raise exception 'Competitor search must not exceed 100 characters';
  end if;
  if p_brand is not null and length(p_brand) > 500 then
    raise exception 'Competitor brand must not exceed 500 characters';
  end if;

  return query
  with base as (
    select
      row_data.*,
      exists (
        select 1
        from core.products product
        where product.wb_sku = row_data.wb_article
          and app.can_access_cabinet(product.cabinet_id)
      ) as is_own
    from analytics.competitor_funnel_versions row_data
    where row_data.batch_id = app.v5_current_competitor_batch_id()
      and row_data.date between p_start and p_end
      and (
        nullif(btrim(p_search), '') is null
        or concat_ws(' ', row_data.wb_article, row_data.brand, row_data.seller) ilike '%' || btrim(p_search) || '%'
      )
  ),
  main as (
    select * from base where nullif(btrim(p_brand), '') is null or brand = p_brand
  ),
  dates as (
    select distinct base.date from base
  ),
  main_daily as (
    select
      main.date,
      sum(main.ordered_amount) as ordered_amount,
      sum(main.orders)::bigint as orders,
      sum(main.discounted_price * main.orders) / nullif(sum(main.orders), 0) as weighted_price,
      sum(main.impressions)::bigint as impressions,
      sum(main.orders)::numeric / nullif(sum(main.impressions), 0) * 100 as order_conversion,
      case when sum(main.orders) > 0
        then sum(main.reported_buyout_rate * main.orders) / sum(main.orders)
        else avg(main.reported_buyout_rate)
      end as buyout_rate
    from main
    group by main.date
  ),
  own_daily as (
    select
      base.date,
      sum(base.ordered_amount) as ordered_amount,
      sum(base.orders)::bigint as orders,
      sum(base.discounted_price * base.orders) / nullif(sum(base.orders), 0) as weighted_price,
      sum(base.impressions)::bigint as impressions,
      sum(base.orders)::numeric / nullif(sum(base.impressions), 0) * 100 as order_conversion,
      case when sum(base.orders) > 0
        then sum(base.reported_buyout_rate * base.orders) / sum(base.orders)
        else avg(base.reported_buyout_rate)
      end as buyout_rate
    from base
    where base.is_own
    group by base.date
  ),
  brand_daily as (
    select
      base.date,
      case when base.is_own then '__own__' else ingest.normalize_competitor_key(coalesce(nullif(base.brand, ''), nullif(base.seller, ''), 'Без бренда')) end as brand_key,
      sum(base.ordered_amount) as amount
    from base
    group by base.date, case when base.is_own then '__own__' else ingest.normalize_competitor_key(coalesce(nullif(base.brand, ''), nullif(base.seller, ''), 'Без бренда')) end
  ),
  share_daily as (
    select
      brand_daily.date,
      max(brand_daily.amount) / nullif(sum(brand_daily.amount), 0) * 100 as leader_share,
      coalesce(max(brand_daily.amount) filter (where brand_daily.brand_key = '__own__'), 0) / nullif(sum(brand_daily.amount), 0) * 100 as own_share
    from brand_daily
    group by brand_daily.date
  )
  select
    dates.date,
    coalesce(main_daily.ordered_amount, 0),
    coalesce(main_daily.orders, 0),
    coalesce(main_daily.weighted_price, 0),
    coalesce(main_daily.impressions, 0),
    coalesce(main_daily.order_conversion, 0),
    coalesce(main_daily.buyout_rate, 0),
    coalesce(own_daily.ordered_amount, 0),
    coalesce(own_daily.orders, 0),
    coalesce(own_daily.weighted_price, 0),
    coalesce(own_daily.impressions, 0),
    coalesce(own_daily.order_conversion, 0),
    coalesce(own_daily.buyout_rate, 0),
    coalesce(share_daily.leader_share, 0),
    coalesce(share_daily.own_share, 0)
  from dates
  left join main_daily on main_daily.date = dates.date
  left join own_daily on own_daily.date = dates.date
  left join share_daily on share_daily.date = dates.date
  order by dates.date;
end
$$;

revoke all on function public.v5_competitor_overview_series(date, date, text, text) from public, anon;
grant execute on function public.v5_competitor_overview_series(date, date, text, text) to authenticated;

create or replace function public.v5_competitor_brand_summary(
  p_start date,
  p_end date,
  p_brand text default null,
  p_search text default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  total_count bigint,
  brand_key text,
  brand text,
  seller text,
  is_own boolean,
  articles bigint,
  ordered_amount numeric,
  orders bigint,
  weighted_price numeric,
  weighted_buyer_median_price numeric,
  avg_search_position numeric,
  share numeric,
  impressions bigint,
  clicks bigint,
  ctr numeric,
  carts bigint,
  cart_conversion numeric,
  order_conversion numeric,
  buyouts bigint,
  buyout_rate numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.v5_assert_competitor_read(p_start, p_end, 731);
  if p_limit is null or p_limit < 1 or p_limit > 100 then raise exception 'Competitor brand page limit must be between 1 and 100'; end if;
  if p_offset is null or p_offset < 0 or p_offset > 10000 then raise exception 'Competitor brand offset must be between 0 and 10000'; end if;
  if p_search is not null and length(p_search) > 100 then raise exception 'Competitor search must not exceed 100 characters'; end if;

  return query
  with base as (
    select
      row_data.*,
      exists (
        select 1 from core.products product
        where product.wb_sku = row_data.wb_article
          and app.can_access_cabinet(product.cabinet_id)
      ) as is_own
    from analytics.competitor_funnel_versions row_data
    where row_data.batch_id = app.v5_current_competitor_batch_id()
      and row_data.date between p_start and p_end
      and (nullif(btrim(p_brand), '') is null or row_data.brand = p_brand)
      and (nullif(btrim(p_search), '') is null or concat_ws(' ', row_data.wb_article, row_data.brand, row_data.seller) ilike '%' || btrim(p_search) || '%')
  ),
  grouped as (
    select
      case when base.is_own then '__own__' else ingest.normalize_competitor_key(coalesce(nullif(base.brand, ''), nullif(base.seller, ''), 'Без бренда')) end as brand_key,
      case when base.is_own then 'Наш ассортимент' else coalesce(nullif(min(base.brand), ''), 'Без бренда') end as brand,
      min(base.seller) as seller,
      base.is_own,
      count(distinct base.wb_article)::bigint as articles,
      sum(base.ordered_amount) as ordered_amount,
      sum(base.orders)::bigint as orders,
      coalesce(sum(base.discounted_price * base.orders) / nullif(sum(base.orders), 0), 0) as weighted_price,
      coalesce(sum(base.buyer_median_price * base.orders) / nullif(sum(base.orders), 0), 0) as weighted_buyer_median_price,
      coalesce(sum(base.avg_search_position * base.impressions) / nullif(sum(base.impressions), 0), 0) as avg_search_position,
      sum(base.impressions)::bigint as impressions,
      sum(base.clicks)::bigint as clicks,
      sum(base.carts)::bigint as carts,
      sum(base.buyouts)::bigint as buyouts,
      case when sum(base.orders) > 0 then sum(base.reported_buyout_rate * base.orders) / sum(base.orders) else avg(base.reported_buyout_rate) end as buyout_rate
    from base
    group by base.is_own, case when base.is_own then '__own__' else ingest.normalize_competitor_key(coalesce(nullif(base.brand, ''), nullif(base.seller, ''), 'Без бренда')) end
  )
  select
    count(*) over(), grouped.brand_key, grouped.brand, grouped.seller, grouped.is_own, grouped.articles,
    grouped.ordered_amount, grouped.orders, grouped.weighted_price, grouped.weighted_buyer_median_price,
    grouped.avg_search_position,
    grouped.ordered_amount / nullif(sum(grouped.ordered_amount) over(), 0) * 100,
    grouped.impressions, grouped.clicks,
    grouped.clicks::numeric / nullif(grouped.impressions, 0) * 100,
    grouped.carts,
    grouped.carts::numeric / nullif(grouped.impressions, 0) * 100,
    grouped.orders::numeric / nullif(grouped.impressions, 0) * 100,
    grouped.buyouts, coalesce(grouped.buyout_rate, 0)
  from grouped
  order by grouped.ordered_amount desc, grouped.brand_key
  limit p_limit offset p_offset;
end
$$;

revoke all on function public.v5_competitor_brand_summary(date, date, text, text, integer, integer) from public, anon;
grant execute on function public.v5_competitor_brand_summary(date, date, text, text, integer, integer) to authenticated;

create or replace function public.v5_competitor_article_page(
  p_start date,
  p_end date,
  p_brand text default null,
  p_search text default null,
  p_limit integer default 25,
  p_offset integer default 0
)
returns table (
  total_count bigint,
  wb_article text,
  brand text,
  seller text,
  is_own boolean,
  ordered_amount numeric,
  orders bigint,
  impressions bigint,
  order_conversion numeric,
  buyout_rate numeric,
  weighted_price numeric,
  stock bigint,
  avg_daily_orders numeric,
  stock_coverage numeric,
  warehouse_count bigint,
  product_name text,
  subject text,
  top_query text,
  query_requests bigint,
  latest_position integer,
  position_delta integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.v5_assert_competitor_read(p_start, p_end, 731);
  if p_limit is null or p_limit < 1 or p_limit > 100 then raise exception 'Competitor article page limit must be between 1 and 100'; end if;
  if p_offset is null or p_offset < 0 or p_offset > 100000 then raise exception 'Competitor article offset must be between 0 and 100000'; end if;
  if p_search is not null and length(p_search) > 100 then raise exception 'Competitor search must not exceed 100 characters'; end if;

  return query
  with base as (
    select row_data.*
    from analytics.competitor_funnel_versions row_data
    where row_data.batch_id = app.v5_current_competitor_batch_id()
      and row_data.date between p_start and p_end
      and (nullif(btrim(p_brand), '') is null or row_data.brand = p_brand)
      and (nullif(btrim(p_search), '') is null or concat_ws(' ', row_data.wb_article, row_data.brand, row_data.seller) ilike '%' || btrim(p_search) || '%')
  ),
  article as (
    select
      base.wb_article,
      (array_agg(base.brand order by base.date desc))[1] as brand,
      (array_agg(base.seller order by base.date desc))[1] as seller,
      sum(base.ordered_amount) as ordered_amount,
      sum(base.orders)::bigint as orders,
      sum(base.impressions)::bigint as impressions,
      coalesce(sum(base.orders)::numeric / nullif(sum(base.impressions), 0) * 100, 0) as order_conversion,
      coalesce(case when sum(base.orders) > 0 then sum(base.reported_buyout_rate * base.orders) / sum(base.orders) else avg(base.reported_buyout_rate) end, 0) as buyout_rate,
      coalesce(sum(base.discounted_price * base.orders) / nullif(sum(base.orders), 0), 0) as weighted_price,
      (array_agg(base.position order by base.date desc))[1] as fallback_position
    from base
    group by base.wb_article
  )
  select
    count(*) over(), article.wb_article, article.brand, article.seller,
    exists (
      select 1 from core.products product
      where product.wb_sku = article.wb_article
        and app.can_access_cabinet(product.cabinet_id)
    ),
    article.ordered_amount, article.orders, article.impressions, article.order_conversion, article.buyout_rate, article.weighted_price,
    coalesce(stock_info.stock, 0), coalesce(stock_info.avg_daily_orders, 0),
    coalesce(stock_info.stock / nullif(stock_info.avg_daily_orders, 0), 0),
    coalesce(stock_info.warehouse_count, 0), coalesce(stock_info.product_name, ''), coalesce(stock_info.subject, ''),
    coalesce(query_info.query, ''), coalesce(query_info.requests, 0),
    coalesce(position_info.latest_position, article.fallback_position), coalesce(position_info.first_position - position_info.latest_position, 0)
  from article
  left join lateral (
    with latest as (
      select max(stock.date) as date
      from analytics.competitor_stock_versions stock
      where stock.batch_id = app.v5_current_competitor_batch_id() and stock.wb_article = article.wb_article
    ), current_rows as (
      select stock.*
      from analytics.competitor_stock_versions stock, latest
      where stock.batch_id = app.v5_current_competitor_batch_id()
        and stock.wb_article = article.wb_article and stock.date = latest.date
    ), used as (
      select current_rows.*
      from current_rows
      where (exists (select 1 from current_rows test where test.normalized_warehouse = 'маркетплейс') and current_rows.normalized_warehouse = 'маркетплейс')
         or (not exists (select 1 from current_rows test where test.normalized_warehouse = 'маркетплейс'))
    )
    select
      sum(used.stock)::bigint as stock,
      sum(used.avg_daily_orders) as avg_daily_orders,
      (select count(*) from current_rows row_data where row_data.normalized_warehouse <> 'маркетплейс')::bigint as warehouse_count,
      (select min(row_data.name) from current_rows row_data) as product_name,
      (select min(row_data.subject) from current_rows row_data) as subject
    from used
  ) stock_info on true
  left join lateral (
    select search.query, search.requests
    from analytics.competitor_search_versions search
    where search.batch_id = app.v5_current_competitor_batch_id()
      and search.wb_article = article.wb_article and search.date between p_start and p_end
    order by search.requests desc, search.normalized_query
    limit 1
  ) query_info on true
  left join lateral (
    select
      (array_agg(position.position order by position.date))[1] as first_position,
      (array_agg(position.position order by position.date desc))[1] as latest_position
    from analytics.competitor_position_versions position
    where position.batch_id = app.v5_current_competitor_batch_id()
      and position.wb_article = article.wb_article and position.date between p_start and p_end
  ) position_info on true
  order by article.ordered_amount desc, article.wb_article
  limit p_limit offset p_offset;
end
$$;

revoke all on function public.v5_competitor_article_page(date, date, text, text, integer, integer) from public, anon;
grant execute on function public.v5_competitor_article_page(date, date, text, text, integer, integer) to authenticated;

create or replace function public.v5_competitor_query_leaders(
  p_start date,
  p_end date,
  p_limit integer default 10
)
returns table (query text, requests bigint, requests_previous bigint, articles bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.v5_assert_competitor_read(p_start, p_end, 731);
  if p_limit is null or p_limit < 1 or p_limit > 50 then raise exception 'Competitor query limit must be between 1 and 50'; end if;
  return query
  select min(row_data.query), max(row_data.requests), max(row_data.requests_previous), count(distinct row_data.wb_article)::bigint
  from analytics.competitor_search_versions row_data
  where row_data.batch_id = app.v5_current_competitor_batch_id() and row_data.date between p_start and p_end
  group by row_data.normalized_query
  order by max(row_data.requests) desc, row_data.normalized_query
  limit p_limit;
end
$$;

revoke all on function public.v5_competitor_query_leaders(date, date, integer) from public, anon;
grant execute on function public.v5_competitor_query_leaders(date, date, integer) to authenticated;

create or replace function public.v5_competitor_stock_slice(
  p_start date,
  p_end date,
  p_brands text[] default '{}'::text[],
  p_warehouses text[] default '{}'::text[]
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
  perform app.v5_assert_competitor_read(p_start, p_end, 731);
  if coalesce(array_length(p_brands, 1), 0) > 12 then raise exception 'At most 12 competitor stock brands can be selected'; end if;
  if coalesce(array_length(p_warehouses, 1), 0) > 20 then raise exception 'At most 20 competitor warehouses can be selected'; end if;

  with available_dates as (
    select min(stock.date) as date_start, max(stock.date) as date_end
    from analytics.competitor_stock_versions stock
    where stock.batch_id = app.v5_current_competitor_batch_id() and stock.date between p_start and p_end
  ),
  candidates as (
    select stock.*
    from analytics.competitor_stock_versions stock, available_dates bounds
    where stock.batch_id = app.v5_current_competitor_batch_id() and stock.date in (bounds.date_start, bounds.date_end)
  ),
  preferred as (
    select candidate.*
    from candidates candidate
    where candidate.normalized_warehouse <> 'маркетплейс'
       or not exists (
         select 1 from candidates detailed
         where detailed.date = candidate.date and detailed.wb_article = candidate.wb_article
           and detailed.normalized_warehouse <> 'маркетплейс'
       )
  ),
  filtered as (
    select preferred.*
    from preferred
    where (
      coalesce(array_length(p_brands, 1), 0) = 0
      or exists (select 1 from unnest(p_brands) selected(value) where ingest.normalize_competitor_key(selected.value) = ingest.normalize_competitor_key(preferred.brand))
    ) and (
      coalesce(array_length(p_warehouses, 1), 0) = 0
      or exists (select 1 from unnest(p_warehouses) selected(value) where ingest.normalize_competitor_key(selected.value) = preferred.normalized_warehouse)
    )
  ),
  totals as (
    select
      coalesce(sum(filtered.stock) filter (where filtered.date = bounds.date_start), 0) as previous,
      coalesce(sum(filtered.stock) filter (where filtered.date = bounds.date_end), 0) as current
    from filtered cross join available_dates bounds
  ),
  warehouse_rows as (
    select filtered.normalized_warehouse as key, min(filtered.warehouse) as warehouse, sum(filtered.stock) as stock
    from filtered cross join available_dates bounds
    where filtered.date = bounds.date_end
    group by filtered.normalized_warehouse
  ),
  brand_rows as (
    select
      ingest.normalize_competitor_key(coalesce(nullif(filtered.brand, ''), 'Без бренда')) as key,
      min(coalesce(nullif(filtered.brand, ''), 'Без бренда')) as brand,
      coalesce(sum(filtered.stock) filter (where filtered.date = bounds.date_start), 0) as previous,
      coalesce(sum(filtered.stock) filter (where filtered.date = bounds.date_end), 0) as current
    from filtered cross join available_dates bounds
    group by ingest.normalize_competitor_key(coalesce(nullif(filtered.brand, ''), 'Без бренда'))
  )
  select jsonb_build_object(
    'date_start', bounds.date_start,
    'date_end', bounds.date_end,
    'total_previous', totals.previous,
    'total_current', totals.current,
    'total_delta', totals.current - totals.previous,
    'warehouses', coalesce((select jsonb_agg(jsonb_build_object(
      'key', item.key, 'warehouse', item.warehouse, 'stock', item.stock,
      'share', item.stock::numeric / nullif(totals.current, 0) * 100
    ) order by item.stock desc, item.key) from warehouse_rows item), '[]'::jsonb),
    'brands', coalesce((select jsonb_agg(jsonb_build_object(
      'key', item.key, 'brand', item.brand, 'previous', item.previous, 'current', item.current,
      'delta', item.current - item.previous,
      'delta_rate', (item.current - item.previous)::numeric / nullif(item.previous, 0) * 100
    ) order by abs(item.current - item.previous) desc, item.key) from brand_rows item), '[]'::jsonb)
  ) into v_result
  from available_dates bounds cross join totals;

  return v_result;
end
$$;

revoke all on function public.v5_competitor_stock_slice(date, date, text[], text[]) from public, anon;
grant execute on function public.v5_competitor_stock_slice(date, date, text[], text[]) to authenticated;

create or replace function public.v5_competitor_top_summary(
  p_start date,
  p_end date,
  p_depth integer default 50
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
  perform app.v5_assert_competitor_read(p_start, p_end, 366);
  if p_depth not in (10, 20, 50) then raise exception 'Competitor TOP depth must be 10, 20 or 50'; end if;

  with snapshots as (
    select position.date, position.wb_article, min(position.position) as position,
      min(position.brand) as brand, min(position.seller) as seller
    from analytics.competitor_position_versions position
    where position.batch_id = app.v5_current_competitor_batch_id()
      and position.date between p_start and p_end and position.position <= p_depth
    group by position.date, position.wb_article
  ),
  dates as (
    select snapshots.date, lag(snapshots.date) over (order by snapshots.date) as previous_date
    from snapshots group by snapshots.date
  ),
  bounds as (
    select min(dates.date) as first_date, max(dates.date) as last_date from dates
  ),
  timeline as (
    select
      dates.date,
      count(current_row.wb_article)::bigint as size,
      count(current_row.wb_article) filter (where previous_row.wb_article is not null)::bigint as retained,
      count(current_row.wb_article) filter (where dates.previous_date is not null and previous_row.wb_article is null)::bigint as entrants,
      (select count(*) from snapshots exited where exited.date = dates.previous_date and not exists (
        select 1 from snapshots now_row where now_row.date = dates.date and now_row.wb_article = exited.wb_article
      ))::bigint as exits
    from dates
    join snapshots current_row on current_row.date = dates.date
    left join snapshots previous_row on previous_row.date = dates.previous_date and previous_row.wb_article = current_row.wb_article
    group by dates.date, dates.previous_date
  ),
  brand_keys as (
    select ingest.normalize_competitor_key(coalesce(nullif(snapshots.brand, ''), 'Без бренда')) as key,
      min(coalesce(nullif(snapshots.brand, ''), 'Без бренда')) as brand
    from snapshots group by ingest.normalize_competitor_key(coalesce(nullif(snapshots.brand, ''), 'Без бренда'))
  ),
  brand_matrix as (
    select brand_keys.key, brand_keys.brand,
      jsonb_agg(coalesce(counts.count, 0) order by date_list.date) as counts,
      coalesce(max(counts.count) filter (where date_list.date = bounds.last_date), 0) as latest,
      coalesce(max(counts.count) filter (where date_list.date = bounds.last_date), 0)
        - coalesce(max(counts.count) filter (where date_list.date = bounds.first_date), 0) as delta
    from brand_keys cross join (select date from dates) date_list cross join bounds
    left join (
      select snapshots.date, ingest.normalize_competitor_key(coalesce(nullif(snapshots.brand, ''), 'Без бренда')) as key, count(*)::bigint as count
      from snapshots group by snapshots.date, ingest.normalize_competitor_key(coalesce(nullif(snapshots.brand, ''), 'Без бренда'))
    ) counts on counts.date = date_list.date and counts.key = brand_keys.key
    group by brand_keys.key, brand_keys.brand, bounds.first_date, bounds.last_date
  ),
  retained as (
    select first_row.wb_article, first_row.position as first_position, last_row.position as last_position
    from snapshots first_row cross join bounds
    join snapshots last_row on last_row.date = bounds.last_date and last_row.wb_article = first_row.wb_article
    where first_row.date = bounds.first_date
  )
  select jsonb_build_object(
    'dates', coalesce((select jsonb_agg(dates.date order by dates.date) from dates), '[]'::jsonb),
    'timeline', coalesce((select jsonb_agg(jsonb_build_object(
      'date', item.date, 'size', item.size, 'retained', case when item.previous_date is null then 0 else item.retained end,
      'entrants', item.entrants, 'exits', item.exits,
      'retention_rate', case when item.previous_date is null then null else item.retained::numeric / nullif(item.retained + item.exits, 0) * 100 end
    ) order by item.date) from (select timeline.*, dates.previous_date from timeline join dates using (date)) item), '[]'::jsonb),
    'brand_structure', coalesce((select jsonb_agg(jsonb_build_object(
      'key', brand_matrix.key, 'brand', brand_matrix.brand, 'counts', brand_matrix.counts,
      'latest', brand_matrix.latest, 'delta', brand_matrix.delta
    ) order by brand_matrix.latest desc, brand_matrix.key) from brand_matrix), '[]'::jsonb),
    'stability_rate', (select count(*)::numeric from retained) / nullif((select count(*) from snapshots row_data, bounds where row_data.date = bounds.first_date), 0) * 100,
    'entrants', (select count(*) from snapshots row_data, bounds where row_data.date = bounds.last_date and not exists (select 1 from snapshots first_row where first_row.date = bounds.first_date and first_row.wb_article = row_data.wb_article)),
    'exits', (select count(*) from snapshots row_data, bounds where row_data.date = bounds.first_date and not exists (select 1 from snapshots last_row where last_row.date = bounds.last_date and last_row.wb_article = row_data.wb_article)),
    'average_movement', (select avg(abs(retained.first_position - retained.last_position)) from retained),
    'brands_latest', (select count(distinct ingest.normalize_competitor_key(coalesce(nullif(row_data.brand, ''), 'Без бренда'))) from snapshots row_data, bounds where row_data.date = bounds.last_date)
  ) into v_result;

  return v_result;
end
$$;

revoke all on function public.v5_competitor_top_summary(date, date, integer) from public, anon;
grant execute on function public.v5_competitor_top_summary(date, date, integer) to authenticated;

create or replace function public.v5_competitor_top_movements(
  p_start date,
  p_end date,
  p_depth integer default 50,
  p_status text default 'all',
  p_limit integer default 25,
  p_offset integer default 0
)
returns table (
  total_count bigint,
  wb_article text,
  brand text,
  seller text,
  baseline integer,
  comparison integer,
  best integer,
  worst integer,
  observed_days bigint,
  position_delta integer,
  movement_status text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.v5_assert_competitor_read(p_start, p_end, 366);
  if p_depth not in (10, 20, 50) then raise exception 'Competitor TOP depth must be 10, 20 or 50'; end if;
  if p_status not in ('all', 'retained', 'new', 'exited', 'intermittent') then raise exception 'Unknown competitor movement status'; end if;
  if p_limit is null or p_limit < 1 or p_limit > 100 then raise exception 'Competitor movement page limit must be between 1 and 100'; end if;
  if p_offset is null or p_offset < 0 or p_offset > 100000 then raise exception 'Competitor movement offset must be between 0 and 100000'; end if;

  return query
  with snapshots as (
    select position.date, position.wb_article, min(position.position) as position,
      min(position.brand) as brand, min(position.seller) as seller
    from analytics.competitor_position_versions position
    where position.batch_id = app.v5_current_competitor_batch_id()
      and position.date between p_start and p_end and position.position <= p_depth
    group by position.date, position.wb_article
  ),
  bounds as (select min(snapshots.date) as first_date, max(snapshots.date) as last_date from snapshots),
  movement as (
    select
      snapshots.wb_article,
      (array_agg(snapshots.brand order by snapshots.date desc))[1] as brand,
      (array_agg(snapshots.seller order by snapshots.date desc))[1] as seller,
      max(snapshots.position) filter (where snapshots.date = bounds.first_date) as baseline,
      max(snapshots.position) filter (where snapshots.date = bounds.last_date) as comparison,
      min(snapshots.position) as best,
      max(snapshots.position) as worst,
      count(*)::bigint as observed_days
    from snapshots cross join bounds
    group by snapshots.wb_article
  ),
  classified as (
    select movement.*,
      case
        when movement.baseline is not null and movement.comparison is not null then 'retained'
        when movement.baseline is null and movement.comparison is not null then 'new'
        when movement.baseline is not null then 'exited'
        else 'intermittent'
      end as status
    from movement
  )
  select count(*) over(), classified.wb_article, classified.brand, classified.seller,
    classified.baseline, classified.comparison, classified.best, classified.worst, classified.observed_days,
    case when classified.baseline is not null and classified.comparison is not null then classified.baseline - classified.comparison else null end,
    classified.status
  from classified
  where p_status = 'all' or classified.status = p_status
  order by classified.status, classified.wb_article
  limit p_limit offset p_offset;
end
$$;

revoke all on function public.v5_competitor_top_movements(date, date, integer, text, integer, integer) from public, anon;
grant execute on function public.v5_competitor_top_movements(date, date, integer, text, integer, integer) to authenticated;

create or replace function public.v5_health()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object('environment', 'analytics-v5', 'schema_version', '20260909013000', 'status', 'ok')
$$;

revoke all on function public.v5_health() from public;
grant execute on function public.v5_health() to anon, authenticated;

comment on function public.v5_competitor_overview_series(date, date, text, text) is 'Returns at most 732 daily aggregate rows for the current competitor batch without exposing raw funnel rows.';
comment on function public.v5_competitor_article_page(date, date, text, text, integer, integer) is 'Returns one bounded page of competitor cards with aggregated funnel values and latest supporting states.';
comment on function public.v5_competitor_stock_slice(date, date, text[], text[]) is 'Returns first/last stock snapshots with detailed warehouses taking precedence over Marketplace aggregates.';
comment on function public.v5_competitor_top_summary(date, date, integer) is 'Returns bounded TOP-10/20/50 timeline and brand structure for the current competitor batch.';

commit;
