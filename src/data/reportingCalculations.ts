import type { DailyMetrics, MarketDynamicsRecord, Product, ProfitabilityRecord } from '../types';
import { getReportGrossProfit, getReportMargin, getReportNetProfit } from './profitabilityCalculations.ts';

export interface ReportingPeriod {
  start: string;
  end: string;
}

export type ReportingGranularity = 'day' | 'week' | 'month';

export interface OwnSummary {
  orderedAmount: number;
  orders: number;
  adSpend: number;
  avgCheck: number | null;
  drr: number | null;
}

export interface FinanceSummary {
  revenue: number;
  grossProfit: number;
  netProfit: number;
  profitability: number | null;
}

export interface MarketSummary {
  marketAmount: number;
  ownAmount: number;
  marketOrders: number;
  ownOrders: number;
  amountShare: number | null;
  ordersShare: number | null;
  marketCheck: number | null;
  ownCheck: number | null;
}

export interface OwnPoint extends OwnSummary {
  date: string;
}

export interface MarketPoint extends MarketSummary {
  date: string;
}

const DAY_MS = 86400000;

function parseDate(value: string) {
  return new Date(`${value}T00:00:00`);
}

function formatDate(value: Date) {
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}

export function addDays(date: string, amount: number) {
  const value = parseDate(date);
  value.setDate(value.getDate() + amount);
  return formatDate(value);
}

export function previousPeriod(period: ReportingPeriod): ReportingPeriod {
  const days = Math.max(1, Math.round((parseDate(period.end).getTime() - parseDate(period.start).getTime()) / DAY_MS) + 1);
  const end = addDays(period.start, -1);
  return { start: addDays(end, -days + 1), end };
}

export function bucketDate(date: string, granularity: ReportingGranularity) {
  if (granularity === 'day') return date;
  if (granularity === 'month') return date.slice(0, 7);
  const value = parseDate(date);
  const day = value.getDay() || 7;
  value.setDate(value.getDate() - day + 1);
  return formatDate(value);
}

export function getPercentDelta(current: number, previous: number): number | null {
  return previous !== 0 ? (current - previous) / Math.abs(previous) * 100 : current !== 0 ? null : 0;
}

export function getPointsDelta(current: number | null, previous: number | null): number | null {
  return current !== null && previous !== null ? current - previous : null;
}

export function summarizeOwnMetrics(rows: DailyMetrics[], period?: ReportingPeriod, productIds?: Set<string>): OwnSummary {
  const selected = rows.filter(row =>
    (!period || (row.date >= period.start && row.date <= period.end))
    && (!productIds || productIds.has(row.product_id)),
  );
  const orderedAmount = selected.reduce((sum, row) => sum + Number(row.ordered_amount || 0), 0);
  const orders = selected.reduce((sum, row) => sum + Number(row.orders || 0), 0);
  const adSpend = selected.reduce((sum, row) => sum + Number(row.ad_spend || 0), 0);
  return {
    orderedAmount,
    orders,
    adSpend,
    avgCheck: orders > 0 ? orderedAmount / orders : null,
    drr: orderedAmount > 0 ? adSpend / orderedAmount * 100 : null,
  };
}

export function aggregateOwnMetrics(rows: DailyMetrics[], period: ReportingPeriod, granularity: ReportingGranularity, productIds?: Set<string>): OwnPoint[] {
  const buckets = new Map<string, DailyMetrics[]>();
  rows
    .filter(row => row.date >= period.start && row.date <= period.end && (!productIds || productIds.has(row.product_id)))
    .forEach(row => {
      const key = bucketDate(row.date, granularity);
      buckets.set(key, [...(buckets.get(key) || []), row]);
    });
  return [...buckets.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, values]) => ({ date, ...summarizeOwnMetrics(values) }));
}

export function summarizeFinance(
  records: ProfitabilityRecord[],
  productsById: Map<string, Product>,
  period: ReportingPeriod,
  getExtraExpensePct: (month: string, cabinetId: string) => number = () => 0,
  productIds?: Set<string>,
): FinanceSummary {
  let revenue = 0;
  let grossProfit = 0;
  let netProfit = 0;
  records.forEach(record => {
    if (record.period_end < period.start || record.period_start > period.end || (productIds && !productIds.has(record.product_id))) return;
    const product = productsById.get(record.product_id);
    const extraExpensePct = getExtraExpensePct(record.period_start.slice(0, 7), product?.cabinet_id || '');
    revenue += record.profit_revenue;
    grossProfit += getReportGrossProfit(record);
    netProfit += getReportNetProfit(record, extraExpensePct);
  });
  return {
    revenue,
    grossProfit,
    netProfit,
    profitability: revenue > 0 ? netProfit / revenue * 100 : null,
  };
}

export function summarizeMarket(rows: MarketDynamicsRecord[], period?: ReportingPeriod): MarketSummary {
  const selected = rows.filter(row => !period || (row.date >= period.start && row.date <= period.end));
  const marketAmount = selected.reduce((sum, row) => sum + Number(row.market_ordered_amount || 0), 0);
  const ownAmount = selected.reduce((sum, row) => sum + Number(row.own_ordered_amount || 0), 0);
  const marketOrders = selected.reduce((sum, row) => sum + Number(row.market_orders || 0), 0);
  const ownOrders = selected.reduce((sum, row) => sum + Number(row.own_orders || 0), 0);
  return {
    marketAmount,
    ownAmount,
    marketOrders,
    ownOrders,
    amountShare: marketAmount > 0 ? ownAmount / marketAmount * 100 : null,
    ordersShare: marketOrders > 0 ? ownOrders / marketOrders * 100 : null,
    marketCheck: marketOrders > 0 ? marketAmount / marketOrders : null,
    ownCheck: ownOrders > 0 ? ownAmount / ownOrders : null,
  };
}

export function aggregateMarket(rows: MarketDynamicsRecord[], period: ReportingPeriod, granularity: ReportingGranularity): MarketPoint[] {
  const buckets = new Map<string, MarketDynamicsRecord[]>();
  rows
    .filter(row => row.date >= period.start && row.date <= period.end)
    .forEach(row => {
      const key = bucketDate(row.date, granularity);
      buckets.set(key, [...(buckets.get(key) || []), row]);
    });
  return [...buckets.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, values]) => ({ date, ...summarizeMarket(values) }));
}

export function normalizeSeries(values: Array<number | null>): Array<number | null> {
  const base = values.find(value => value !== null && value !== 0);
  return values.map(value => base ? value === null ? null : value / base * 100 : null);
}

export function formatPeriod(period: ReportingPeriod) {
  return `${period.start.slice(8, 10)}.${period.start.slice(5, 7)} — ${period.end.slice(8, 10)}.${period.end.slice(5, 7)}`;
}

export function getReportMarginForTest(record: ProfitabilityRecord) {
  return getReportMargin(record);
}
