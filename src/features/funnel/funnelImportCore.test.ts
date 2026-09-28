import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFunnelStagedRows, calculateAdCpo, extractFunnelWorkbook, splitFunnelRows } from './funnelImportCore.ts';

test('maps XWay quantity and amount separately and calculates CPO from quantity', () => {
  const workbook = extractFunnelWorkbook([{ name: 'Лист1', data: [
    ['Дата', 'Артикул WB', 'Артикул продавца', 'Показы', 'Клики', 'Заказы, шт', 'Заказы, руб', 'Расход, руб.'],
    ['2026-08-01T00:00:00.000Z', 100, 'ABC.0', 1000, 50, 5, '7 500,00 ₽', '1 000,00 ₽'],
    ['01.08.2026', 100, 'ABC', 200, 10, 2, 3000, 400],
  ] }], 'xway');
  assert.equal(workbook.rows.length, 1);
  assert.equal(workbook.aggregatedRows, 1);
  assert.deepEqual(workbook.presentMetricFields, ['ad_impressions', 'ad_clicks', 'ad_orders_qty', 'ad_ordered_amount', 'ad_spend']);
  assert.deepEqual(workbook.rows[0], {
    date: '2026-08-01', seller_sku: 'ABC', wb_sku: '100',
    ad_impressions: 1200, ad_clicks: 60, ad_orders_qty: 7, ad_ordered_amount: 10500, ad_spend: 1400,
  });
  assert.equal(calculateAdCpo(1400, Number(workbook.rows[0].ad_orders_qty)), 200);
  assert.equal(buildFunnelStagedRows(workbook)[0].row_number, 3);
});

test('recognizes the English headers used by a real XWay export', () => {
  const workbook = extractFunnelWorkbook([{ name: 'Data', data: [
    ['Date', 'WB SKU', 'seller SKU', 'Shows', 'Clicks', 'Orders qty', 'Orders rub', 'Spend rub'],
    ['2026-09-01', 123, 'SKU-1', 900, 45, 3, 3600, 750],
  ] }], 'xway');
  assert.deepEqual(workbook.presentMetricFields, ['ad_impressions', 'ad_clicks', 'ad_orders_qty', 'ad_ordered_amount', 'ad_spend']);
  assert.deepEqual(workbook.rows[0], {
    date: '2026-09-01', seller_sku: 'SKU-1', wb_sku: '123',
    ad_impressions: 900, ad_clicks: 45, ad_orders_qty: 3, ad_ordered_amount: 3600, ad_spend: 750,
  });
});

test('keeps absent WB columns out of a partial patch and preserves invalid values for the server', () => {
  const workbook = extractFunnelWorkbook([{ name: 'Воронка', data: [
    ['Дата', 'Артикул продавца', 'Показы', 'Заказы'],
    ['bad-date', 'A', 'wrong', -1],
  ] }], 'wb_funnel');
  assert.deepEqual(workbook.presentMetricFields, ['impressions', 'orders']);
  assert.equal(workbook.rows[0].impressions, 'wrong');
  assert.equal(workbook.rows[0].orders, -1);
  assert.equal('clicks' in workbook.rows[0], false);
  assert.equal('ordered_amount' in workbook.rows[0], false);
  assert.deepEqual(splitFunnelRows([1, 2, 3], 2), [[1, 2], [3]]);
});

test('recognizes the current WB funnel export layout and keeps cabinet prefixes', () => {
  const workbook = extractFunnelWorkbook([{ name: 'Лист1', data: [
    ['Артикул продавца', 'Артикул WB', 'Название', 'Предмет', 'Бренд', 'Ярлыки', 'Удаленный товар', 'Рейтинг карточки', 'Рейтинг по отзывам', 'Дата', 'Показы', 'CTR', 'Переходы в карточку', 'Положили в корзину', 'Добавили в отложенные', 'Заказали товаров, шт', 'Выкупили, шт', 'Отменили, шт', 'Конверсия в корзину, %', 'Конверсия в заказ, %', 'Процент выкупа', 'Заказали на сумму, ₽', 'Выкупили на сумму, ₽', 'Отменили на сумму, ₽'],
    ['39024', 222906909, 'Люстра потолочная', 'Люстры', 'LEDCITY', '', '', '', '', '2026-09-01', 109383, 4, 4611, 622, 85, 140, 129, 11, 13, 23, 92, 251859, 232070, 19789],
    ['50001', 494674743, '', '', '', '', '', '', '', '2026-09-24', 100, 2, 2, 1, 0, 1, 0, 0, 50, 100, 0, 1000, 0, 0],
  ] }], 'wb_funnel');
  assert.equal(workbook.inputRows, 2);
  assert.equal(workbook.dateStart, '2026-09-01');
  assert.equal(workbook.dateEnd, '2026-09-24');
  assert.deepEqual(workbook.presentMetricFields, ['impressions', 'clicks', 'carts', 'orders', 'ordered_amount']);
  assert.deepEqual(workbook.rows.map(row => row.seller_sku), ['39024', '50001']);
  assert.equal(workbook.rows[0].orders, 140);
  assert.equal(workbook.rows[0].ordered_amount, 251859);
  assert.deepEqual([workbook.rows[0].product_name, workbook.rows[0].category_name, workbook.rows[0].brand_name], ['Люстра потолочная', 'Люстры', 'LEDCITY']);
});

test('recognizes the current wide XWay export with a leading index column', () => {
  const workbook = extractFunnelWorkbook([{ name: 'Лист1', data: [
    ['', 'Дата', 'id', 'Название', 'Артикул WB', 'Артикул продавца', 'Группа', 'Теги', 'Бренд', 'Категория', 'Общее количество заказов', 'Общая сумма заказов', 'Текущий остаток товара', 'Цена со скидкой, руб.', 'Цена с СПП, руб.', 'СПП, %', 'Активных РК', 'Бюджет на РК', 'Показы', 'Клики', 'Корзины', 'Заказы, шт', 'Стоимость корзины, руб.', 'Заказы, руб', 'Факт. CPM, руб.', 'CPC, руб.', 'CPO, руб.', 'CTR, %', 'Клик → Корзина, %', 'Корзина → Заказ, %', 'Показы → Корзина, %', 'Показы → Заказ, %', 'Клик → Заказ, %', 'Расход, руб.'],
    [0, '2026-09-01 00:00:00', 494025, '', 496466378, '50193', '', '', '', '', '', '', '', '', '', '', '', '', 1000, 50, 4, 2, '', 3000, '', '', '', '', '', '', '', '', '', '5 033,35'],
  ] }], 'xway');
  assert.deepEqual(workbook.presentMetricFields, ['ad_impressions', 'ad_clicks', 'ad_orders_qty', 'ad_ordered_amount', 'ad_spend']);
  assert.equal(workbook.rows[0].seller_sku, '50193');
  assert.equal(workbook.rows[0].ad_spend, 5033.35);
  assert.equal(workbook.rows[0].date, '2026-09-01');
});
