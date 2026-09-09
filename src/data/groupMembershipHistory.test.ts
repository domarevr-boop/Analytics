import test from 'node:test';
import assert from 'node:assert/strict';
import { currentMembershipsFromHistory, groupMatchesAtDate, groupsActiveInPeriod, importedGroupHistoryOnly, resolveGroupAtDate } from './groupMembershipHistory.ts';

const history = [
  { date: '2026-08-25', product_id: 'p1', group_id: 'g3', source: 'import' as const },
  { date: '2026-08-28', product_id: 'p1', group_id: 'g8', source: 'import' as const },
];

test('uses the last known membership until the next change', () => {
  assert.deepEqual(resolveGroupAtDate('p1', '2026-08-25', history), { groupId: 'g3', known: true, effectiveDate: '2026-08-25' });
  assert.equal(resolveGroupAtDate('p1', '2026-08-27', history).groupId, 'g3');
  assert.equal(resolveGroupAtDate('p1', '2026-08-31', history).groupId, 'g8');
});

test('backfills dates before the first historical row from the earliest known membership', () => {
  assert.deepEqual(resolveGroupAtDate('p1', '2026-08-24', history), { groupId: 'g3', known: true, effectiveDate: '2026-08-25' });
});

test('keeps a product unknown when it has no history at all', () => {
  assert.deepEqual(resolveGroupAtDate('missing', '2026-08-24', history), { groupId: null, known: false });
});

test('matches a selected group only for its actual dates', () => {
  assert.equal(groupMatchesAtDate('p1', '2026-08-27', 'g3', history), true);
  assert.equal(groupMatchesAtDate('p1', '2026-08-28', 'g3', history), false);
  assert.equal(groupMatchesAtDate('p1', '2026-08-28', 'g8', history), true);
});

test('lists groups active in a selected period', () => {
  const products = [{ id: 'p1', sku: '1', wb_sku: '', name: '', category: '', brand_id: '', cabinet_id: '' }];
  assert.deepEqual(groupsActiveInPeriod(products, '2026-08-25', '2026-08-31', history), new Set(['g3', 'g8']));
});

test('rebuilds current memberships from the latest imported state', () => {
  const importedOnly = [
    ...history,
    { date: '2026-08-26', product_id: 'p2', group_id: 'g4', source: 'import' as const },
    { date: '2026-08-30', product_id: 'p2', group_id: 'g9', source: 'import' as const },
  ];
  assert.deepEqual(currentMembershipsFromHistory(importedOnly), [
    { product_id: 'p1', group_id: 'g8' },
    { product_id: 'p2', group_id: 'g9' },
  ]);
});

test('drops obsolete manual history before rebuilding imported membership state', () => {
  const corrupted = [
    ...history,
    { date: '2026-08-29', product_id: 'p1', group_id: 'wrong-group', source: 'manual' as const },
  ];
  const cleaned = importedGroupHistoryOnly(corrupted);
  assert.equal(cleaned.some(row => row.source === 'manual'), false);
  assert.deepEqual(currentMembershipsFromHistory(cleaned), [{ product_id: 'p1', group_id: 'g8' }]);
  assert.equal(resolveGroupAtDate('p1', '2026-08-31', cleaned).groupId, 'g8');
});
