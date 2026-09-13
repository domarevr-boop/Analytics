import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEntryPointsStagedRows, extractEntryPointsWorkbook, splitEntryPointsRows } from './entryPointsImportCore.ts';

test('parses V4 entry points columns and keeps the last canonical duplicate', () => {
  const workbook = extractEntryPointsWorkbook([{ name: 'Точки входа', data: [
    ['Дата', 'Артикул продавца', 'Артикул WB', 'Раздел', 'Точка входа', 'Показы', 'Переходы в карточку', 'Добавления в корзину', 'Заказы'],
    ['10.08.2026', 'ABC.0', '100', 'Поиск', 'Поиск WB', 10, 5, 3, 2],
    ['10.08.2026', 'ABC', '100', 'Поиск', 'Поиск WB', 20, 8, 4, 3],
    ['11.08.2026', 'ABC', '100', 'Карточка товара', '-', 7, 4, 2, 1],
  ] }]);
  assert.equal(workbook.inputRows, 3);
  assert.equal(workbook.rows.length, 2);
  assert.equal(workbook.replacedDuplicateRows, 1);
  assert.equal(workbook.rows[0].impressions, 20);
  assert.equal(workbook.rows[1].entry_point, 'Без уточнения');
  assert.deepEqual([workbook.dateStart, workbook.dateEnd], ['2026-08-10', '2026-08-11']);
  assert.equal(buildEntryPointsStagedRows(workbook)[0].row_number, 3);
});

test('preserves invalid values for server validation and chunks rows', () => {
  const workbook = extractEntryPointsWorkbook([{ name: 'Data', data: [
    ['date', 'sku', 'section', 'entry point', 'impressions', 'clicks', 'carts', 'orders'],
    ['bad', 'A', 'Поиск', '', 'wrong', -1, 0, 0],
  ] }]);
  assert.equal(workbook.rows[0].date, 'bad');
  assert.equal(workbook.rows[0].impressions, 'wrong');
  assert.equal(workbook.rows[0].entry_point, 'Без уточнения');
  assert.deepEqual(splitEntryPointsRows([1, 2, 3], 2), [[1, 2], [3]]);
});
