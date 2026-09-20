-- Bounded profitability reads and explicit monthly fixed-expense settings.

begin;

create table analytics.profitability_monthly_expenses (
  cabinet_id uuid not null references core.cabinets(id) on delete restrict,
  month date not null,
  expense_pct numeric(8, 4) not null,
  updated_at timestamptz not null default timezone('utc', now()),
  updated_by uuid references auth.users(id) on delete set null,
  primary key (cabinet_id, month),
  constraint profitability_expense_month_start check (month = date_trunc('month', month)::date),
  constraint profitability_expense_pct_range check (expense_pct between 0 and 100)
);

alter table analytics.profitability_monthly_expenses enable row level security;
create policy profitability_monthly_expenses_read_allowed
on analytics.profitability_monthly_expenses for select to authenticated
using (app.can_access_cabinet(cabinet_id));
revoke all on analytics.profitability_monthly_expenses from public, anon, authenticated;

create or replace function app.v5_assert_profitability_read(
  p_start date, p_end date, p_cabinet_ids uuid[] default null, p_product_ids uuid[] default null,
  p_category_ids uuid[] default null, p_brand_ids uuid[] default null, p_group_ids uuid[] default null,
  p_search text default null
)
returns void language plpgsql stable security definer set search_path = ''
as $$
begin
  if auth.uid() is null or not app.can_read() then raise exception 'V5 read access is required'; end if;
  if p_start is null or p_end is null or p_end < p_start or p_end - p_start > 731 then
    raise exception 'Profitability range is invalid or exceeds 731 days';
  end if;
  if coalesce(cardinality(p_cabinet_ids), 0) > 100 or coalesce(cardinality(p_category_ids), 0) > 100
    or coalesce(cardinality(p_brand_ids), 0) > 100 then raise exception 'Profitability directory filter is too large'; end if;
  if coalesce(cardinality(p_product_ids), 0) > 500 or coalesce(cardinality(p_group_ids), 0) > 500 then
    raise exception 'Profitability product or group filter is too large';
  end if;
  if length(coalesce(p_search, '')) > 100 then raise exception 'Profitability search must not exceed 100 characters'; end if;
  if exists (select 1 from unnest(coalesce(p_cabinet_ids, array[]::uuid[])) cabinet_id where not app.can_access_cabinet(cabinet_id)) then
    raise exception 'One or more requested cabinets are not accessible';
  end if;
end
$$;
revoke all on function app.v5_assert_profitability_read(date, date, uuid[], uuid[], uuid[], uuid[], uuid[], text) from public, anon, authenticated;

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
  select metric.date, metric.product_id, metric.cabinet_id, cabinet.name,
    product.category_id, category.name, product.brand_id, brand.name,
    membership.group_id, product_group.name, product.seller_sku, product.wb_sku, product.name,
    metric.quantity, metric.revenue, metric.cost, metric.agent_fee, metric.logistics_cost,
    metric.marketing_cost, metric.storage_cost, metric.gross_profit, metric.gross_margin,
    expense.expense_pct, metric.revenue * expense.expense_pct / 100,
    case when expense.expense_pct is null then null else metric.gross_profit - metric.revenue * expense.expense_pct / 100 end,
    case when expense.expense_pct is null or metric.revenue = 0 then null
      else (metric.gross_profit - metric.revenue * expense.expense_pct / 100) / metric.revenue * 100 end
  from app.v5_profitability_current(p_start, p_end) metric
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
    on expense.cabinet_id = metric.cabinet_id and expense.month = date_trunc('month', metric.date)::date
  where (p_cabinet_ids is null or metric.cabinet_id = any(p_cabinet_ids))
    and (p_product_ids is null or metric.product_id = any(p_product_ids))
    and (p_category_ids is null or product.category_id = any(p_category_ids))
    and (p_brand_ids is null or product.brand_id = any(p_brand_ids))
    and (p_group_ids is null or membership.group_id = any(p_group_ids))
    and (nullif(btrim(p_search), '') is null or product.name ilike '%' || btrim(p_search) || '%'
      or product.seller_sku ilike '%' || btrim(p_search) || '%' or product.wb_sku ilike '%' || btrim(p_search) || '%'
      or exists (select 1 from core.product_aliases alias where alias.product_id = product.id and alias.alias_value ilike '%' || btrim(p_search) || '%'));
