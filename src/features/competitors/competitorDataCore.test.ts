import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertV5CompetitorPage,
  assertV5CompetitorRange,
  assertV5CompetitorTop,
  parseV5CompetitorArticles,
  parseV5CompetitorFilters,
  parseV5CompetitorOverview,
  parseV5CompetitorStock,
  parseV5CompetitorTopSummary,
} from './competitorDataCore.ts';

test('validates competitor ranges and server page limits', () => {
  assert.deepEqual(assertV5CompetitorRange({ start: '2026-08-11', end: '2026-08-12', brand: '  Brand  ', search: ' ' }), {
    start: '2026-08-11', end: '2026-08-12', brand: 'Brand', search: null,
  });
  assert.doesNotThrow(() => assertV5CompetitorPage(100, 10_000, 10_000));
  assert.doesNotThrow(() => assertV5CompetitorTop(20, 'retained'));
  assert.throws(() => assertV5CompetitorRange({ start: '2026-08-12', end: '2026-08-11' }), /серверный лимит/);
  assert.throws(() => assertV5CompetitorPage(101, 0, 10_000), /от 1 до 100/);
  assert.throws(() => assertV5CompetitorTop(30), /10, 20 или 50/);
});

test('parses the competitor filter contract and rejects inconsistent coverage', () => {
  const filters = parseV5CompetitorFilters({
    batch_id: '8ea2c476-f868-4af8-9e8e-3ba98b9759af',
    funnel: { min_date: '2026-08-11', max_date: '2026-08-11', day_count: 1, row_count: 50 },
    positions: { min_date: '2026-08-11', max_date: '2026-08-12', day_count: 2 },
    stocks: { min_date: '2026-08-11', max_date: '2026-08-11', day_count: 1 },
    brands: ['Brand'], stock_brands: ['Brand'], warehouses: [{ key: 'москва', name: 'Москва' }],
  });
  assert.equal(filters.funnel.rowCount, 50);
  assert.equal(filters.positions.dayCount, 2);
  assert.throws(() => parseV5CompetitorFilters({ ...filters, batch_id: null }), /сервер вернул неожиданный ответ|некорректное поле/);
});

test('parses ordered overview rows and rejects duplicate dates', () => {
  const row = {
    period_date: '2026-08-11', ordered_amount: '1000', orders: '2', weighted_price: '500', impressions: '100', order_conversion: '2', buyout_rate: '80',
    own_ordered_amount: '400', own_orders: '1', own_weighted_price: '400', own_impressions: '40', own_order_conversion: '2.5', own_buyout_rate: '90', leader_share: '60', own_share: '40',
  };
  assert.equal(parseV5CompetitorOverview([row])[0].ownShare, 40);
  assert.throws(() => parseV5CompetitorOverview([row, row]), /не возрастают/);
});

test('maps article pages without losing nullable TOP positions', () => {
  const page = parseV5CompetitorArticles([{
    total_count: '1', wb_article: '123', brand: '', seller: '', is_own: false, ordered_amount: '0', orders: '0', impressions: '0', order_conversion: '0', buyout_rate: '0', weighted_price: '0',
    stock: '0', avg_daily_orders: '0', stock_coverage: '0', warehouse_count: '0', product_name: '', subject: '', top_query: '', query_requests: '0', latest_position: null, position_delta: '0',
  }]);
  assert.equal(page.totalCount, 1);
  assert.equal(page.rows[0].latestPosition, null);
});

test('keeps stock deltas and nullable rates distinct', () => {
  const stock = parseV5CompetitorStock({
    date_start: '2026-08-11', date_end: '2026-08-12', total_previous: '10', total_current: '0', total_delta: '-10',
    warehouses: [{ key: 'москва', warehouse: 'Москва', stock: '0', share: null }],
    brands: [{ key: 'brand', brand: 'Brand', previous: '10', current: '0', delta: '-10', delta_rate: '-100' }],
  });
  assert.equal(stock.totalDelta, -10);
  assert.equal(stock.warehouses[0].share, null);
});

test('requires TOP timeline and brand matrices to match the date axis', () => {
  const value = {
    dates: ['2026-08-11', '2026-08-12'],
    timeline: [
      { date: '2026-08-11', size: 10, retained: 0, entrants: 0, exits: 0, retention_rate: null },
      { date: '2026-08-12', size: 10, retained: 8, entrants: 2, exits: 2, retention_rate: 80 },
    ],
    brand_structure: [{ key: 'brand', brand: 'Brand', counts: [5, 6], latest: 6, delta: 1 }],
    stability_rate: 80, entrants: 2, exits: 2, average_movement: 1.5, brands_latest: 3,
  };
  assert.equal(parseV5CompetitorTopSummary(value).brandStructure[0].counts.length, 2);
  assert.throws(() => parseV5CompetitorTopSummary({ ...value, brand_structure: [{ ...value.brand_structure[0], counts: [5] }] }), /не согласована/);
});
