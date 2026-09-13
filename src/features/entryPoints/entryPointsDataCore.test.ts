import test from 'node:test';
import assert from 'node:assert/strict';
import { assertEntryPointsFilters, assertEntryPointsMetric, parseEntryPointsFilterOptions, parseEntryPointsMatrix, parseEntryPointsProductLeaders, parseEntryPointsSeries, parseEntryPointsSummary } from './entryPointsDataCore.ts';

test('validates bounded entry points requests', () => {
  assert.deepEqual(assertEntryPointsFilters({ start: '2026-08-01', end: '2026-08-31' }), { start: '2026-08-01', end: '2026-08-31' });
  assert.throws(() => assertEntryPointsFilters({ start: '2024-01-01', end: '2026-08-31' }), /731/);
  assert.equal(assertEntryPointsMetric('orders'), 'orders');
  assert.throws(() => assertEntryPointsMetric('profit'), /метрик/);
});

test('parses filters and aggregate summary without averaging conversions', () => {
  const filters = parseEntryPointsFilterOptions({ min_date: '2026-08-01', max_date: '2026-08-31', cabinet_count: 1, product_count: 4, sections: ['Поиск'], entry_points: ['Поиск WB'] });
  assert.equal(filters.sections[0], 'Поиск');
  const summary = parseEntryPointsSummary([{ impressions: '100', clicks: 20, carts: 8, orders: 4, point_count: 1, product_count: 2 }]);
  assert.equal(summary.clicks / summary.impressions * 100, 20);
});

test('parses ordered series, matrix and unique leaders', () => {
  const series = parseEntryPointsSeries([{ period_date: '2026-08-01', impressions: 10, clicks: 2, carts: 1, orders: 1 }]);
  assert.equal(series[0].orders, 1);
  const matrix = parseEntryPointsMatrix([{ section: 'Поиск', entry_point: 'Поиск WB', period_date: '2026-08-01', impressions: 10, clicks: 2, carts: 1, orders: 1 }]);
  assert.equal(matrix[0].entryPoint, 'Поиск WB');
  const leaders = parseEntryPointsProductLeaders([{ product_id: 'p1', cabinet_id: 'c1', seller_sku: 'A', wb_sku: null, product_name: 'Товар', section: 'Поиск', impressions: 10, clicks: 2, carts: 1, orders: 1 }]);
  assert.equal(leaders[0].sellerSku, 'A');
});
