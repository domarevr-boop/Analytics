import assert from 'node:assert/strict';
import test from 'node:test';
import type { DailyMetrics, MarketDynamicsRecord, Product, ProfitabilityRecord } from '../types';
import {
  aggregateMarket,
  aggregateOwnMetrics,
  normalizeSeries,
  previousPeriod,
  summarizeFinance,
  summarizeMarket,
  summarizeOwnMetrics,
} from './reportingCalculations.ts';

const metric = (date: string, product_id = 'p1', overrides: Partial<DailyMetrics> = {}): DailyMetrics => ({
  date, product_id, impressions: 0, clicks: 0, carts: 0, orders: 0, buyouts: 0, cancellations: 0,
  ordered_amount: 0, buyout_amount: 0, cancellation_amount: 0, ad_impressions: 0, ad_clicks: 0,
  ad_orders: 0, ad_spend: 0, stock: 0, plan_orders: 0, forecast_profit_per_order: 0, actual_profit: 0,
  actual_margin: 0, profit_revenue: 0, cost: 0, agent_fee: 0, logistics_cost: 0, marketing_cost: 0,
  storage_cost: 0, ...overrides,
});

const product: Product = { id: 'p1', sku: '1', wb_sku: '1', name: 'Товар', category: 'Категория', brand_id: 'b1', cabinet_id: 'c1' };
const profitability = (id: string, start: string, end: string, revenue: number, margin: number): ProfitabilityRecord => ({
  id, product_id: 'p1', period_start: start, period_end: end, actual_profit: revenue * margin / 100, actual_margin: margin, profit_revenue: revenue,
});

test('previousPeriod creates an equal calendar period immediately before current', () => {
  assert.deepEqual(previousPeriod({ start: '2026-08-10', end: '2026-08-16' }), { start: '2026-08-03', end: '2026-08-09' });
});

test('own summary aggregates money, units, ad spend and derived values', () => {
  const rows = [
    metric('2026-08-10', 'p1', { ordered_amount: 1000, orders: 4, ad_spend: 100 }),
    metric('2026-08-11', 'p2', { ordered_amount: 500, orders: 1, ad_spend: 25 }),
  ];
  const summary = summarizeOwnMetrics(rows, { start: '2026-08-10', end: '2026-08-11' });
  assert.deepEqual(summary, { orderedAmount: 1500, orders: 5, adSpend: 125, avgCheck: 300, drr: 125 / 1500 * 100 });
  assert.deepEqual(
    summarizeOwnMetrics(rows, { start: '2026-08-10', end: '2026-08-11' }, new Set(['p1'])),
    { orderedAmount: 1000, orders: 4, adSpend: 100, avgCheck: 250, drr: 10 },
  );
  assert.equal(aggregateOwnMetrics(rows, { start: '2026-08-10', end: '2026-08-11' }, 'day').length, 2);
  assert.equal(aggregateOwnMetrics(rows, { start: '2026-08-10', end: '2026-08-11' }, 'day', new Set(['p1'])).length, 1);
});

test('finance profitability is calculated from summed money, not average row percentages', () => {
  const records = [
    profitability('r1', '2026-08-10', '2026-08-10', 100, 10),
    profitability('r2', '2026-08-11', '2026-08-11', 900, 20),
  ];
  const summary = summarizeFinance(records, new Map([['p1', product]]), { start: '2026-08-10', end: '2026-08-11' }, () => 5);
  assert.equal(summary.revenue, 1000);
  assert.equal(summary.netProfit, 140);
  assert.ok(Math.abs((summary.profitability || 0) - 14) < 1e-9);
});

test('market summary recalculates shares and checks from aggregate denominators', () => {
  const rows: MarketDynamicsRecord[] = [
    { date: '2026-08-10', market_ordered_amount: 1000, own_ordered_amount: 200, amount_share: 0, market_orders: 10, own_orders: 2, orders_share: 0, own_avg_check: 0, market_avg_check: 0 },
    { date: '2026-08-11', market_ordered_amount: 3000, own_ordered_amount: 600, amount_share: 0, market_orders: 30, own_orders: 6, orders_share: 0, own_avg_check: 0, market_avg_check: 0 },
  ];
  const summary = summarizeMarket(rows, { start: '2026-08-10', end: '2026-08-11' });
  assert.equal(summary.amountShare, 20);
  assert.equal(summary.ordersShare, 20);
  assert.equal(summary.marketCheck, 100);
  assert.equal(summary.ownCheck, 100);
  assert.equal(aggregateMarket(rows, { start: '2026-08-10', end: '2026-08-11' }, 'day')[0].marketAmount, 1000);
});

test('normalization leaves missing values missing and uses first non-zero base', () => {
  assert.deepEqual(normalizeSeries([null, 0, 10, 15]), [null, 0, 100, 150]);
  assert.deepEqual(normalizeSeries([null, 0]), [null, null]);
});
