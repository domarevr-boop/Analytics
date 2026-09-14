const FUNNEL_FIELDS = ['impressions', 'clicks', 'carts', 'orders', 'ordered_amount'];
const AD_FIELDS = ['ad_impressions', 'ad_clicks', 'ad_orders', 'ad_spend'];

const number = value => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const active = (row, fields) => fields.some(field => number(row[field]) !== 0);

function range(rows) {
  const dates = rows.map(row => String(row.date || '')).filter(value => /^\d{4}-\d{2}-\d{2}$/u.test(value)).sort();
  return { start: dates[0] || null, end: dates.at(-1) || null };
}

function totals(rows, fields) {
  return Object.fromEntries(fields.map(field => [field, rows.reduce((sum, row) => sum + number(row[field]), 0)]));
}

export function auditV4Funnel(metrics, products, importLogs = []) {
  const productIds = new Set(products.map(row => String(row.id || '')).filter(Boolean));
  const funnelRows = metrics.filter(row => active(row, FUNNEL_FIELDS));
  const adRows = metrics.filter(row => active(row, AD_FIELDS));
  const keys = new Set();
  let duplicateMetricKeys = 0;
  for (const row of metrics) {
    const key = `${row.date || ''}|${row.product_id || ''}`;
    if (keys.has(key)) duplicateMetricKeys += 1;
    keys.add(key);
  }
  const relevantLogs = importLogs.filter(row => row.source === 'wb_funnel' || row.source === 'xway');
  const logsBySource = Object.fromEntries(['wb_funnel', 'xway'].map(source => {
    const rows = relevantLogs.filter(row => row.source === source);
    return [source, {
      total: rows.length,
      successful: rows.filter(row => row.status === 'success').length,
      failed: rows.filter(row => row.status !== 'success').length,
      reportedRows: rows.reduce((sum, row) => sum + number(row.rowCount), 0),
    }];
  }));

  return {
    metricRows: metrics.length,
    duplicateMetricKeys,
    missingProductReferences: metrics.filter(row => !productIds.has(String(row.product_id || ''))).length,
    funnel: {
      rows: funnelRows.length,
      products: new Set(funnelRows.map(row => row.product_id)).size,
      period: range(funnelRows),
      totals: totals(funnelRows, FUNNEL_FIELDS),
      stageViolations: {
        clicksAboveImpressions: funnelRows.filter(row => number(row.clicks) > number(row.impressions)).length,
        cartsAboveClicks: funnelRows.filter(row => number(row.carts) > number(row.clicks)).length,
        ordersAboveCarts: funnelRows.filter(row => number(row.orders) > number(row.carts)).length,
      },
    },
    advertising: {
      rows: adRows.length,
      products: new Set(adRows.map(row => row.product_id)).size,
      period: range(adRows),
      totals: totals(adRows, AD_FIELDS),
      adOrdersNonInteger: adRows.filter(row => !Number.isInteger(number(row.ad_orders))).length,
      adOrdersAboveFunnelOrders: adRows.filter(row => number(row.ad_orders) > number(row.orders) && number(row.ad_orders) > 0).length,
    },
    importLogs: logsBySource,
  };
}
