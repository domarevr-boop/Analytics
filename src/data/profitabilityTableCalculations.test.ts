import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyProfitabilityRows, flattenExpandedHierarchy } from './profitabilityTableCalculations.ts';

test('calculates two-letter ABC from selected-period revenue and positive net profit', () => {
  const result = classifyProfitabilityRows([
    { id: 'p1', groupId: 'g1', revenue: 80, netProfit: 5, adSpend: 2 },
    { id: 'p2', groupId: 'g1', revenue: 15, netProfit: 4, adSpend: 1 },
    { id: 'p3', groupId: 'g1', revenue: 5, netProfit: -2, adSpend: 0 },
  ]);

  assert.equal(result.get('p1')?.abc, 'AA');
  assert.equal(result.get('p2')?.abc, 'BA');
  assert.equal(result.get('p3')?.abc, 'CC');
});

test('assigns business roles relative to products in the same group', () => {
  const result = classifyProfitabilityRows([
    { id: 'tractor', groupId: 'g1', revenue: 70, netProfit: -1, adSpend: 80 },
    { id: 'generator', groupId: 'g1', revenue: 20, netProfit: 20, adSpend: 15 },
    { id: 'other', groupId: 'g1', revenue: 10, netProfit: 1, adSpend: 5 },
  ]);

  assert.equal(result.get('tractor')?.role, 'tractor');
  assert.equal(result.get('generator')?.role, 'profit-generator');
  assert.equal(result.get('other')?.role, 'non-liquid');
});

test('shows descendants only when every ancestor is expanded', () => {
  const rows = [
    { id: 'cabinet', parent: null, value: 3 },
    { id: 'category', parent: 'cabinet', value: 2 },
    { id: 'group', parent: 'category', value: 1 },
  ];

  assert.deepEqual(
    flattenExpandedHierarchy(rows, new Set(['category']), (left, right) => right.value - left.value).map(row => row.id),
    ['cabinet'],
  );
  assert.deepEqual(
    flattenExpandedHierarchy(rows, new Set(['cabinet', 'category']), (left, right) => right.value - left.value).map(row => row.id),
    ['cabinet', 'category', 'group'],
  );
});
