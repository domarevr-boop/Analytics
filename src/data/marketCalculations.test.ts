import assert from 'node:assert/strict';
import test from 'node:test';
import { decomposeAmountShare, getComparableChange, getMarketAverageCheck } from './marketCalculations.ts';
import type { MarketDynamicsRecord } from '../types/index.ts';

const base: MarketDynamicsRecord = {
  date: '2026-06-01', market_ordered_amount: 49_526_859, own_ordered_amount: 3_904_149,
  amount_share: 7.88, market_orders: 15_248, own_orders: 2_101, orders_share: 13.8,
  own_avg_check: 1_858, market_avg_check: 3_248,
};

test('uses the explicit market average check when it is present', () => {
  assert.equal(getMarketAverageCheck(base), 3_248);
});

test('recomputes the market check only from the same market report', () => {
  const record = { ...base, market_avg_check: 0 };
  assert.equal(getMarketAverageCheck(record), record.market_ordered_amount / record.market_orders);
});

test('does not invent a comparison without a previous base', () => {
  assert.equal(getComparableChange(100, 0), null);
  assert.equal(getComparableChange(110, 100), 10);
});

test('decomposes the amount-share change into market and own-order effects', () => {
  const result = decomposeAmountShare(1200, 144, 1000, 100);
  assert.equal(result.previousShare, 10);
  assert.equal(result.currentShare, 12);
  assert.ok(Math.abs(result.marketEffect + result.ownEffect - 2) < 1e-10);
});