end
$$;
revoke all on function app.v5_profitability_filtered(date, date, uuid[], uuid[], uuid[], uuid[], uuid[], text) from public, anon, authenticated;

create or replace function public.v5_profitability_bounds()
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_result jsonb;
begin
  if auth.uid() is null or not app.can_read() then raise exception 'V5 read access is required'; end if;
  select jsonb_build_object('min_date', min(version.date), 'max_date', max(version.date)) into v_result
  from analytics.profitability_metric_versions version join ingest.import_batches batch on batch.id = version.batch_id
  where batch.status = 'published' and app.can_access_cabinet(version.cabinet_id);
  return coalesce(v_result, jsonb_build_object('min_date', null, 'max_date', null));
end
$$;

create or replace function public.v5_profitability_filter_options(p_start date, p_end date, p_limit integer default 500)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_result jsonb;
begin
  perform app.v5_assert_profitability_read(p_start, p_end, null, null, null, null, null, null);
  if p_limit is null or p_limit < 1 or p_limit > 500 then raise exception 'Profitability filter limit must be between 1 and 500'; end if;
  with base as (select * from app.v5_profitability_filtered(p_start, p_end, null, null, null, null, null, null)),
  cabinets as (select distinct base.cabinet_id id, base.cabinet_name name from base order by name, id limit p_limit),
  categories as (select distinct base.category_id id, base.category_name name from base where base.category_id is not null order by name, id limit p_limit),
  brands as (select distinct base.brand_id id, base.brand_name name from base where base.brand_id is not null order by name, id limit p_limit),
  groups as (select distinct base.group_id id, base.group_name name from base where base.group_id is not null order by name, id limit p_limit)
  select jsonb_build_object(
    'cabinets', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name) order by x.name, x.id) from cabinets x), '[]'::jsonb),
    'categories', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name) order by x.name, x.id) from categories x), '[]'::jsonb),
    'brands', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name) order by x.name, x.id) from brands x), '[]'::jsonb),
    'groups', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name) order by x.name, x.id) from groups x), '[]'::jsonb)
  ) into v_result;
  return v_result;
end
$$;

create or replace function public.v5_profitability_expenses(p_start date, p_end date)
returns table (cabinet_id uuid, cabinet_name text, month date, expense_pct numeric)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform app.v5_assert_profitability_read(p_start, p_end, null, null, null, null, null, null);
  return query select expense.cabinet_id, cabinet.name, expense.month, expense.expense_pct
  from analytics.profitability_monthly_expenses expense join core.cabinets cabinet on cabinet.id = expense.cabinet_id
  where expense.month between date_trunc('month', p_start)::date and date_trunc('month', p_end)::date
    and app.can_access_cabinet(expense.cabinet_id)
  order by expense.month, cabinet.name, expense.cabinet_id;
end
$$;

create or replace function public.v5_profitability_set_expense(p_cabinet_id uuid, p_month date, p_expense_pct numeric)
returns jsonb language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null or not app.is_admin() then raise exception 'V5 administrator access is required'; end if;
  if p_cabinet_id is null or not app.can_access_cabinet(p_cabinet_id) then raise exception 'Accessible cabinet is required'; end if;
  if p_month is null or p_month <> date_trunc('month', p_month)::date then raise exception 'Expense month must be the first day of month'; end if;
  if p_expense_pct is null or p_expense_pct < 0 or p_expense_pct > 100 then raise exception 'Expense percentage must be between 0 and 100'; end if;
  insert into analytics.profitability_monthly_expenses (cabinet_id, month, expense_pct, updated_by)
  values (p_cabinet_id, p_month, p_expense_pct, auth.uid())
  on conflict (cabinet_id, month) do update set expense_pct = excluded.expense_pct, updated_at = timezone('utc', now()), updated_by = auth.uid();
  return jsonb_build_object('cabinet_id', p_cabinet_id, 'month', p_month, 'expense_pct', p_expense_pct);
end
$$;

create or replace function public.v5_profitability_summary(
  p_start date, p_end date, p_cabinet_ids uuid[] default null, p_product_ids uuid[] default null,
  p_category_ids uuid[] default null, p_brand_ids uuid[] default null, p_group_ids uuid[] default null, p_search text default null
)
returns table (quantity numeric, revenue numeric, direct_costs numeric, gross_profit numeric, gross_margin numeric,
  expense_amount numeric, net_profit numeric, profitability numeric, product_count bigint, expenses_configured boolean)
