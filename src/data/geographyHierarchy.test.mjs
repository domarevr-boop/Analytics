import assert from 'node:assert/strict';
import test from 'node:test';
import { selectDetailedGeographyRows, UNKNOWN_GEO_AREA, UNKNOWN_GEO_CITY } from './geographyHierarchy.ts';

function record(overrides = {}) {
  return {
    date: '2026-07-24',
    product_id: 'product-1',
    region: 'Центральный',
    area: UNKNOWN_GEO_AREA,
    city: UNKNOWN_GEO_CITY,
    delivery_hours: null,
    orders_total: 10,
    product_local_orders: 5,
    product_nonlocal_orders: 5,
    wb_local_orders: 5,
    wb_nonlocal_orders: 5,
    marketplace_local_orders: 0,
    marketplace_nonlocal_orders: 0,
    ...overrides,
  };
}

test('normalizes and deduplicates legacy empty locations', () => {
  const rows = selectDetailedGeographyRows([
    record({ area: '', city: '', orders_total: 8 }),
    record({ orders_total: 10 }),
  ]);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].area, UNKNOWN_GEO_AREA);
  assert.equal(rows[0].city, UNKNOWN_GEO_CITY);
  assert.equal(rows[0].orders_total, 10);
});

test('drops coarse area rows when detailed areas exist', () => {
  const rows = selectDetailedGeographyRows([
    record({ orders_total: 20 }),
    record({ area: 'Московская область', city: 'Сергиев Посад', orders_total: 12 }),
    record({ area: 'Тульская область', city: 'Тула', orders_total: 8 }),
  ]);

  assert.deepEqual(rows.map(row => row.area).sort(), ['Московская область', 'Тульская область']);
});

test('drops unknown city rows when detailed cities exist in the area', () => {
  const rows = selectDetailedGeographyRows([
    record({ area: 'Московская область', orders_total: 20 }),
    record({ area: 'Московская область', city: 'Сергиев Посад', orders_total: 20 }),
  ]);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].city, 'Сергиев Посад');
});

test('preserves coarse rows when no finer detail exists', () => {
  const rows = selectDetailedGeographyRows([record()]);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].area, UNKNOWN_GEO_AREA);
});
