const FINANCE_FIELDS = ['actual_profit', 'actual_margin', 'profit_revenue', 'cost', 'agent_fee', 'logistics_cost', 'marketing_cost', 'storage_cost'];

const number = value => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};
const finiteOrBlank = value => value === undefined || value === null || value === '' || Number.isFinite(Number(value));
const active = row => FINANCE_FIELDS.some(field => number(row[field]) !== 0);
const isoDate = value => /^\d{4}-\d{2}-\d{2}$/u.test(String(value || ''));

function period(rows, startField, endField = startField) {
  const starts = rows.map(row => String(row[startField] || '')).filter(isoDate).sort();
  const ends = rows.map(row => String(row[endField] || '')).filter(isoDate).sort();
  return { start: starts[0] || null, end: ends.at(-1) || starts.at(-1) || null };
}

function financialTotals(rows) {
  const revenue = rows.reduce((sum, row) => sum + number(row.profit_revenue), 0);
  const actualProfit = rows.reduce((sum, row) => sum + number(row.actual_profit), 0);
  return {
    revenue,
    actualProfit,
    weightedMargin: revenue ? actualProfit / revenue * 100 : 0,
  };
}

export function auditV4Profitability(profitability, metrics, products, importLogs = []) {
  const productIds = new Set(products.map(row => String(row.id || '')).filter(Boolean));
  const financeMetrics = metrics.filter(active);
  const recordKeys = new Set(); let duplicateRecordKeys = 0;
  for (const row of profitability) {
    const key = `${row.period_start || ''}|${row.period_end || ''}|${row.product_id || ''}`;
    if (recordKeys.has(key)) duplicateRecordKeys += 1;
    recordKeys.add(key);
  }
  const metricKeys = new Set(); let duplicateMetricKeys = 0;
  for (const row of financeMetrics) {
    const key = `${row.date || ''}|${row.product_id || ''}`;
    if (metricKeys.has(key)) duplicateMetricKeys += 1;
    metricKeys.add(key);
  }
  const reportByStartKey = new Map(profitability.map(row => [`${row.period_start || ''}|${row.product_id || ''}`, row]));
  const reportStartKeys = new Set(reportByStartKey.keys());
  const financeMetricByKey = new Map(financeMetrics.map(row => [`${row.date || ''}|${row.product_id || ''}`, row]));
  const sharedKeys = [...reportStartKeys].filter(key => financeMetricByKey.has(key));
  const logs = importLogs.filter(row => row.source === 'profitability');
  return {
    profitability: {
      rows: profitability.length,
      products: new Set(profitability.map(row => row.product_id).filter(Boolean)).size,
      period: period(profitability, 'period_start', 'period_end'),
      duplicateKeys: duplicateRecordKeys,
      invalidPeriods: profitability.filter(row => !isoDate(row.period_start) || !isoDate(row.period_end) || String(row.period_end) < String(row.period_start)).length,
      missingProductReferences: profitability.filter(row => !productIds.has(String(row.product_id || ''))).length,
      invalidNumericValues: profitability.reduce((count, row) => count + ['actual_profit', 'actual_margin', 'profit_revenue'].filter(field => !finiteOrBlank(row[field])).length, 0),
      multiDayPeriods: profitability.filter(row => String(row.period_start || '') !== String(row.period_end || '')).length,
      zeroMarginWithProfitAndRevenue: profitability.filter(row => number(row.actual_margin) === 0 && number(row.actual_profit) !== 0 && number(row.profit_revenue) !== 0).length,
      rowsWithoutFinanceMetricAtStart: profitability.filter(row => !financeMetricByKey.has(`${row.period_start || ''}|${row.product_id || ''}`)).length,
      totals: financialTotals(profitability),
    },
    financeMetrics: {
      rows: financeMetrics.length,
      products: new Set(financeMetrics.map(row => row.product_id).filter(Boolean)).size,
      period: period(financeMetrics, 'date'),
      duplicateKeys: duplicateMetricKeys,
      missingProductReferences: financeMetrics.filter(row => !productIds.has(String(row.product_id || ''))).length,
      invalidNumericValues: financeMetrics.reduce((count, row) => count + FINANCE_FIELDS.filter(field => !finiteOrBlank(row[field])).length, 0),
      rowsAlsoRepresentedByProfitabilityStart: financeMetrics.filter(row => reportStartKeys.has(`${row.date || ''}|${row.product_id || ''}`)).length,
      rowsWithoutProfitabilityAtStart: financeMetrics.filter(row => !reportStartKeys.has(`${row.date || ''}|${row.product_id || ''}`)).length,
      totals: financialTotals(financeMetrics),
      expenseTotals: Object.fromEntries(['cost', 'agent_fee', 'logistics_cost', 'marketing_cost', 'storage_cost']
        .map(field => [field, financeMetrics.reduce((sum, row) => sum + number(row[field]), 0)])),
    },
    sharedLayerDifferences: {
      rows: sharedKeys.length,
      revenueMismatchRows: sharedKeys.filter(key => Math.abs(number(reportByStartKey.get(key)?.profit_revenue) - number(financeMetricByKey.get(key)?.profit_revenue)) > 0.005).length,
      profitMismatchRows: sharedKeys.filter(key => Math.abs(number(reportByStartKey.get(key)?.actual_profit) - number(financeMetricByKey.get(key)?.actual_profit)) > 0.005).length,
      revenueDelta: sharedKeys.reduce((sum, key) => sum + number(financeMetricByKey.get(key)?.profit_revenue) - number(reportByStartKey.get(key)?.profit_revenue), 0),
      profitDelta: sharedKeys.reduce((sum, key) => sum + number(financeMetricByKey.get(key)?.actual_profit) - number(reportByStartKey.get(key)?.actual_profit), 0),
    },
    importLogs: {
      total: logs.length,
      successful: logs.filter(row => row.status === 'success').length,
      failed: logs.filter(row => row.status !== 'success').length,
      reportedRows: logs.reduce((sum, row) => sum + number(row.rowCount), 0),
    },
    fixedExpenseBackupCoverage: 'not_in_v4_data_snapshot',
  };
}
