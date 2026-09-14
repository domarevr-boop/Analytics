import test from 'node:test';
import assert from 'node:assert/strict';
import { auditV4Profitability } from './v5-profitability-audit-core.mjs';

test('audits report and metric finance layers without exposing source rows', () => {
  const result = auditV4Profitability([
    { period_start: '2026-08-01', period_end: '2026-08-31', product_id: 'p1', profit_revenue: 1000, actual_profit: 200, actual_margin: 0 },
    { period_start: 'bad', period_end: '2026-08-01', product_id: 'missing', profit_revenue: 'oops', actual_profit: 0, actual_margin: 0 },
  ], [
    { date: '2026-08-01', product_id: 'p1', profit_revenue: 1000, actual_profit: 200, cost: 500, agent_fee: 100, logistics_cost: 100, marketing_cost: 50, storage_cost: 50 },
  ], [{ id: 'p1' }], [{ source: 'profitability', status: 'success', rowCount: 2 }]);

  assert.equal(result.profitability.rows, 2);
  assert.equal(result.profitability.invalidPeriods, 1);
  assert.equal(result.profitability.missingProductReferences, 1);
  assert.equal(result.profitability.zeroMarginWithProfitAndRevenue, 1);
  assert.equal(result.profitability.rowsWithoutFinanceMetricAtStart, 1);
  assert.equal(result.financeMetrics.rowsAlsoRepresentedByProfitabilityStart, 1);
  assert.equal(result.financeMetrics.rowsWithoutProfitabilityAtStart, 0);
  assert.equal(result.financeMetrics.expenseTotals.cost, 500);
  assert.equal(result.sharedLayerDifferences.revenueMismatchRows, 0);
  assert.equal(result.sharedLayerDifferences.profitMismatchRows, 0);
  assert.deepEqual(result.importLogs, { total: 1, successful: 1, failed: 0, reportedRows: 2 });
  assert.equal('rows' in result, false);
});
