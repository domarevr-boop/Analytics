import test from 'node:test';
import assert from 'node:assert/strict';
import type { GroupMembership, GroupMembershipHistory } from '../types/index.ts';
import { resolveGroupAtDate } from './groupMembershipHistory.ts';
import { canonicalizeDashboardGroupData, getDashboardGroupIdsForLinkedProduct } from './dashboardGroupAttribution.ts';

const canonicalIds = new Map([
  ['product-main', 'product-main'],
  ['product-old', 'product-main'],
]);

test('attributes an older linked metric to the canonical product earliest group', () => {
  const history: GroupMembershipHistory[] = [
    { date: '2026-09-01', product_id: 'product-main', group_id: 'group-a', source: 'import' },
  ];
  const canonical = canonicalizeDashboardGroupData(history, [], canonicalIds);

  const groups = getDashboardGroupIdsForLinkedProduct(
    'product-main',
    ['product-main', 'product-old'],
    [{ date: '2026-08-10', product_id: 'product-old' }],
    '2026-08-01',
    '2026-08-31',
    canonical.history,
    canonical.memberships,
  );

  assert.deepEqual([...groups], ['group-a']);
});

test('moves history stored on an old linked id to the canonical product', () => {
  const history: GroupMembershipHistory[] = [
    { date: '2026-08-01', product_id: 'product-old', group_id: 'group-old', source: 'import' },
    { date: '2026-09-01', product_id: 'product-main', group_id: 'group-new', source: 'import' },
  ];
  const canonical = canonicalizeDashboardGroupData(history, [], canonicalIds);

  assert.equal(resolveGroupAtDate('product-main', '2026-08-15', canonical.history).groupId, 'group-old');
  assert.equal(resolveGroupAtDate('product-main', '2026-09-15', canonical.history).groupId, 'group-new');
});

test('prefers a canonical history row when linked ids conflict on the same date', () => {
  const history: GroupMembershipHistory[] = [
    { date: '2026-09-01', product_id: 'product-old', group_id: 'group-old', source: 'import' },
    { date: '2026-09-01', product_id: 'product-main', group_id: 'group-main', source: 'import' },
  ];
  const memberships: GroupMembership[] = [
    { product_id: 'product-old', group_id: 'group-old' },
    { product_id: 'product-main', group_id: 'group-main' },
  ];
  const canonical = canonicalizeDashboardGroupData(history, memberships, canonicalIds);

  assert.deepEqual(canonical.history, [
    { date: '2026-09-01', product_id: 'product-main', group_id: 'group-main', source: 'import' },
  ]);
  assert.deepEqual(canonical.memberships, [
    { product_id: 'product-main', group_id: 'group-main' },
  ]);
});
