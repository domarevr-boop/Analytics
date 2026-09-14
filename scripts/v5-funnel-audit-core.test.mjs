import test from 'node:test';
import assert from 'node:assert/strict';
import { auditV4Funnel } from './v5-funnel-audit-core.mjs';

test('audits funnel and advertising facts without returning source rows', () => {
  const result = auditV4Funnel([
    { date: '2026-06-01', product_id: 'p1', impressions: 100, clicks: 20, carts: 5, orders: 2, ordered_amount: 1000, ad_impressions: 50, ad_clicks: 10, ad_orders: 800, ad_spend: 100 },
    { date: '2026-06-02', product_id: 'p1', impressions: 90, clicks: 100, carts: 4, orders: 5, ordered_amount: 2000, ad_impressions: 0, ad_clicks: 0, ad_orders: 0, ad_spend: 0 },
    { date: '2026-06-02', product_id: 'missing', impressions: 0, clicks: 0, carts: 0, orders: 0, ordered_amount: 0, ad_impressions: 1, ad_clicks: 0, ad_orders: 0, ad_spend: 2 },
  ], [{ id: 'p1' }], [
    { source: 'wb_funnel', status: 'success', rowCount: 2 },
    { source: 'xway', status: 'error', rowCount: 0 },
  ]);

  assert.equal(result.metricRows, 3);
  assert.equal(result.missingProductReferences, 1);
  assert.equal(result.funnel.rows, 2);
  assert.equal(result.funnel.totals.orders, 7);
  assert.equal(result.funnel.stageViolations.clicksAboveImpressions, 1);
  assert.equal(result.funnel.stageViolations.ordersAboveCarts, 1);
  assert.equal(result.advertising.rows, 2);
  assert.equal(result.advertising.adOrdersAboveFunnelOrders, 1);
  assert.deepEqual(result.importLogs.wb_funnel, { total: 1, successful: 1, failed: 0, reportedRows: 2 });
  assert.equal('metrics' in result, false);
});
