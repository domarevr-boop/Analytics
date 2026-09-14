import test from 'node:test';
import assert from 'node:assert/strict';
import { buildProfitabilityStagedRows, calculateProfitabilityAmounts, extractProfitabilityWorkbook, splitProfitabilityRows } from './profitabilityImportCore.ts';

test('parses the real profitability headers and calculates gross profit from expense components', () => {
  const workbook = extractProfitabilityWorkbook([{ name: 'Лист1', data: [
    ['Дата', 'Артикул', 'Количество', 'Выручка', 'Себестоимость', 'Агентское вознаграждение', 'Стоимость логистики', 'Сумма рекламы', 'Сумма хранения', 'Валоваяприбыльсучетомрасходовмаркетплейса', 'Итоговая маржинальность,%'],
    ['01.08.2026', 'A.0', 2, 1000, 300, 100, 50, 25, 25, 500, 50],
    ['2026-08-01', 'A', 3, 1200, 400, 100, 50, 50, 0, 600, 0.5],
  ] }]);
  assert.equal(workbook.inputRows, 2);
  assert.equal(workbook.rows.length, 1);
  assert.equal(workbook.replacedDuplicateRows, 1);
  assert.equal(workbook.rows[0].quantity, 3);
  assert.equal(workbook.rows[0].reported_gross_margin, 50);
  assert.deepEqual(calculateProfitabilityAmounts(workbook.rows[0]), { revenue: 1200, grossProfit: 600, grossMargin: 50 });
  assert.equal(buildProfitabilityStagedRows(workbook)[0].row_number, 3);
  assert.deepEqual(splitProfitabilityRows([1, 2, 3], 2), [[1, 2], [3]]);
});

test('preserves malformed values for server validation', () => {
  const workbook = extractProfitabilityWorkbook([{ name: 'Data', data: [
    ['Date', 'seller SKU', 'Revenue', 'Cost'],
    ['bad-date', 'SKU', 'wrong', -1],
  ] }]);
  assert.equal(workbook.rows[0].date, 'bad-date');
  assert.equal(workbook.rows[0].revenue, 'wrong');
  assert.equal(workbook.rows[0].cost, -1);
});
