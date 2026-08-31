/// <reference types="node" />
import assert from 'node:assert/strict';
import test from 'node:test';
import type { GeographyOrderRecord } from '../../types';
import {
  aggregateGeography,
  getFulfillmentCoverage,
  getFulfillmentOrders,
  getFulfillmentStock,
} from './geographyCalculations.ts';

const record = (overrides: Partial<GeographyOrderRecord> = {}): GeographyOrderRecord => ({
  date: '2026-08-01', product_id: 'p1', region: 'Приволжский', area: 'Самарская область', city: 'Самара',
  delivery_hours: 24, orders_total: 10, product_local_orders: 0, product_nonlocal_orders: 10,
  wb_local_orders: 1, wb_nonlocal_orders: 1, marketplace_local_orders: 2, marketplace_nonlocal_orders: 4,
  stock_wb: 100, stock_marketplace: 50, ...overrides,
});

test('maps geography orders and stock to all, FBO and FBS modes', () => {
  const row = record();
  assert.equal(getFulfillmentOrders(row, 'all'), 10);
  assert.equal(getFulfillmentOrders(row, 'fbo'), 2);
  assert.equal(getFulfillmentOrders(row, 'fbs'), 6);
  assert.equal(getFulfillmentStock(row, 'all'), 150);
  assert.equal(getFulfillmentStock(row, 'fbo'), 100);
  assert.equal(getFulfillmentStock(row, 'fbs'), 50);
});

test('aggregates delivery using only the selected fulfillment orders', () => {
  const rows = [record(), record({ delivery_hours: 48, orders_total: 20, wb_local_orders: 0, wb_nonlocal_orders: 4, marketplace_local_orders: 3, marketplace_nonlocal_orders: 3 })];
  const fbo = aggregateGeography(rows, 'fbo');
  const fbs = aggregateGeography(rows, 'fbs');
  assert.equal(fbo.total, 6);
  assert.equal(fbo.coveredOrders, 6);
  assert.equal(fbo.deliveryHours, 40);
  assert.equal(fbs.total, 12);
  assert.equal(fbs.deliveryHours, 36);
});

test('reports incomplete fulfillment coverage without falling back to total orders', () => {
  const coverage = getFulfillmentCoverage([record({ orders_total: 10, wb_local_orders: 0, wb_nonlocal_orders: 2, marketplace_local_orders: 0, marketplace_nonlocal_orders: 3 })]);
  assert.deepEqual(coverage, { total: 10, fbo: 2, fbs: 3, distributed: 5, residual: 5, coverage: 50 });
  assert.equal(getFulfillmentOrders(record({ orders_total: 10, wb_local_orders: 0, wb_nonlocal_orders: 0, marketplace_local_orders: 0, marketplace_nonlocal_orders: 0 }), 'fbo'), 0);
});
