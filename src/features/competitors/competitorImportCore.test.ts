import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCompetitorStagedRows, extractCompetitorWorkbook, splitCompetitorRows } from './competitorImportCore.ts';

const workbook = () => extractCompetitorWorkbook([
  { name: 'Воронка', data: [
    ['Служебная строка'],
    ['Дата', 'Позиция', 'Артикул', 'Продавец', 'Бренд', 'Сумма заказов', 'Цена со скидкой', 'Медиана покупателя', 'Ср позиция в поиске', 'Показы', 'Клики', 'CTR', 'Корзины', 'CR в корзину общий', 'Заказы', 'CR из показа в заказ', 'Выкупы', '% выкупа'],
    ['10.08', 1, 100, 'Seller', 'Brand', '1 000', '', 90, '', 1000, 100, 0.1, 50, '5%', 20, 2, 18, 0.9],
  ] },
  { name: 'Запросы', data: [
    ['Дата', 'Артикул', 'Поисковый запрос', 'Количество запросов', 'Количество запросов предыдущий период', 'Конверсия в корзину по артикулу', 'Конверсия в корзину по артикулу предыдущий период', 'Конверсия в заказ по артикулу', 'Конверсия в заказ по артикулу предыдущий период'],
    ['10.08.2026', '200', 'Люстра', 1000, 900, 20, 19, '143%', 125],
    ['10.08.2026', '200', 'Люстра', 1100, 950, 21, 20, '144%', 126],
  ] },
  { name: 'Остатки', data: [
    ['Дата', 'Название', 'Артикул WB', 'Предмет', 'Бренд', 'Регион', 'Склад', 'Остатки, шт', 'В пути к покупателю, шт', 'В пути от покупателя, шт', 'Среднее количество заказов в день, шт'],
    ['2026-08-10', 'Product', '100', 'Subject', 'Brand', '', 'Маркетплейс', 50, 0, 0, 5],
  ] },
  { name: 'ТОП', data: [
    ['Дата', 'Позиция', 'Артикул', 'Продавец', 'Бренд'],
    ['11.08.2026', 1, '100', '', ''],
  ] },
], 2026);

test('extractCompetitorWorkbook recognizes four sheets and preserves source semantics', () => {
  const parsed = workbook();
  assert.equal(parsed.totalRows, 4);
  assert.equal(parsed.dateStart, '2026-08-10');
  assert.equal(parsed.dateEnd, '2026-08-11');
  assert.equal(parsed.sections.funnel.sourceRowNumbers[0], 3);
  assert.equal(parsed.sections.funnel.rows[0].reported_ctr, 10);
  assert.equal(parsed.sections.funnel.rows[0].reported_buyout_rate, 90);
  assert.equal(parsed.sections.funnel.rows[0].discounted_price, 0);
  assert.equal(parsed.sections.funnel.rows[0].avg_search_position, 0);
  assert.equal(parsed.sections.search.rows[0].reported_order_conversion, 144);
  assert.equal(parsed.sections.search.rows[0].requests, 1100);
  assert.equal(parsed.sections.search.sourceRowNumbers[0], 3);
  assert.equal(parsed.sections.stocks.rows[0].warehouse, 'Маркетплейс');
  assert.equal(parsed.sections.positions.rows[0].seller, 'Без продавца');
  assert.equal(parsed.sections.positions.rows[0].brand, 'Без бренда');
});

test('buildCompetitorStagedRows emits canonical sections and original row numbers', () => {
  const rows = buildCompetitorStagedRows(workbook());
  assert.deepEqual(rows.map(row => row.sheet_name), ['funnel', 'search', 'stocks', 'positions']);
  assert.deepEqual(rows.map(row => row.row_number), [3, 3, 2, 2]);
  assert.equal(rows[1].payload.query, 'Люстра');
});

test('extractCompetitorWorkbook rejects an incomplete four-sheet file', () => {
  assert.throws(() => extractCompetitorWorkbook([{ name: 'ТОП', data: [['Дата', 'Позиция', 'Артикул', 'Продавец', 'Бренд']] }]), /отсутствуют листы/);
});

test('splitCompetitorRows enforces deterministic staging chunks', () => {
  assert.deepEqual(splitCompetitorRows([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
});
