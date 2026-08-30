/// <reference types="node" />
import assert from 'node:assert/strict';
import test from 'node:test';
import { amountShare, toMillions, topFiveWithOther } from './geographyCalculations.ts';

test('converts order amounts to millions without changing the source amount', () => {
  assert.equal(toMillions(5_000_000), 5);
  assert.equal(toMillions(300_000), 0.3);
});

test('calculates the amount share against the selected denominator', () => {
  assert.equal(amountShare(300_000, 5_000_000), 6);
  assert.equal(amountShare(300_000, 0), 0);
});

test('keeps the top five and groups the remainder', () => {
  const rows = topFiveWithOther([
    { name: 'A', value: 50 }, { name: 'B', value: 40 }, { name: 'C', value: 30 },
    { name: 'D', value: 20 }, { name: 'E', value: 10 }, { name: 'F', value: 5 },
  ]);
  assert.deepEqual(rows.map(row => row.name), ['A', 'B', 'C', 'D', 'E', 'Остальные']);
  assert.equal(rows.at(-1)?.value, 5);
  assert.equal(rows.reduce((sum, row) => sum + row.share, 0), 100);
});
