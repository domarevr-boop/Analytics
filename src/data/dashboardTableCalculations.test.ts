import test from 'node:test';
import assert from 'node:assert/strict';
import type { MetricValues, TableRow } from '../types/index.ts';
import { sortDashboardSiblingsByOrders } from './dashboardTableCalculations.ts';

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
