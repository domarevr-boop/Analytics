import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertGeographyFilters,
  parseGeographyFilterOptions,
  parseGeographyLocations,
  parseGeographyProductLeaders,
  parseGeographySeries,
  parseGeographySummary,
} from './geographyDataCore.ts';

test('validates bounded geography filters', () => {
  assert.deepEqual(assertGeographyFilters({ start: '2026-07-01', end: '2026-07-31' }), { start: '2026-07-01', end: '2026-07-31' });
  assert.throws(() => assertGeographyFilters({ start: '2024-01-01', end: '2026-07-31' }), /731/);
  assert.throws(() => assertGeographyFilters({ start: '2026-08-01', end: '2026-07-31' }), /период/);
});

test('parses filter options and rejects duplicate values', () => {
  const parsed = parseGeographyFilterOptions({ min_date: '2026-07-01', max_date: '2026-07-31', cabinet_count: 2, product_count: 10, regions: ['ЦФО'], areas: [], cities: [] });
  assert.equal(parsed.productCount, 10);
  assert.throws(() => parseGeographyFilterOptions({ min_date: null, max_date: null, cabinet_count: 0, product_count: 0, regions: ['ЦФО', 'ЦФО'], areas: [], cities: [] }), /повторы/);
});

test('parses complete All/FBO/FBS summary and preserves nullable delivery', () => {
  const parsed = parseGeographySummary([
    { fulfillment: 'all', orders: '10', delivery_hours: '24.5', covered_orders: 8, row_count: 2 },
    { fulfillment: 'fbo', orders: 7, delivery_hours: null, covered_orders: 0, row_count: 2 },
    { fulfillment: 'fbs', orders: 3, delivery_hours: 12, covered_orders: 3, row_count: 2 },
  ]);
  assert.equal(parsed[0].deliveryHours, 24.5);
  assert.equal(parsed[1].deliveryHours, null);
  assert.throws(() => parseGeographySummary([{ fulfillment: 'all', orders: 1, delivery_hours: null, covered_orders: 0, row_count: 1 }]), /All\/FBO\/FBS/);
});

test('enforces ordered daily fulfillment balance', () => {
  const parsed = parseGeographySeries([{ period_date: '2026-07-18', all_orders: 10, fbo_orders: 8, fbs_orders: 2, all_delivery_hours: null, fbo_delivery_hours: null, fbs_delivery_hours: null }]);
  assert.equal(parsed[0].allOrders, 10);
  assert.throws(() => parseGeographySeries([{ period_date: '2026-07-18', all_orders: 10, fbo_orders: 8, fbs_orders: 1, all_delivery_hours: null, fbo_delivery_hours: null, fbs_delivery_hours: null }]), /баланс/);
});

test('parses paginated locations and product leaders', () => {
  const locations = parseGeographyLocations([{ total_count: 1, region: 'ЦФО', area: '', city: '', orders: 10, delivery_hours: 20, covered_orders: 8, product_count: 2 }]);
  assert.equal(locations.totalCount, 1);
  const products = parseGeographyProductLeaders([{ product_id: 'p1', cabinet_id: 'c1', seller_sku: null, wb_sku: '1', product_name: 'Товар', orders: 10, delivery_hours: null, covered_orders: 0 }]);
  assert.equal(products[0].wbSku, '1');
  assert.throws(() => parseGeographyLocations([{ total_count: 0, region: 'ЦФО', area: '', city: '', orders: 1, delivery_hours: null, covered_orders: 0, product_count: 1 }]), /длиннее/);
});
