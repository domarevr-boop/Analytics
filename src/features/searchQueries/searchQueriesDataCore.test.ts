import assert from 'node:assert/strict';
import test from 'node:test';
import { assertSearchQueriesFilters, parseSearchQueriesOptions, parseSearchQueriesRows, parseSearchQueriesSummary } from './searchQueriesDataCore.ts';

test('проверяет период и текстовый фильтр', () => {
  assert.deepEqual(assertSearchQueriesFilters({ start: '2026-07-19', end: '2026-09-01', search: 'платье' }).search, 'платье');
  assert.throws(() => assertSearchQueriesFilters({ start: '2026-09-01', end: '2026-07-19' }));
});

test('разбирает серверные фильтры и nullable долю', () => {
  assert.deepEqual(parseSearchQueriesOptions([{ min_date: '2026-07-19', max_date: '2026-09-01', category_count: 2, query_count: 3, categories: ['Платья'] }]).categories, ['Платья']);
  const summary = parseSearchQueriesSummary({ requests: 10, requests_previous: 5, card_clicks: 8, card_clicks_previous: 4, carts: 3, carts_previous: 2, orders: 1, orders_previous: 1, order_amount: 1000, order_amount_previous: 900, query_count: 2, own_orders: null, own_orders_share: null });
  assert.equal(summary.ownOrdersShare, null);
});

test('разбирает пагинированную строку с общим количеством', () => {
  const [row] = parseSearchQueriesRows([{ query: 'платье', category: 'Платья', requests: 100, requests_previous: 80, card_clicks: 40, card_clicks_previous: 30, carts: 20, carts_previous: 10, orders: 5, orders_previous: 4, products: 500, products_previous: 450, order_amount: 5000, order_amount_previous: 3600, cart_cr: 50, order_cr: 25, growth: 25, opportunity: 3.2, total_count: 2000 }]);
  assert.equal(row.totalCount, 2000);
});
