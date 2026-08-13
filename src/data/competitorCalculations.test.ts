/// <reference types="node" />
import assert from 'node:assert/strict';
import test from 'node:test';
import { aggregateCompetitorBrands, aggregateCompetitorQueries, calculateCompetitorStockSlice, calculateCompetitorTopDynamics, weightedBuyoutRate } from './competitorCalculations.ts';
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

test('aggregates all competitor funnel metrics and keeps own assortment separate', () => {
  const base = { date: '2026-08-11', position: 1, seller: 'Seller', buyer_median_price: 1200, avg_search_position: 25, ctr: 0, cart_conversion: 0, order_conversion: 0 };
  const result = aggregateCompetitorBrands([
    { ...base, wb_article: 'own', brand: 'Our brand', ordered_amount: 2000, discounted_price: 1000, impressions: 1000, clicks: 100, carts: 20, orders: 10, buyouts: 8, buyout_rate: 80 },
    { ...base, wb_article: 'competitor', brand: 'Alpha', ordered_amount: 3000, discounted_price: 1500, impressions: 2000, clicks: 160, carts: 30, orders: 20, buyouts: 17, buyout_rate: 85 },
  ], new Set(['own']));

  const own = result.find(row => row.own)!;
  assert.equal(own.brand, 'Наш ассортимент');
  assert.equal(own.share, 40);
  assert.equal(own.ctr, 10);
  assert.equal(own.cartCr, 2);
  assert.equal(own.orderCr, 1);
  assert.equal(own.price, 1000);
});

test('builds stock distribution from snapshots without double-counting marketplace aggregate', () => {
  const row = { name: 'Product', subject: 'Lighting', region: '', in_transit_to_customer: 0, in_transit_from_customer: 0, avg_daily_orders: 10 };
  const result = calculateCompetitorStockSlice([
    { ...row, date: '2026-08-11', wb_article: 'a', brand: 'Alpha', warehouse: 'Маркетплейс', stock: 100 },
    { ...row, date: '2026-08-11', wb_article: 'a', brand: 'Alpha', warehouse: 'Казань', stock: 60 },
    { ...row, date: '2026-08-11', wb_article: 'a', brand: 'Alpha', warehouse: 'Москва', stock: 40 },
    { ...row, date: '2026-08-12', wb_article: 'a', brand: 'Alpha', warehouse: 'Маркетплейс', stock: 120 },
    { ...row, date: '2026-08-12', wb_article: 'a', brand: 'Alpha', warehouse: 'Казань', stock: 70 },
    { ...row, date: '2026-08-12', wb_article: 'a', brand: 'Alpha', warehouse: 'Москва', stock: 50 },
    { ...row, date: '2026-08-12', wb_article: 'b', brand: 'Beta', warehouse: 'Маркетплейс', stock: 30 },
  ], '2026-08-11', '2026-08-12');

  assert.equal(result.totalPrevious, 100);
  assert.equal(result.totalCurrent, 150);
  assert.equal(result.totalDelta, 50);
  assert.deepEqual(result.warehouses.map(item => [item.warehouse, item.stock]), [['Казань', 70], ['Москва', 50], ['Маркетплейс', 30]]);
  assert.deepEqual(result.brands.find(item => item.brand === 'Alpha'), { key: 'alpha', brand: 'Alpha', previous: 100, current: 120, delta: 20, deltaRate: 20 });
});

test('applies brand and warehouse filters to both stock comparison dates', () => {
  const row = { name: 'Product', subject: 'Lighting', region: '', in_transit_to_customer: 0, in_transit_from_customer: 0, avg_daily_orders: 10 };
  const result = calculateCompetitorStockSlice([
    { ...row, date: '2026-08-11', wb_article: 'a', brand: 'Alpha', warehouse: 'Казань', stock: 60 },
    { ...row, date: '2026-08-12', wb_article: 'a', brand: 'Alpha', warehouse: 'Казань', stock: 80 },
    { ...row, date: '2026-08-12', wb_article: 'b', brand: 'Beta', warehouse: 'Москва', stock: 40 },
  ], '2026-08-11', '2026-08-12', new Set(['alpha']), new Set(['казань']));

  assert.equal(result.totalPrevious, 60);
  assert.equal(result.totalCurrent, 80);
  assert.equal(result.brands.length, 1);
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
