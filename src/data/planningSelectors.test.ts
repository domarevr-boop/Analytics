import test from 'node:test';
import assert from 'node:assert/strict';
import type { AggregateMonthlyPlanRecord, MonthlyPlanRecord, Product } from '../types/index.ts';
import { resolveEffectivePlanMetrics, selectAggregatePlanMetrics } from './planningSelectors.ts';

const product = (id: string, sku: string, cabinet: string, category: string): Product => ({
  id, sku, wb_sku: '', name: sku, category, brand_id: 'brand-1', cabinet_id: cabinet, aliases: [], status: 'active', data_source: 'manual', updated_at: '',
});

const aggregate = (cabinet: string, category: string, qty: number): AggregateMonthlyPlanRecord => ({
  id: `fixed|2026-08|category|${cabinet}|${category}`,
  kind: 'fixed', month: '2026-08', scope: 'category', cabinet_id: cabinet,
  entity_id: category, entity_name: category, orders_sum: null, avg_qty_per_day: qty, avg_check: 1_000,
  buyout_rate: 80, payout_rate: 60, profitability: 20, updated_at: '',
});

const legacy = (sku: string, qty: number): MonthlyPlanRecord => ({
  sku, month: '2026-08', avgQtyPerDay: qty, costPrice: 0, checkAmount: 500,
  netProfitPerUnit: 80, totalNetProfit: 0, profitability: 20, totalQty: 0,
  totalRubles: 0, buyoutRate: 80,
});

test('rolls category inputs into cabinet and total values', () => {
  const records = [aggregate('cab-1', 'A', 10), aggregate('cab-1', 'B', 5), aggregate('cab-2', 'A', 2)];
  assert.equal(selectAggregatePlanMetrics(records, '2026-08').avgQtyPerDay, 17);
  assert.equal(selectAggregatePlanMetrics(records, '2026-08', { cabinetId: 'cab-1' }).avgQtyPerDay, 15);
  assert.equal(selectAggregatePlanMetrics(records, '2026-08', { cabinetId: 'cab-1', category: 'A' }).avgQtyPerDay, 10);
});

test('global preference selects one source for every month without fallback', () => {
  const records = [aggregate('cab-1', 'A', 10)];
  const products = [product('p1', '100', 'cab-1', 'A')];
  assert.equal(resolveEffectivePlanMetrics(true, records, [legacy('100', 99)], products, '2026-08').avgQtyPerDay, 10);
  assert.equal(resolveEffectivePlanMetrics(true, records, [legacy('100', 99)], products, '2026-09').hasData, false);
  assert.equal(resolveEffectivePlanMetrics(false, records, [legacy('100', 99)], products, '2026-08').avgQtyPerDay, 99);
});
