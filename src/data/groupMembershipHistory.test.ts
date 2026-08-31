import test from 'node:test';
import assert from 'node:assert/strict';
import { groupMatchesAtDate, groupsActiveInPeriod, resolveGroupAtDate } from './groupMembershipHistory.ts';

const history = [
  { date: '2026-08-25', product_id: 'p1', group_id: 'g3', source: 'import' as const },
  { date: '2026-08-28', product_id: 'p1', group_id: 'g8', source: 'import' as const },
];

test('uses the last known membership until the next change', () => {
  assert.deepEqual(resolveGroupAtDate('p1', '2026-08-25', history), { groupId: 'g3', known: true, effectiveDate: '2026-08-25' });
  assert.equal(resolveGroupAtDate('p1', '2026-08-27', history).groupId, 'g3');
  assert.equal(resolveGroupAtDate('p1', '2026-08-31', history).groupId, 'g8');
});

test('does not invent a state before the first historical row', () => {
  assert.deepEqual(resolveGroupAtDate('p1', '2026-08-24', history), { groupId: null, known: false });
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
