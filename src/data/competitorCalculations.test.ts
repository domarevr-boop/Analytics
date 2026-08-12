/// <reference types="node" />
import assert from 'node:assert/strict';
import test from 'node:test';
import { aggregateCompetitorQueries, weightedBuyoutRate } from './competitorCalculations.ts';
import { competitorNumber, competitorPercent } from './competitorValueParsing.ts';

test('reads raw Excel numbers without applying display scaling', () => {
  assert.equal(competitorNumber(8_609_881), 8_609_881);
  assert.equal(competitorNumber('8 609 881,00 ₽'), 8_609_881);
  assert.equal(competitorNumber('8,609,881.00 ₽'), 8_609_881);
  assert.equal(competitorNumber('26.3'), 26.3);
  assert.equal(competitorNumber('26,3'), 26.3);
});

test('normalizes numeric Excel percentages to percentage points', () => {
  assert.equal(competitorPercent(0.051), 5.1);
  assert.equal(competitorPercent('5,1%'), 5.1);
  assert.equal(competitorPercent(20), 20);
});

test('uses source buyout rate instead of dividing lagged buyouts by orders', () => {
  assert.equal(weightedBuyoutRate([{ orders: 2269, buyout_rate: 91 }, { orders: 7217, buyout_rate: 92 }]).toFixed(1), '91.8');
});

test('deduplicates global search frequency repeated for several articles', () => {
  const result = aggregateCompetitorQueries([
    { query: 'Люстра потолочная', requests: 219111, requests_previous: 217233, wb_article: '1' },
    { query: 'люстра  потолочная', requests: 219111, requests_previous: 217233, wb_article: '2' },
  ]);
  assert.deepEqual(result, [{ query: 'Люстра потолочная', requests: 219111, requestsPrevious: 217233, articles: 2 }]);
});
