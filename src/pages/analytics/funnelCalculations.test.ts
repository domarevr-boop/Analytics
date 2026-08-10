import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregateFunnel } from './funnelCalculations.ts';

test('funnel aggregation uses adjacent stage denominators', () => {
  const result = aggregateFunnel([
    { impressions: 1000, clicks: 100, carts: 40, orders: 10, ordered_amount: 25_000 },
    { impressions: 1000, clicks: 300, carts: 60, orders: 20, ordered_amount: 45_000 },
  ]);

  assert.equal(result.ctr, 20);
  assert.equal(result.cartCr, 25);
  assert.equal(result.cartOrderCr, 30);
  assert.equal(result.impressionOrderCr, 1.5);
  assert.equal(result.avgPrice, 70_000 / 30);
});

test('funnel rates stay at zero when their denominator is zero', () => {
  const result = aggregateFunnel([{ impressions: 0, clicks: 0, carts: 0, orders: 0, ordered_amount: 0 }]);

  assert.equal(result.ctr, 0);
  assert.equal(result.cartCr, 0);
  assert.equal(result.cartOrderCr, 0);
  assert.equal(result.clickOrderCr, 0);
  assert.equal(result.impressionOrderCr, 0);
  assert.equal(result.avgPrice, 0);
});
