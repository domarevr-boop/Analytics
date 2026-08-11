import assert from 'node:assert/strict';
import test from 'node:test';
import { orderShare } from './geographyCalculations.ts';

test('orderShare uses the common analytical denominator', () => {
  assert.equal(orderShare(250, 1000), 25);
  assert.equal(orderShare(1000, 1000), 100);
});

test('orderShare returns zero when the analytical set is empty', () => {
  assert.equal(orderShare(0, 0), 0);
  assert.equal(orderShare(25, 0), 0);
});
