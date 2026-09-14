import test from 'node:test';
import assert from 'node:assert/strict';
import { assertFunnelFilters, calculateFunnelRates, parseFunnelFilterOptions, parseFunnelRows, parseFunnelSeries, parseFunnelSummary } from './funnelDataCore.ts';

const metrics = { impressions: '1000', clicks: 100, carts: 20, orders: 10, ordered_amount: '5000.50', ad_impressions: 400, ad_clicks: 40, ad_orders_qty: 5, ad_ordered_amount: 1000, ad_spend: 250 };

test('parses aggregate metrics and derives corrected ratios from totals', () => {
  const summary = parseFunnelSummary([{ ...metrics, product_count: 2 }]);
  assert.equal(summary.orderedAmount, 5000.5);
  assert.deepEqual(calculateFunnelRates(summary), { ctr: 10, cartCr: 20, orderCr: 50, impressionOrderCr: 1, avgPrice: 500.05, adCtr: 10, cpo: 50, drr: 25 });
});

test('validates bounded filters, options, ordered series and paginated rows', () => {
  assert.equal(assertFunnelFilters({ start: '2026-08-01', end: '2026-08-31', search: 'SKU' }).search, 'SKU');
  assert.equal(parseFunnelFilterOptions({ cabinets: [{ id: 'c1', name: 'Кабинет' }], categories: [], brands: [], groups: [] }).cabinets.length, 1);
  assert.equal(parseFunnelSeries([{ period_date: '2026-08-01', ...metrics }])[0].adOrdersQty, 5);
  const rows = parseFunnelRows([{ product_id: 'p1', cabinet_id: 'c1', cabinet_name: 'Кабинет', group_id: null, group_name: null, seller_sku: 'A', wb_sku: null, product_name: 'Товар', total_count: 1, ...metrics }]);
  assert.equal(rows[0].totalCount, 1);
  assert.throws(() => assertFunnelFilters({ start: '2024-01-01', end: '2026-08-31' }), /731/u);
  assert.throws(() => parseFunnelSeries([{ period_date: '2026-08-01', ...metrics }, { period_date: '2026-08-01', ...metrics }]), /повторяются/u);
});
