import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSearchQueriesStagedRows, extractSearchQueriesWorkbook, normalizeSearchQueriesHeader, splitSearchQueriesRows } from './searchQueriesImportCore.ts';

const headers = [
  'Дата', 'Поисковый запрос', 'Количество запросов', 'Количество запросов (предыдущий период)',
  'Запросов в среднем за день', 'Запросов в среднем за день (предыдущий период)',
  'Больше всего заказов в предмете', 'Перешли в карточку товара', 'Перешли в карточку товара (предыдущий период)',
  'Добавили в корзину', 'Добавили в корзину (предыдущий период)', 'Конверсия в корзину', 'Конверсия в корзину (предыдущий период)',
  'Заказали товаров', 'Заказали товаров (предыдущий период)', 'Конверсия в заказ', 'Конверсия в заказ (предыдущий период)',
  'Предметов с заказами по запросу', 'Предметов с заказами по запросу (предыдущий период)', 'Количество товаров', 'Количество товаров (предыдущий период)',
];

test('нормализует заголовки WB с пометкой предыдущего периода', () => {
  assert.equal(normalizeSearchQueriesHeader('Количество запросов (предыдущий период)'), 'количество запросов предыдущий период');
});

test('сохраняет зерно V4 и последнюю строку дубля', () => {
  const first = ['19.07.2026', '  Платье  ', 100, 80, 14, 11, 'Платья', 40, 30, 20, 12, '50%', 40, 10, 5, 50, 41, 2, 1, 500, 450];
  const last = [...first]; last[2] = 120;
  const parsed = extractSearchQueriesWorkbook([{ name: 'Лист1', data: [headers, first, last] }]);
  assert.equal(parsed.inputRows, 2);
  assert.equal(parsed.rows.length, 1);
  assert.equal(parsed.replacedDuplicateRows, 1);
  assert.equal(parsed.rows[0].query, 'платье');
  assert.equal(parsed.rows[0].requests, 120);
  assert.equal(parsed.rows[0].cart_conversion, 50);
  assert.equal(parsed.dateStart, '2026-07-19');
  assert.deepEqual(buildSearchQueriesStagedRows(parsed)[0].row_number, 3);
});

test('делит строки на серверные чанки', () => {
  assert.deepEqual(splitSearchQueriesRows([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
});

test('распознаёт реальные даты без года из файла 2026.xlsx', () => {
  const first = ['19.07', 'люстра потолочная', 8447, 7901, 8447, 7901, 'Люстры', 39349, 36346, 2851, 2701, 7, 7, 467, 418, 16, 15, 24, 16, 258179, 263405];
  const last = [...first]; last[0] = '24.09'; last[1] = 'храброф светодиодная лента';
  const parsed = extractSearchQueriesWorkbook([{ name: 'Лист1', data: [headers, first, last] }], '2026.xlsx');
  assert.deepEqual([parsed.dateStart, parsed.dateEnd], ['2026-07-19', '2026-09-24']);
  assert.equal(parsed.rows[1].date, '2026-09-24');
});

test('не отправляет на сервер даты без однозначного года', () => {
  const row = ['24.09', 'люстра', 1, 0, 1, 0, 'Люстры', 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0];
  const data = [{ name: 'Лист1', data: [headers, row] }];
  assert.throws(() => extractSearchQueriesWorkbook(data, 'отчёт.xlsx'), /укажите один год в имени файла/u);
  assert.throws(() => extractSearchQueriesWorkbook(data, '2025-2026.xlsx'), /укажите один год в имени файла/u);
});
