import test from 'node:test';
import assert from 'node:assert/strict';
import { auditV4Geography } from './v5-geography-audit-core.mjs';

const row = (overrides = {}) => ({
  date: '2026-08-01', product_id: 'p1', region: 'Центральный', area: 'Москва', city: 'Москва', delivery_hours: 24,
  orders_total: 10, product_local_orders: 6, product_nonlocal_orders: 4,
  wb_local_orders: 3, wb_nonlocal_orders: 2, marketplace_local_orders: 3, marketplace_nonlocal_orders: 2,
  ...overrides,
});

test('audits geography keys, coverage and fulfillment without returning rows', () => {
  const audit = auditV4Geography([
    row(),
    row({ area: '', city: '', delivery_hours: null }),
    row({ date: '2026-08-02', product_id: 'p2', orders_total: 8, product_local_orders: 8, product_nonlocal_orders: 0, wb_local_orders: 2, wb_nonlocal_orders: 1, marketplace_local_orders: 2, marketplace_nonlocal_orders: 1 }),
  ], [{ id: 'p1' }]);
  assert.equal(audit.counts.rows, 3);
  assert.equal(audit.keys.unknownProduct, 1);
  assert.equal(audit.fulfillment.rowsBelowTotal, 1);
  assert.equal(audit.delivery.rowsWithoutDelivery, 1);
  assert.equal(audit.hierarchy.suppressedAggregateAreaRows, 1);
  assert.equal('rows' in audit && Array.isArray(audit.rows), false);
});

test('detects duplicate normalized keys and impossible numeric values', () => {
  const audit = auditV4Geography([
    row({ area: ' Москва ', city: ' Москва ' }),
    row({ orders_total: 5, product_local_orders: 1, product_nonlocal_orders: 1, wb_local_orders: 3.5, marketplace_local_orders: 4, delivery_hours: -1 }),
  ], [{ id: 'p1' }]);
  assert.equal(audit.keys.rawDuplicateKeys, 0);
  assert.equal(audit.keys.normalizedDuplicateKeys, 1);
  assert.equal(audit.keys.conflictingNormalizedDuplicates, 1);
  assert.equal(audit.numeric.fractionalOrders, 1);
  assert.equal(audit.numeric.invalidDeliveryHours, 1);
  assert.equal(audit.fulfillment.rowsAboveTotal, 1);
  assert.equal(audit.fulfillment.productSplitMismatch, 1);
  assert.equal(audit.canonical.fulfillment.orders, 5);
});
