import test from 'node:test';
import assert from 'node:assert/strict';
import type { AggregateMonthlyPlanRecord } from '../types/index.ts';
import { aggregatePlanMetrics, calculateAggregatePlan, getDaysInPlanMonth } from './planningCalculations.ts';

function record(overrides: Partial<AggregateMonthlyPlanRecord> = {}): AggregateMonthlyPlanRecord {
  return {
    id: 'fixed|2026-08|category|cab-1|lighting',
    kind: 'fixed',
    month: '2026-08',
    scope: 'category',
    cabinet_id: 'cab-1',
    entity_id: 'lighting',
    entity_name: 'Освещение',
    avg_qty_per_day: 10,
    avg_check: 2_000,
    buyout_rate: 80,
    payout_rate: 65,
    profitability: 20,
    updated_at: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

test('calculates the monthly plan from daily quantity and rates', () => {
  const result = calculateAggregatePlan(record());
  assert.equal(result.daysInMonth, 31);
  assert.equal(result.ordersQty, 310);
  assert.equal(result.ordersSum, 620_000);
  assert.equal(result.buyoutAmount, 496_000);
  assert.equal(result.payoutAmount, 403_000);
  assert.equal(result.netProfit, 99_200);
  assert.equal(result.ordersPerDay, 20_000);
  assert.equal(result.netProfitPerDay, 3_200);
});

test('uses calendar month length including leap years', () => {
  assert.equal(getDaysInPlanMonth('2028-02'), 29);
  assert.equal(getDaysInPlanMonth('2027-02'), 28);
});

test('keeps missing inputs missing instead of turning them into zero', () => {
  const result = calculateAggregatePlan(record({ avg_check: null }));
  assert.equal(result.ordersQty, 310);
  assert.equal(result.ordersSum, null);
  assert.equal(result.netProfit, null);
});

test('aggregates rates and average check using monetary and quantity weights', () => {
  const first = calculateAggregatePlan(record());
  const second = calculateAggregatePlan(record({
    id: 'fixed|2026-08|category|cab-1|decor',
    entity_id: 'decor',
    avg_qty_per_day: 5,
    avg_check: 1_000,
    buyout_rate: 60,
    payout_rate: 50,
    profitability: 10,
  }));
  const total = aggregatePlanMetrics([first, second], '2026-08');
  assert.equal(total.ordersQty, 465);
  assert.equal(total.ordersSum, 775_000);
  assert.equal(total.avgCheck, 775_000 / 465);
  assert.equal(total.buyoutRate, (496_000 + 93_000) / 775_000 * 100);
  assert.equal(total.profitability, (99_200 + 9_300) / (496_000 + 93_000) * 100);
});
