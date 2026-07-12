import { useState, useMemo } from 'react';
import { useSyncExternalStore } from 'react';
import { subscribe, getVersion, getMetrics, getProducts, getCabinets, getGroups, getMemberships } from '../data/store';
import type { DailyMetrics } from '../types';
import MetricMultiSelect from './MetricMultiSelect';
import TimeSeriesChart from './TimeSeriesChart';
import MiniCharts from './MiniCharts';

interface ChartsBlockProps {
  periodStart: string;
  periodEnd: string;
  cabinetFilter?: string;
  brandFilter?: string;
  groupFilter?: string;
}

function sumDaily(rows: DailyMetrics[]): Record<string, number> {
  const s: Record<string, number> = {};
  for (const r of rows) {
    s.orders = (s.orders || 0) + r.orders;
    s.buyout_amount = (s.buyout_amount || 0) + r.buyout_amount;
    s.actual_profit = (s.actual_profit || 0) + r.actual_profit;
    s.ad_spend = (s.ad_spend || 0) + r.ad_spend;
    s.impressions = (s.impressions || 0) + r.impressions;
    s.clicks = (s.clicks || 0) + r.clicks;
    s.carts = (s.carts || 0) + r.carts;
    s.ordered_amount = (s.ordered_amount || 0) + r.ordered_amount;
  }
  return s;
}

function computeDerived(sum: Record<string, number>, count: number): Record<string, number> {
  const orders = sum.orders || 0;
  const impressions = sum.impressions || 0;
  const orderedAmt = sum.ordered_amount || 0;
  const buyoutAmt = sum.buyout_amount || 0;
  const adSpend = sum.ad_spend || 0;
  return {
    orders,
    revenue: buyoutAmt,
    profit: sum.actual_profit || 0,
    margin: buyoutAmt ? ((sum.actual_profit || 0) / buyoutAmt) * 100 : 0,
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

export default function ChartsBlock({ periodStart, periodEnd, cabinetFilter, brandFilter, groupFilter }: ChartsBlockProps) {
  useSyncExternalStore(subscribe, getVersion);
  const [selectedMetrics, setSelectedMetrics] = useState<string[]>(['orders']);

  const chartData = useMemo(() => {
    const allMetrics = getMetrics();
    if (!allMetrics.length) return [];

    const products = getProducts();
    let productIds = new Set(products.map(p => p.id));

    if (cabinetFilter) {
      productIds = new Set(products.filter(p => p.cabinet_id === cabinetFilter).map(p => p.id));
    }
    if (brandFilter) {
      const brandIds = new Set(products.filter(p => p.brand_id === brandFilter).map(p => p.id));
      productIds = new Set([...productIds].filter(id => brandIds.has(id)));
    }
    if (groupFilter) {
      const memberships = getMemberships();
      const groupIds = new Set(memberships.filter(m => m.group_id === groupFilter).map(m => m.product_id));
      productIds = new Set([...productIds].filter(id => groupIds.has(id)));
    }

    const dateMap = new Map<string, DailyMetrics[]>();
    for (const m of allMetrics) {
      if (!productIds.has(m.product_id)) continue;
      if (m.date < periodStart || m.date > periodEnd) continue;
      const arr = dateMap.get(m.date);
      if (arr) arr.push(m);
      else dateMap.set(m.date, [m]);
    }

    const sorted = [...dateMap.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    return sorted.map(([date, rows]) => ({
      date,
      values: computeDerived(sumDaily(rows), rows.length),
    }));
  }, [periodStart, periodEnd, cabinetFilter, brandFilter, groupFilter]);

  return (
    <div className="charts-block">
      <div className="charts-toolbar">
        <span className="charts-toolbar-label">Графики</span>
        <MetricMultiSelect selected={selectedMetrics} onChange={setSelectedMetrics} />
      </div>
      <TimeSeriesChart data={chartData} selectedMetrics={selectedMetrics} />
      <MiniCharts data={chartData} />
    </div>
  );
}
