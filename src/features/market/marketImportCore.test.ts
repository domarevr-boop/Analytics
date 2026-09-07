import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMarketStagedRows, extractMarketTable, mapMarketSourceRows, splitMarketRows } from './marketImportCore.ts';

test('detects the market header below report metadata and preserves source rows', () => {
  const result = extractMarketTable([
    ['Отчёт', 'Рынок'],
    [],
    ['Дата', 'Заказы рынок', 'Наши заказы', 'Наша доля', 'Заказы, шт, рынок', 'Заказы, шт, мы'],
    ['01.06.2026', 49_526_859, 3_904_149, '7,88%', 15_248, 2_101],
  ], 'Данные');
  assert.ok(result);
  assert.equal(result.rows.length, 1);
  assert.equal(result.sourceRowNumbers[0], 4);
  assert.equal(result.rows[0]['заказы рынок'], '49526859');
});

test('normalizes localized market values while preserving invalid values for server validation', () => {
  const [valid, invalid] = buildMarketStagedRows([
    {
      date: '01.06.2026',
      market_ordered_amount: '49 526 859 ₽',
      market_own_ordered_amount: '3 904 149',
      market_orders: '15 248',
      market_own_orders: '2 101',
      market_amount_share: '7,88%',
    },
    {
      date: '31.02.2026',
      market_ordered_amount: 'ошибка',
      market_own_ordered_amount: '-1',
      market_orders: '1,5',
      market_own_orders: '1',
    },
  ], [8, 9], 'Рынок');

  assert.deepEqual(valid, {
    sheet_name: 'Рынок',
    row_number: 8,
    payload: {
      date: '2026-06-01',
      market_ordered_amount: 49_526_859,
      own_ordered_amount: 3_904_149,
      market_orders: 15_248,
      own_orders: 2_101,
      amount_share: 7.88,
    },
  });
  assert.equal(invalid.payload.date, '31.02.2026');
  assert.equal(invalid.payload.market_ordered_amount, 'ошибка');
  assert.equal(invalid.payload.own_ordered_amount, -1);
  assert.equal(invalid.payload.market_orders, 1.5);
});

test('maps real market headers and restores Excel percentage fractions to percentage points', () => {
  const [mapped] = mapMarketSourceRows([{
    'дата': '2026-06-01',
    'заказы рынок': '49526859.15270157',
    'наши заказы': '3904149',
    'наша доля': '0.07882892367',
    'заказы, шт, рынок': '15248',
    'заказы, шт, мы': '2101',
    'наша доля в заказах': '0.1377885624',
  }]);
  const [row] = buildMarketStagedRows([mapped], [2], 'Лист1');

  assert.ok(Math.abs(Number(row.payload.amount_share) - 7.882892367) < 1e-9);
  assert.ok(Math.abs(Number(row.payload.orders_share) - 13.77885624) < 1e-9);
});

test('splits staging rows into bounded chunks', () => {
  const chunks = splitMarketRows(Array.from({ length: 1_001 }, (_, index) => index));
  assert.deepEqual(chunks.map(chunk => chunk.length), [500, 500, 1]);
});
