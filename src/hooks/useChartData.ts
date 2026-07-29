import { useMemo } from 'react';
import { useSyncExternalStore } from 'react';
import { subscribe, getVersion, getMetrics, getProfitabilityRecords, getProducts, getMemberships } from '../data/store';
import type { DailyMetrics } from '../types';
import { getFilteredProductIds } from '../data/productFilters';
import { subscribeExtraExpenses, getExtraExpensesVersion, getCabinetExtraExpense } from '../data/profitStore';
import { getReportNetProfit } from '../data/profitabilityCalculations';

export interface ChartDataPoint {
  date: string;
  values: Record<string, number>;
}

function sumDaily(rows: DailyMetrics[]): Record<string, number> {
  const s: Record<string, number> = {};
  for (const r of rows) {
    s.orders = (s.orders || 0) + r.orders;
    s.buyout_amount = (s.buyout_amount || 0) + r.buyout_amount;
    s.actual_profit = (s.actual_profit || 0) + r.actual_profit;
    s.profit_revenue = (s.profit_revenue || 0) + r.profit_revenue;
    s.ad_spend = (s.ad_spend || 0) + r.ad_spend;
    s.impressions = (s.impressions || 0) + r.impressions;
    s.clicks = (s.clicks || 0) + r.clicks;
    s.carts = (s.carts || 0) + r.carts;
    s.ordered_amount = (s.ordered_amount || 0) + r.ordered_amount;
  }
  return s;
}

function computeDerived(sum: Record<string, number>): Record<string, number> {
  const orders = sum.orders || 0;
  const impressions = sum.impressions || 0;
  const orderedAmt = sum.ordered_amount || 0;
  const buyoutAmt = sum.buyout_amount || 0;
  const profitRevenue = sum.profit_revenue || 0;
  const adSpend = sum.ad_spend || 0;
  return {
    fact_orders: orderedAmt,
    orders,
    revenue: profitRevenue || buyoutAmt,
    profit: sum.actual_profit || 0,
    margin: profitRevenue ? ((sum.actual_profit || 0) / profitRevenue) * 100 : 0,
    ad_spend: adSpend,
    impressions,
    clicks: sum.clicks || 0,
    ctr: impressions ? ((sum.clicks || 0) / impressions) * 100 : 0,
    carts: sum.carts || 0,
    cr_order: impressions ? (orders / impressions) * 100 : 0,
    drr: orderedAmt ? (adSpend / orderedAmt) * 100 : 0,
    avg_price: orders ? (orderedAmt / orders) : 0,
  };
}

export function useChartData(
  periodStart: string,
  periodEnd: string,
  cabinetFilter?: string,
  categoryFilter?: string,
  brandFilter?: string,
  groupFilter?: string,
  skuFilter?: string,
) {
  const storeVersion = useSyncExternalStore(subscribe, getVersion);
  const extraExpensesVersion = useSyncExternalStore(subscribeExtraExpenses, getExtraExpensesVersion);

  return useMemo(() => {
    void storeVersion;
    void extraExpensesVersion;
    const allMetrics = getMetrics();
    const allProfitability = getProfitabilityRecords();
    const productsById = new Map(getProducts().map(product => [product.id, product]));
    if (!allMetrics.length && !allProfitability.length) return [];

    const productIds = getFilteredProductIds(getProducts(), getMemberships(), {
      cabinetFilter,
      categoryFilter,
      brandFilter,
      groupFilter,
      skuFilter,
    });

    const reportRows = allProfitability.filter(record =>
      productIds.has(record.product_id)
      && record.period_start >= periodStart
      && record.period_start <= periodEnd
    );
    const reportKeys = new Set(reportRows.map(record => `${record.period_start}|${record.product_id}`));
    const dateMap = new Map<string, DailyMetrics[]>();
    for (const m of allMetrics) {
      if (!productIds.has(m.product_id)) continue;
      if (m.date < periodStart || m.date > periodEnd) continue;
      const row = reportKeys.has(`${m.date}|${m.product_id}`)
        ? { ...m, actual_profit: 0, actual_margin: 0, profit_revenue: 0, cost: 0, agent_fee: 0, logistics_cost: 0, marketing_cost: 0, storage_cost: 0 }
        : m;
      const arr = dateMap.get(m.date);
      if (arr) arr.push(row);
      else dateMap.set(m.date, [row]);
    }

    // Merge profitability records by date
    for (const r of reportRows) {
      let arr = dateMap.get(r.period_start);
      if (!arr) {
        arr = [];
        dateMap.set(r.period_start, arr);
      }
      // Add a synthetic row for this date with only profitability fields
      arr.push({
        date: r.period_start, product_id: r.product_id,
        impressions: 0, clicks: 0, carts: 0, orders: 0, buyouts: 0, cancellations: 0,
        ordered_amount: 0, buyout_amount: 0, cancellation_amount: 0,
        ad_impressions: 0, ad_clicks: 0, ad_orders: 0, ad_spend: 0,
        stock: 0, plan_orders: 0, forecast_profit_per_order: 0,
        actual_profit: getReportNetProfit(r, getCabinetExtraExpense(r.period_start.slice(0, 7), productsById.get(r.product_id)?.cabinet_id || '')),
        actual_margin: r.actual_margin,
        profit_revenue: r.profit_revenue,
        cost: 0,
        agent_fee: 0,
        logistics_cost: 0,
        marketing_cost: 0,
        storage_cost: 0,
      });
    }

    const sorted = [...dateMap.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    return sorted.map(([date, rows]): ChartDataPoint => {
      const values = computeDerived(sumDaily(rows));
      for (const row of rows) {
        const cabinetId = productsById.get(row.product_id)?.cabinet_id;
        if (!cabinetId) continue;
        const key = `cabinet_orders_${cabinetId}`;
        values[key] = (values[key] || 0) + row.ordered_amount;
      }
      return { date, values };
    });
  }, [periodStart, periodEnd, cabinetFilter, categoryFilter, brandFilter, groupFilter, skuFilter, extraExpensesVersion, storeVersion]);
}
