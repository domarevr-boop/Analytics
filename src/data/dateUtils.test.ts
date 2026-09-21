/// <reference types="node" />
import assert from 'node:assert/strict';
import test from 'node:test';
import { getLatestWeekPeriod } from './dateUtils.ts';

test('latest week contains seven calendar days ending at the newest date', () => {
  assert.deepEqual(getLatestWeekPeriod('2026-09-20'), { start: '2026-09-14', end: '2026-09-20' });
  assert.deepEqual(getLatestWeekPeriod('2026-03-03'), { start: '2026-02-25', end: '2026-03-03' });
});

test('latest week stays empty when the source has no date', () => {
  assert.deepEqual(getLatestWeekPeriod(''), { start: '', end: '' });
});
