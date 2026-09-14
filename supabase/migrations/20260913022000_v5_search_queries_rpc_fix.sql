begin;

create or replace function public.v5_search_queries_rows(
  p_start date, p_end date, p_category text default null, p_search text default null,
  p_sort text default 'requests', p_offset integer default 0, p_limit integer default 50
)
returns table (
  query text, category text, requests bigint, requests_previous bigint, card_clicks bigint, card_clicks_previous bigint,
  carts bigint, carts_previous bigint, orders bigint, orders_previous bigint, products bigint, products_previous bigint,
  order_amount numeric, order_amount_previous numeric, cart_cr numeric, order_cr numeric, growth numeric, opportunity numeric,
  total_count bigint
)
language plpgsql stable security definer set search_path = ''
as $$
declare v_days integer;
begin
  if not app.can_read() then raise exception 'V5 read access is required'; end if;
  if p_start is null or p_end is null or p_start > p_end or p_end - p_start > 1826 then raise exception 'Invalid search query period'; end if;
  if p_offset < 0 or p_limit < 1 or p_limit > 1000 then raise exception 'Invalid search query page bounds'; end if;
  if p_sort not in ('requests', 'growth', 'order_amount', 'orders', 'cart_cr', 'order_cr', 'opportunity', 'products') then raise exception 'Unsupported search query sort'; end if;
  v_days := p_end - p_start + 1;
  return query
  with grouped as (
    select data.query, data.category,
      sum(data.requests)::bigint requests, sum(data.requests_previous)::bigint requests_previous,
      sum(data.card_clicks)::bigint card_clicks, sum(data.card_clicks_previous)::bigint card_clicks_previous,
      sum(data.carts)::bigint carts, sum(data.carts_previous)::bigint carts_previous,
      sum(data.orders)::bigint orders, sum(data.orders_previous)::bigint orders_previous,
      max(data.products)::bigint products, max(data.products_previous)::bigint products_previous,
      coalesce(sum(data.orders * coalesce(nullif(market.reported_market_avg_check, 0), market.market_ordered_amount / nullif(market.market_orders, 0))), 0)::numeric order_amount,
      coalesce(sum(data.orders_previous * coalesce(nullif(previous_market.reported_market_avg_check, 0), previous_market.market_ordered_amount / nullif(previous_market.market_orders, 0))), 0)::numeric order_amount_previous
    from analytics.search_queries_current data
    left join analytics.market_daily_current market on market.date = data.date
    left join analytics.market_daily_current previous_market on previous_market.date = data.date - v_days
    where data.date between p_start and p_end
      and (p_category is null or data.category = p_category)
      and (nullif(btrim(p_search), '') is null or data.query like '%' || lower(btrim(p_search)) || '%')
    group by data.query, data.category
  ), enriched as (
    select grouped.*,
      case when grouped.card_clicks > 0 then grouped.carts * 100.0 / grouped.card_clicks else 0 end cart_cr,
      case when grouped.carts > 0 then grouped.orders * 100.0 / grouped.carts else 0 end order_cr,
      case when grouped.requests_previous > 0 then (grouped.requests - grouped.requests_previous) * 100.0 / grouped.requests_previous
        when grouped.requests > 0 then 100 else 0 end growth
    from grouped
  ), scored as (
    select enriched.*,
      log(enriched.requests + 1.0) * (100 - least(enriched.order_cr, 100)) / nullif(log(enriched.products + 10.0), 0) opportunity
    from enriched
  )
  select scored.query, scored.category, scored.requests, scored.requests_previous,
    scored.card_clicks, scored.card_clicks_previous, scored.carts, scored.carts_previous,
    scored.orders, scored.orders_previous, scored.products, scored.products_previous,
    scored.order_amount, scored.order_amount_previous, scored.cart_cr, scored.order_cr, scored.growth, scored.opportunity,
    count(*) over() total_count
  from scored
  order by
    case p_sort when 'requests' then scored.requests when 'orders' then scored.orders when 'products' then scored.products end desc nulls last,
    case p_sort when 'growth' then scored.growth when 'order_amount' then scored.order_amount when 'cart_cr' then scored.cart_cr when 'order_cr' then scored.order_cr when 'opportunity' then scored.opportunity end desc nulls last,
    scored.requests desc, scored.query, scored.category
  offset p_offset limit p_limit;
end
$$;

revoke all on function public.v5_search_queries_rows(date, date, text, text, text, integer, integer) from public, anon;
grant execute on function public.v5_search_queries_rows(date, date, text, text, text, integer, integer) to authenticated;

create or replace function public.v5_health()
returns jsonb language sql stable security invoker set search_path = ''
as $$ select jsonb_build_object('environment', 'analytics-v5', 'schema_version', '20260913022000', 'status', 'ok') $$;

revoke all on function public.v5_health() from public;
grant execute on function public.v5_health() to anon, authenticated;

comment on function public.v5_search_queries_rows(date, date, text, text, text, integer, integer) is 'Bounded server aggregation and pagination for V5 search queries; CTE fields are qualified to avoid PL/pgSQL output-name ambiguity.';

commit;