language plpgsql stable security definer set search_path = ''
as $$
begin
  return query with base as (select * from app.v5_profitability_filtered(p_start, p_end, p_cabinet_ids, p_product_ids, p_category_ids, p_brand_ids, p_group_ids, p_search)),
  total as (select coalesce(sum(base.quantity), 0) quantity, coalesce(sum(base.revenue), 0) revenue,
    coalesce(sum(base.cost + base.agent_fee + base.logistics_cost + base.marketing_cost + base.storage_cost), 0) direct_costs,
    coalesce(sum(base.gross_profit), 0) gross_profit, sum(base.expense_amount) expense_amount,
    bool_and(base.expense_pct is not null) expenses_configured, count(distinct base.product_id) product_count from base)
  select total.quantity, total.revenue, total.direct_costs, total.gross_profit,
    case when total.revenue = 0 then null else total.gross_profit / total.revenue * 100 end,
    case when total.expenses_configured then coalesce(total.expense_amount, 0) else null end,
    case when total.expenses_configured then total.gross_profit - coalesce(total.expense_amount, 0) else null end,
    case when total.expenses_configured and total.revenue <> 0 then (total.gross_profit - coalesce(total.expense_amount, 0)) / total.revenue * 100 else null end,
    total.product_count, coalesce(total.expenses_configured, false) from total;
end
$$;

create or replace function public.v5_profitability_series(
  p_start date, p_end date, p_cabinet_ids uuid[] default null, p_product_ids uuid[] default null,
  p_category_ids uuid[] default null, p_brand_ids uuid[] default null, p_group_ids uuid[] default null, p_search text default null
)
returns table (period_date date, revenue numeric, gross_profit numeric, gross_margin numeric, expense_amount numeric, net_profit numeric, profitability numeric, expenses_configured boolean)
language plpgsql stable security definer set search_path = ''
as $$
begin
  return query select base.date, sum(base.revenue), sum(base.gross_profit),
    case when sum(base.revenue) = 0 then null else sum(base.gross_profit) / sum(base.revenue) * 100 end,
    case when bool_and(base.expense_pct is not null) then sum(base.expense_amount) else null end,
    case when bool_and(base.expense_pct is not null) then sum(base.gross_profit) - sum(base.expense_amount) else null end,
    case when bool_and(base.expense_pct is not null) and sum(base.revenue) <> 0 then (sum(base.gross_profit) - sum(base.expense_amount)) / sum(base.revenue) * 100 else null end,
    bool_and(base.expense_pct is not null)
  from app.v5_profitability_filtered(p_start, p_end, p_cabinet_ids, p_product_ids, p_category_ids, p_brand_ids, p_group_ids, p_search) base
  group by base.date order by base.date;
end
$$;

