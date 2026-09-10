import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGeographyStagedRows, extractGeographyWorkbook, parseGeographyDeliveryHours, splitGeographyRows } from './geographyImportCore.ts';

const headers = [
  'Дата', 'Артикул продавца', 'Артикул WB', 'Регион', 'Область', 'Город', 'Время доставки',
  'Итого заказов, шт', 'Итого заказов по товарам локально, шт', 'Итого заказов по товарам не локально, шт',
  'Заказы со склада WB локально, шт', 'Заказы со склада WB не локально, шт',
  'Заказы Маркетплейс локально, шт', 'Заказы Маркетплейс не локально, шт',
];

test('extractGeographyWorkbook maps WB columns and keeps the last normalized duplicate', () => {
  const workbook = extractGeographyWorkbook([{ name: 'География', data: [
    ['Служебная строка'],
    headers,
    [new Date('2026-07-18T00:00:00Z'), 40485, 604474541, 'Центральный', '', '', '0д 23ч', 30, 1, 29, 1, 29, 0, 0],
    ['18.07.2026', '40485', '604474541', ' Центральный ', '', '', '-', 31, 2, 29, 2, 29, 0, 0],
  ] }]);
  assert.equal(workbook.inputRows, 2);
  assert.equal(workbook.rows.length, 1);
  assert.equal(workbook.replacedDuplicateRows, 1);
  assert.equal(workbook.dateStart, '2026-07-18');
  assert.equal(workbook.sourceRowNumbers[0], 4);
  assert.equal(workbook.rows[0].orders_total, 31);
  assert.equal(workbook.rows[0].delivery_hours, null);
  assert.equal(workbook.rows[0].area, 'Без региона');
});

test('delivery parser accepts days, hours and numeric values while preserving malformed source', () => {
  assert.equal(parseGeographyDeliveryHours('2д 3ч'), 51);
  assert.equal(parseGeographyDeliveryHours('17ч'), 17);
  assert.equal(parseGeographyDeliveryHours('1,5'), 1.5);
  assert.equal(parseGeographyDeliveryHours('-'), null);
  assert.equal(parseGeographyDeliveryHours('завтра'), 'завтра');
});

test('build and split preserve source row numbers and deterministic chunks', () => {
  const workbook = extractGeographyWorkbook([{ name: 'Лист1', data: [
    headers,
    ['2026-07-18', 'sku-1', '', 'Центральный', '', '', '-', 1, 1, 0, 1, 0, 0, 0],
    ['2026-07-19', 'sku-1', '', 'Центральный', '', '', 24, 2, 1, 1, 1, 0, 1, 0],
  ] }]);
  const staged = buildGeographyStagedRows(workbook);
  assert.deepEqual(staged.map(row => row.row_number), [2, 3]);
  assert.deepEqual(splitGeographyRows(staged, 1).map(chunk => chunk.length), [1, 1]);
});

test('rejects a workbook without all required order splits', () => {
  assert.throws(() => extractGeographyWorkbook([{ name: 'Лист1', data: [[
    'Дата', 'Артикул продавца', 'Регион', 'Итого заказов, шт',
  ]] }]), /отсутствуют обязательные колонки/);
});
