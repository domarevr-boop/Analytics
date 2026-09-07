import test from 'node:test';
import assert from 'node:assert/strict';
import { assertV5MarketRange, mapV5MarketSeries, parseV5MarketBounds } from './marketDataCore.ts';

test('parses bounded market metadata returned by Supabase RPC', () => {
  assert.deepEqual(parseV5MarketBounds([{ min_date: '2026-06-01', max_date: '2026-09-03', day_count: 95 }]), {
    minDate: '2026-06-01',
    maxDate: '2026-09-03',
    dayCount: 95,
  });
  assert.deepEqual(parseV5MarketBounds([{ min_date: null, max_date: null, day_count: 0 }]), {
    minDate: null,
    maxDate: null,
    dayCount: 0,
  });
});

test('maps numeric strings and nullable derived metrics without changing formulas', () => {
  const [row] = mapV5MarketSeries([{
    period_date: '2026-06-01',
    market_ordered_amount: '49526859.15',
    own_ordered_amount: '3904149',
    amount_share: '7.882892367',
    market_orders: '15248',
    own_orders: 2101,
    orders_share: '13.77885624',
    own_avg_check: null,
    market_avg_check: '3248.021454',
  }]);

  assert.equal(row.market_ordered_amount, 49526859.15);
  assert.equal(row.market_orders, 15248);
  assert.equal(row.own_orders, 2101);
  assert.equal(row.own_avg_check, 0);
  assert.equal(row.amount_share, 7.882892367);
});

test('rejects inconsistent bounds, malformed rows and ranges over five years', () => {
  assert.throws(() => parseV5MarketBounds([{ min_date: '2026-06-01', max_date: null, day_count: 1 }]), /не согласованы/);
  assert.throws(() => mapV5MarketSeries([{ period_date: '01.06.2026' }]), /period_date/);
  assert.throws(() => assertV5MarketRange({ minDate: '2020-01-01', maxDate: '2026-01-01', dayCount: 1 }), /пять лет/);
});
