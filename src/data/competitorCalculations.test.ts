/// <reference types="node" />
import assert from 'node:assert/strict';
import test from 'node:test';
import { aggregateCompetitorQueries, calculateCompetitorTopDynamics, weightedBuyoutRate } from './competitorCalculations.ts';
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

test('compares the structure of the top between two days', () => {
  const result = calculateCompetitorTopDynamics([
    { date: '2026-08-11', position: 1, wb_article: 'a', brand: 'Alpha', seller: 'A' },
    { date: '2026-08-11', position: 2, wb_article: 'b', brand: 'Beta', seller: 'B' },
    { date: '2026-08-11', position: 3, wb_article: 'c', brand: 'Beta', seller: 'B' },
    { date: '2026-08-12', position: 1, wb_article: 'b', brand: 'Beta', seller: 'B' },
    { date: '2026-08-12', position: 2, wb_article: 'a', brand: 'Alpha', seller: 'A' },
    { date: '2026-08-12', position: 3, wb_article: 'd', brand: 'Delta', seller: 'D' },
  ], 3);

  assert.equal(result.stabilityRate.toFixed(1), '66.7');
  assert.equal(result.entrants, 1);
  assert.equal(result.exits, 1);
  assert.equal(result.averageMovement, 1);
  assert.deepEqual(result.timeline[1], { date: '2026-08-12', size: 3, retained: 2, entrants: 1, exits: 1, retentionRate: 66.66666666666666 });
  assert.equal(result.movements.find(row => row.article === 'd')?.status, 'new');
  assert.equal(result.movements.find(row => row.article === 'c')?.status, 'exited');
  assert.deepEqual(result.brandStructure.find(row => row.brand === 'Beta')?.counts, [2, 1]);
});

test('applies top depth before comparing daily snapshots', () => {
  const result = calculateCompetitorTopDynamics([
    { date: '2026-08-11', position: 1, wb_article: 'a', brand: 'Alpha', seller: 'A' },
    { date: '2026-08-11', position: 11, wb_article: 'b', brand: 'Beta', seller: 'B' },
    { date: '2026-08-12', position: 1, wb_article: 'a', brand: 'Alpha', seller: 'A' },
    { date: '2026-08-12', position: 10, wb_article: 'b', brand: 'Beta', seller: 'B' },
  ], 10);

  assert.equal(result.entrants, 1);
  assert.equal(result.movements.find(row => row.article === 'b')?.status, 'new');
});