create or replace function public.v5_profitability_rows(
  p_start date, p_end date, p_cabinet_ids uuid[] default null, p_product_ids uuid[] default null,
  p_category_ids uuid[] default null, p_brand_ids uuid[] default null, p_group_ids uuid[] default null, p_search text default null,
  p_sort text default 'revenue', p_offset integer default 0, p_limit integer default 100
)
returns table (product_id uuid, cabinet_id uuid, cabinet_name text, group_id uuid, group_name text,
  seller_sku text, wb_sku text, product_name text, quantity numeric, revenue numeric, direct_costs numeric,
  gross_profit numeric, gross_margin numeric, expense_pct numeric, expense_amount numeric, net_profit numeric,
  profitability numeric, expenses_configured boolean, total_count bigint)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform app.v5_assert_profitability_read(p_start, p_end, p_cabinet_ids, p_product_ids, p_category_ids, p_brand_ids, p_group_ids, p_search);
  if p_sort not in ('revenue', 'gross_profit', 'gross_margin', 'net_profit', 'profitability') then raise exception 'Profitability sort is invalid'; end if;
  if p_offset is null or p_offset < 0 or p_offset > 100000 then raise exception 'Profitability offset is invalid'; end if;
  if p_limit is null or p_limit < 1 or p_limit > 1000 then raise exception 'Profitability limit must be between 1 and 1000'; end if;
  return query with grouped as (
    select base.product_id, base.cabinet_id, min(base.cabinet_name) cabinet_name, base.group_id, min(base.group_name) group_name,
      min(base.seller_sku) seller_sku, min(base.wb_sku) wb_sku, min(base.product_name) product_name,
      coalesce(sum(base.quantity), 0) quantity, sum(base.revenue) revenue,
      sum(base.cost + base.agent_fee + base.logistics_cost + base.marketing_cost + base.storage_cost) direct_costs,
      sum(base.gross_profit) gross_profit,
      case when sum(base.revenue) = 0 then null else sum(base.gross_profit) / sum(base.revenue) * 100 end gross_margin,
      case when min(base.expense_pct) = max(base.expense_pct) and bool_and(base.expense_pct is not null) then min(base.expense_pct) else null end expense_pct,
      case when bool_and(base.expense_pct is not null) then sum(base.expense_amount) else null end expense_amount,
      case when bool_and(base.expense_pct is not null) then sum(base.gross_profit) - sum(base.expense_amount) else null end net_profit,
      case when bool_and(base.expense_pct is not null) and sum(base.revenue) <> 0 then (sum(base.gross_profit) - sum(base.expense_amount)) / sum(base.revenue) * 100 else null end profitability,
      bool_and(base.expense_pct is not null) expenses_configured
    from app.v5_profitability_filtered(p_start, p_end, p_cabinet_ids, p_product_ids, p_category_ids, p_brand_ids, p_group_ids, p_search) base
    group by base.product_id, base.cabinet_id, base.group_id
  ), counted as (select grouped.*, count(*) over () total_count from grouped)
  select counted.product_id, counted.cabinet_id, counted.cabinet_name, counted.group_id, counted.group_name,
    counted.seller_sku, counted.wb_sku, counted.product_name, counted.quantity, counted.revenue, counted.direct_costs,
    counted.gross_profit, counted.gross_margin, counted.expense_pct, counted.expense_amount, counted.net_profit,
    counted.profitability, counted.expenses_configured, counted.total_count
  from counted order by case p_sort when 'revenue' then counted.revenue when 'gross_profit' then counted.gross_profit
    when 'gross_margin' then counted.gross_margin when 'net_profit' then counted.net_profit when 'profitability' then counted.profitability end desc nulls last,
    counted.product_id, counted.group_id nulls first offset p_offset limit p_limit;
end
$$;

revoke all on function public.v5_profitability_bounds() from public, anon; grant execute on function public.v5_profitability_bounds() to authenticated;
revoke all on function public.v5_profitability_filter_options(date, date, integer) from public, anon; grant execute on function public.v5_profitability_filter_options(date, date, integer) to authenticated;
revoke all on function public.v5_profitability_expenses(date, date) from public, anon; grant execute on function public.v5_profitability_expenses(date, date) to authenticated;
revoke all on function public.v5_profitability_set_expense(uuid, date, numeric) from public, anon; grant execute on function public.v5_profitability_set_expense(uuid, date, numeric) to authenticated;
revoke all on function public.v5_profitability_summary(date, date, uuid[], uuid[], uuid[], uuid[], uuid[], text) from public, anon; grant execute on function public.v5_profitability_summary(date, date, uuid[], uuid[], uuid[], uuid[], uuid[], text) to authenticated;
revoke all on function public.v5_profitability_series(date, date, uuid[], uuid[], uuid[], uuid[], uuid[], text) from public, anon; grant execute on function public.v5_profitability_series(date, date, uuid[], uuid[], uuid[], uuid[], uuid[], text) to authenticated;
revoke all on function public.v5_profitability_rows(date, date, uuid[], uuid[], uuid[], uuid[], uuid[], text, text, integer, integer) from public, anon; grant execute on function public.v5_profitability_rows(date, date, uuid[], uuid[], uuid[], uuid[], uuid[], text, text, integer, integer) to authenticated;

create or replace function public.v5_health()
returns jsonb language sql stable security invoker set search_path = ''
as $$ select jsonb_build_object('environment', 'analytics-v5', 'schema_version', '20260920032000', 'status', 'ok') $$;
revoke all on function public.v5_health() from public; grant execute on function public.v5_health() to anon, authenticated;

commit;
