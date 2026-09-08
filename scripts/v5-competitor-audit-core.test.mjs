import test from 'node:test';
import assert from 'node:assert/strict';
import { auditV4Competitors } from './v5-competitor-audit-core.mjs';

test('audits competitor keys, ranges and cross-sheet coverage without returning rows', () => {
  const result = auditV4Competitors({
    funnel: [{ date: '2026-08-11', wb_article: '1' }, { date: '2026-08-11', wb_article: '1' }],
    search: [{ date: '2026-08-11', wb_article: '1', query: 'Люстра' }, { date: '2026-08-11', wb_article: '2', query: 'Свет' }],
    stocks: [{ date: '2026-08-10', wb_article: '1', region: '', warehouse: 'Маркетплейс' }],
    positions: [{ date: '2026-08-11', wb_article: '1', position: 50 }],
  });
  assert.equal(result.duplicateKeys.funnel, 1);
  assert.equal(result.ranges.stocks.minDate, '2026-08-10');
  assert.equal(result.crossSheetCoverage.search.missingFromFunnel, 1);
  assert.equal(result.topDepth, 50);
  assert.equal('rows' in result, false);
});
