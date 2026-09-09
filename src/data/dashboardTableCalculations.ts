import type { MetricValues, TableRow } from '../types';

export type DashboardQuartile = 'Q1' | 'Q2' | 'Q3' | 'Q4';

const ADDITIVE_KEYS: Array<keyof MetricValues> = [
  'impressions', 'clicks', 'carts', 'orders',
  'ad_spend', 'ad_clicks', 'ad_orders',
  'plan_orders', 'plan_orders_qty', 'plan_sum', 'plan_net_profit', 'plan_revenue',
  'fact_orders', 'revenue', 'effectiveRevenue', 'buyout_amount', 'profit', 'stock',
];

export function emptyDashboardMetrics(): MetricValues {
  return {
    impressions: 0, clicks: 0, ctr: 0, carts: 0, cr_cart: 0, orders: 0,
    avg_price: 0, cr_order: 0, ad_spend: 0, ad_clicks: 0, ad_orders: 0,
    cpc: 0, cpo: 0, drr: 0, drrForecast: 0, drrActual: 0,
    plan_orders: 0, plan_orders_qty: 0, plan_sum: 0, plan_price: 0,
    plan_net_profit: 0, plan_profitability: 0, plan_revenue: 0,
    fact_orders: 0, plan_pct: 0, revenue: 0, effectiveRevenue: 0,
    buyout_amount: 0, profit: 0, margin: 0, stock: 0,
  };
}

export function aggregateDashboardMetrics(values: MetricValues[]): MetricValues {
  const total = emptyDashboardMetrics();
  for (const value of values) {
    for (const key of ADDITIVE_KEYS) total[key] += value[key];
  }
  total.ctr = total.impressions ? total.clicks / total.impressions * 100 : 0;
  total.cr_cart = total.impressions ? total.carts / total.impressions * 100 : 0;
  total.cr_order = total.impressions ? total.orders / total.impressions * 100 : 0;
  total.avg_price = total.orders ? total.fact_orders / total.orders : 0;
  total.plan_price = total.plan_orders_qty ? total.plan_sum / total.plan_orders_qty : 0;
  total.plan_profitability = total.plan_revenue ? total.plan_net_profit / total.plan_revenue * 100 : 0;
  total.cpc = total.ad_clicks ? total.ad_spend / total.ad_clicks : 0;
  total.cpo = total.ad_orders ? total.ad_spend / total.ad_orders : 0;
  total.drr = total.fact_orders ? total.ad_spend / total.fact_orders * 100 : 0;
  total.drrForecast = total.effectiveRevenue ? total.ad_spend / total.effectiveRevenue * 100 : 0;
  total.drrActual = total.buyout_amount ? total.ad_spend / total.buyout_amount * 100 : 0;
  total.plan_pct = total.plan_orders ? total.fact_orders / total.plan_orders * 100 : 0;
  total.margin = total.revenue ? total.profit / total.revenue * 100 : 0;
  return total;
}

export function dashboardFactPerDay(fact: number, elapsedDays: number, recentDailyValues: number[]): number {
  if (recentDailyValues.length > 0) {
    return recentDailyValues.reduce((sum, value) => sum + value, 0) / recentDailyValues.length;
  }
  return elapsedDays > 0 ? fact / elapsedDays : 0;
}

export function totalDashboardFactPerDay(childValues: number[]): number {
  return childValues.reduce((sum, value) => sum + value, 0);
}

export function dashboardForecastCompletionPct(forecast: number, plan: number): number {
  return plan > 0 ? forecast / plan * 100 : 0;
}

export function dashboardDailyShortfall(factPerDay: number, planPerDay: number): number {
  return Math.max(0, planPerDay - factPerDay);
}

export function dashboardActualShare(value: number, total: number): number | null {
  return total !== 0 ? value / total * 100 : null;
}

export function classifyDashboardQuartiles(rows: Array<{ id: string; value: number | null }>): Map<string, DashboardQuartile> {
  const ranked = rows
    .filter((row): row is { id: string; value: number } => row.value !== null && Number.isFinite(row.value))
    .sort((left, right) => right.value - left.value || left.id.localeCompare(right.id));
  const result = new Map<string, DashboardQuartile>();
  if (!ranked.length) return result;

  const baseSize = Math.floor(ranked.length / 4);
  const largerBuckets = ranked.length % 4;
  let index = 0;
  for (let quartile = 1; quartile <= 4; quartile++) {
    const bucketSize = baseSize + (quartile <= largerBuckets ? 1 : 0);
    for (let offset = 0; offset < bucketSize; offset++) {
      result.set(ranked[index].id, `Q${quartile}` as DashboardQuartile);
      index++;
    }
  }
  return result;
}

export function sortDashboardSiblingsByOrders(rows: TableRow[]): TableRow[] {
  return [...rows].sort((left, right) =>
    right.current.fact_orders - left.current.fact_orders
    || right.current.orders - left.current.orders
    || left.name.localeCompare(right.name, 'ru'),
  );
}
