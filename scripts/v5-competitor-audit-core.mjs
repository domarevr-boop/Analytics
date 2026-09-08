const SECTIONS = ['funnel', 'search', 'stocks', 'positions'];

function clean(value) {
  return value == null ? '' : String(value).trim();
}

function range(rows) {
  const dates = rows.map(row => clean(row.date)).filter(Boolean).sort();
  return { minDate: dates[0] || null, maxDate: dates.at(-1) || null, dateCount: new Set(dates).size };
}

function duplicateCount(rows, keyOf) {
  const seen = new Set();
  let duplicates = 0;
  for (const row of rows) {
    const key = keyOf(row);
    if (!key) continue;
    if (seen.has(key)) duplicates += 1;
    else seen.add(key);
  }
  return duplicates;
}

function articleSet(rows) {
  return new Set(rows.map(row => clean(row.wb_article)).filter(Boolean));
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function countFractional(rows, fields) {
  return rows.reduce((count, row) => count + fields.filter(field => {
    const value = number(row[field]);
    return value !== null && !Number.isInteger(value);
  }).length, 0);
}

function countNegative(rows, fields) {
  return rows.reduce((count, row) => count + fields.filter(field => (number(row[field]) ?? 0) < 0).length, 0);
}

function countOutsidePercent(rows, fields) {
  return rows.reduce((count, row) => count + fields.filter(field => {
    const value = number(row[field]);
    return value !== null && (value < 0 || value > 100);
  }).length, 0);
}

export function auditV4Competitors(competitors) {
  if (!competitors || typeof competitors !== 'object') throw new Error('Competitor audit: sections are required');
  for (const section of SECTIONS) if (!Array.isArray(competitors[section])) throw new Error(`Competitor audit: ${section} must be an array`);
  const { funnel, search, stocks, positions } = competitors;
  const articles = Object.fromEntries(SECTIONS.map(section => [section, articleSet(competitors[section])]));
  const allArticles = new Set(SECTIONS.flatMap(section => [...articles[section]]));
  const missingArticle = Object.fromEntries(SECTIONS.map(section => [section, competitors[section].filter(row => !clean(row.wb_article)).length]));
  const invalidDate = Object.fromEntries(SECTIONS.map(section => [section, competitors[section].filter(row => !/^20\d{2}-\d{2}-\d{2}$/u.test(clean(row.date))).length]));
  return {
    counts: Object.fromEntries(SECTIONS.map(section => [section, competitors[section].length])),
    ranges: Object.fromEntries(SECTIONS.map(section => [section, range(competitors[section])])),
    articleCounts: { ...Object.fromEntries(SECTIONS.map(section => [section, articles[section].size])), union: allArticles.size },
    duplicateKeys: {
      funnel: duplicateCount(funnel, row => `${clean(row.date)}|${clean(row.wb_article)}`),
      search: duplicateCount(search, row => `${clean(row.date)}|${clean(row.wb_article)}|${clean(row.query).toLocaleLowerCase('ru-RU')}`),
      stocks: duplicateCount(stocks, row => `${clean(row.date)}|${clean(row.wb_article)}|${clean(row.region).toLocaleLowerCase('ru-RU')}|${clean(row.warehouse).toLocaleLowerCase('ru-RU')}`),
      positions: duplicateCount(positions, row => `${clean(row.date)}|${clean(row.wb_article)}`),
    },
    missingArticle,
    invalidDate,
    crossSheetCoverage: Object.fromEntries(SECTIONS.map(section => [section, {
      missingFromFunnel: [...articles[section]].filter(article => !articles.funnel.has(article)).length,
      missingFromPositions: [...articles[section]].filter(article => !articles.positions.has(article)).length,
    }])),
    topDepth: positions.reduce((max, row) => Math.max(max, Number(row.position) || 0), 0),
    numericDiagnostics: {
      funnel: {
        fractionalCountFields: countFractional(funnel, ['position', 'impressions', 'clicks', 'carts', 'orders', 'buyouts']),
        negativeValues: countNegative(funnel, ['position', 'ordered_amount', 'discounted_price', 'buyer_median_price', 'avg_search_position', 'impressions', 'clicks', 'carts', 'orders', 'buyouts']),
        percentagesOutsideRange: countOutsidePercent(funnel, ['ctr', 'cart_conversion', 'order_conversion', 'buyout_rate']),
        numeratorAboveImpressions: funnel.filter(row => ['clicks', 'carts', 'orders'].some(field => (number(row[field]) ?? 0) > (number(row.impressions) ?? 0))).length,
      },
      search: {
        fractionalRequestFields: countFractional(search, ['requests', 'requests_previous']),
        negativeValues: countNegative(search, ['requests', 'requests_previous']),
        percentagesOutsideRange: countOutsidePercent(search, ['cart_conversion', 'cart_conversion_previous', 'order_conversion', 'order_conversion_previous']),
      },
      stocks: {
        fractionalUnitFields: countFractional(stocks, ['stock', 'in_transit_to_customer', 'in_transit_from_customer']),
        negativeValues: countNegative(stocks, ['stock', 'in_transit_to_customer', 'in_transit_from_customer', 'avg_daily_orders']),
      },
      positions: {
        fractionalPositions: countFractional(positions, ['position']),
        outsideTop50: positions.filter(row => (number(row.position) ?? 0) < 1 || (number(row.position) ?? 0) > 50).length,
      },
    },
  };
}
