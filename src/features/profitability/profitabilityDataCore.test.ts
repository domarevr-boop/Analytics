import assert from 'node:assert/strict';
import test from 'node:test';
import { assertProfitabilityFilters, parseProfitabilityRows, parseProfitabilitySummary } from './profitabilityDataCore.ts';

test('keeps net metrics nullable until monthly expenses are configured', () => {
  const parsed = parseProfitabilitySummary([{ quantity: 2, revenue: 1000, direct_costs: 600, gross_profit: 400, gross_margin: 40, expense_amount: null, net_profit: null, profitability: null, product_count: 1, expenses_configured: false }]);
  assert.equal(parsed.grossProfit, 400); assert.equal(parsed.netProfit, null); assert.equal(parsed.profitability, null); assert.equal(parsed.expensesConfigured, false);
});

test('validates bounded filters and parses consistent row totals', () => {
  assert.throws(() => assertProfitabilityFilters({ start: '2024-01-01', end: '2026-09-20' }));
  const rows = parseProfitabilityRows([{ product_id: 'p1', cabinet_id: 'c1', cabinet_name: 'Cabinet', group_id: null, group_name: null, seller_sku: '3001', wb_sku: null, product_name: 'Product', quantity: 1, revenue: 100, direct_costs: 60, gross_profit: 40, gross_margin: 40, expense_pct: 10, expense_amount: 10, net_profit: 30, profitability: 30, expenses_configured: true, total_count: 1 }]);
  assert.equal(rows[0].netProfit, 30); assert.equal(rows[0].totalCount, 1);
});
