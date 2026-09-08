import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDirectoryBootstrap, validateDirectoryBootstrap } from './v5-directory-bootstrap-core.mjs';

test('merges exact cabinet identities and preserves dated group transitions', () => {
  const result = buildDirectoryBootstrap({
    cabinets: [{ id: 'cab-1', name: 'One' }],
    brands: [{ id: 'br-1', name: 'Brand' }],
    groups: [{ id: 'g1', name: 'Group', cabinet_id: 'cab-1' }, { id: 'global', name: 'Без склейки', cabinet_id: '' }],
    products: [
      { id: 'p1', cabinet_id: 'cab-1', sku: '100', wb_sku: '900', aliases: [], name: 'Product', category: 'Lights', brand_id: 'br-1' },
      { id: 'p2', cabinet_id: 'cab-1', sku: '900', wb_sku: '', aliases: [], name: '900', category: '', brand_id: '' },
    ],
    memberships: [],
    groupHistory: [
      { date: '2026-08-25', product_id: 'p1', group_id: 'g1', source: 'import' },
      { date: '2026-08-28', product_id: 'p2', group_id: 'grp-ungrouped', source: 'import' },
    ],
  });
  assert.equal(result.summary.acceptedProducts, 1);
  assert.equal(result.summary.queuedProductComponents, 0);
  assert.equal(result.legacyProductMap.length, 2);
  assert.equal(result.legacyProductMap[0].cabinetExternalKey, 'cab-1');
  assert.equal(result.groupHistory.length, 2);
  assert.equal(result.groupHistory[1].groupExternalKey, '__ungrouped__');
  assert.equal(result.products[0].dataSource, 'seed');
  assert.deepEqual(validateDirectoryBootstrap(result), []);
});

test('queues ambiguous identity components instead of guessing', () => {
  const result = buildDirectoryBootstrap({
    cabinets: [{ id: 'cab-1', name: 'One' }],
    brands: [],
    groups: [],
    products: [
      { id: 'p1', cabinet_id: 'cab-1', sku: '100', wb_sku: '900', aliases: ['shared'], name: 'A', category: '', brand_id: '' },
      { id: 'p2', cabinet_id: 'cab-1', sku: '200', wb_sku: '901', aliases: ['shared'], name: 'B', category: '', brand_id: '' },
    ],
    memberships: [],
    groupHistory: [{ date: '2026-08-25', product_id: 'p2', group_id: 'grp-ungrouped', source: 'import' }],
  });
  assert.equal(result.summary.acceptedProducts, 0);
  assert.equal(result.summary.queuedProductComponents, 1);
  assert.deepEqual(result.reviewQueue[0].reasons.slice(0, 2), ['multiple_wb_sku', 'multiple_seller_sku']);
  assert.equal(result.reviewQueue[0].candidates.length, 2);
  assert.deepEqual(result.reviewQueue[0].groupHistoryCandidates, [{
    legacyProductId: 'p2', date: '2026-08-25', legacyGroupId: 'grp-ungrouped', source: 'import',
  }]);
  assert.equal(result.summary.skippedHistoryForQueuedProducts, 1);
});

test('queues unknown and cross-cabinet groups instead of treating them as ungrouped', () => {
  const result = buildDirectoryBootstrap({
    cabinets: [{ id: 'cab-1', name: 'One' }, { id: 'cab-2', name: 'Two' }],
    brands: [],
    groups: [{ id: 'g2', name: 'Other group', cabinet_id: 'cab-2' }],
    products: [{ id: 'p1', cabinet_id: 'cab-1', sku: '100', wb_sku: '', aliases: [], name: 'A', category: '', brand_id: '' }],
    memberships: [],
    groupHistory: [
      { date: '2026-08-25', product_id: 'p1', group_id: 'missing', source: 'import' },
      { date: '2026-08-26', product_id: 'p1', group_id: 'g2', source: 'import' },
    ],
  });
  assert.equal(result.groupHistory.length, 0);
  assert.equal(result.summary.skippedHistoryForInvalidGroupReference, 2);
  assert.deepEqual(result.reviewQueue.map(row => row.reasons[0]), ['unknown_group', 'group_cabinet_mismatch']);
});

test('never restores a conflicted dated membership after a third merged row', () => {
  const result = buildDirectoryBootstrap({
    cabinets: [{ id: 'cab-1', name: 'One' }],
    brands: [],
    groups: [
      { id: 'g1', name: 'One', cabinet_id: 'cab-1' },
      { id: 'g2', name: 'Two', cabinet_id: 'cab-1' },
    ],
    products: [
      { id: 'p1', cabinet_id: 'cab-1', sku: '100', wb_sku: '900', aliases: [], name: 'A', category: '', brand_id: '' },
      { id: 'p2', cabinet_id: 'cab-1', sku: '900', wb_sku: '', aliases: [], name: 'B', category: '', brand_id: '' },
    ],
    memberships: [],
    groupHistory: [
      { date: '2026-08-25', product_id: 'p1', group_id: 'g1', source: 'import' },
      { date: '2026-08-25', product_id: 'p2', group_id: 'g2', source: 'import' },
      { date: '2026-08-25', product_id: 'p1', group_id: 'g1', source: 'import' },
    ],
  });
  assert.equal(result.groupHistory.length, 0);
  assert.equal(result.summary.historyConflictsAfterMerge, 1);
});

test('validator detects cross-table and identity violations without exposing row values', () => {
  const bootstrap = buildDirectoryBootstrap({
    cabinets: [{ id: 'cab-1', name: 'One' }],
    brands: [],
    groups: [],
    products: [{ id: 'p1', cabinet_id: 'cab-1', sku: '100', wb_sku: '', aliases: [], name: 'A', category: '', brand_id: '' }],
    memberships: [],
    groupHistory: [],
  });
  bootstrap.aliases.push({ productExternalKey: 'missing', cabinetExternalKey: 'cab-1', value: '100', type: 'historical' });
  const errors = validateDirectoryBootstrap(bootstrap);
  assert.deepEqual(errors.map(error => error.code), ['identity_owned_by_multiple_products', 'aliasUnknownProduct']);
  assert.deepEqual(Object.keys(errors[0]).sort(), ['code', 'count']);
});
