import test from 'node:test';
import assert from 'node:assert/strict';
import type { MetricValues, TableRow } from '../types/index.ts';
import { aggregateDashboardMetrics, dashboardFactPerDay, sortDashboardSiblingsByOrders, totalDashboardFactPerDay } from './dashboardTableCalculations.ts';

const metrics = (factOrders: number, orders = 0): MetricValues => ({
  impressions: 0,
  clicks: 0,
  ctr: 0,
  carts: 0,
  cr_cart: 0,
  orders,
  avg_price: 0,
  cr_order: 0,
  ad_spend: 0,
  ad_clicks: 0,
  ad_orders: 0,
  cpc: 0,
  cpo: 0,
  drr: 0,
  drrForecast: 0,
  drrActual: 0,
  plan_orders: 0,
  plan_orders_qty: 0,
  plan_sum: 0,
  plan_price: 0,
  plan_net_profit: 0,
  plan_profitability: 0,
  plan_revenue: 0,
  fact_orders: factOrders,
  plan_pct: 0,
  revenue: 0,
  effectiveRevenue: 0,
  buyout_amount: 0,
  profit: 0,
  margin: 0,
  stock: 0,
});

const row = (id: string, name: string, factOrders: number, orders = 0): TableRow => ({
  id,
  type: 'category',
  name,
  parent: 'cabinet',
  depth: 1,
  current: metrics(factOrders, orders),
  previous: metrics(0),
});

test('sorts dashboard siblings by current order amount without mutating the source', () => {
  const source = [row('a', 'А', 100), row('b', 'Б', 300), row('c', 'В', 200)];
  const result = sortDashboardSiblingsByOrders(source);

  assert.deepEqual(result.map(item => item.id), ['b', 'c', 'a']);
  assert.deepEqual(source.map(item => item.id), ['a', 'b', 'c']);
});

test('uses order quantity and then name as stable fallbacks', () => {
  const source = [row('b', 'Бета', 0, 2), row('a', 'Альфа', 0, 2), row('c', 'Гамма', 0, 5)];

  assert.deepEqual(sortDashboardSiblingsByOrders(source).map(item => item.id), ['c', 'a', 'b']);
});

test('aggregates totals and recalculates weighted rates from their bases', () => {
  const first = metrics(400, 4);
  Object.assign(first, { impressions: 100, clicks: 20, carts: 10, ad_spend: 40, revenue: 300, profit: 60 });
  const second = metrics(900, 6);
  Object.assign(second, { impressions: 300, clicks: 30, carts: 30, ad_spend: 90, revenue: 700, profit: 140 });

  const total = aggregateDashboardMetrics([first, second]);

  assert.equal(total.fact_orders, 1300);
  assert.equal(total.orders, 10);
  assert.equal(total.avg_price, 130);
  assert.equal(total.ctr, 12.5);
  assert.equal(total.cr_cart, 10);
  assert.equal(total.cr_order, 2.5);
  assert.equal(total.drr, 10);
  assert.equal(total.margin, 20);
});

test('uses the recent daily average even when it is zero', () => {
  assert.equal(dashboardFactPerDay(600, 6, [0, 0]), 0);
  assert.equal(dashboardFactPerDay(600, 6, []), 100);
});

test('total daily fact is the sum of cabinet daily facts', () => {
  assert.equal(totalDashboardFactPerDay([3_800_000, 1_200_000]), 5_000_000);
});
