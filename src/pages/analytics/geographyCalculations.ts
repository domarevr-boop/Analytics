import type { GeographyOrderRecord } from '../../types';

export type GeographyFulfillment = 'all' | 'fbo' | 'fbs';

export const geographyFulfillmentLabels: Record<GeographyFulfillment, string> = {
  all: 'Все заказы',
  fbo: 'FBO · Склад WB',
  fbs: 'FBS · Маркетплейс',
};

export function getFulfillmentOrders(record: GeographyOrderRecord, fulfillment: GeographyFulfillment) {
  if (fulfillment === 'fbo') return record.wb_local_orders + record.wb_nonlocal_orders;
  if (fulfillment === 'fbs') return record.marketplace_local_orders + record.marketplace_nonlocal_orders;
  return record.orders_total;
}

export function getFulfillmentStock(record: GeographyOrderRecord, fulfillment: GeographyFulfillment) {
  if (fulfillment === 'fbo') return record.stock_wb;
  if (fulfillment === 'fbs') return record.stock_marketplace;
  return record.stock_wb + record.stock_marketplace;
}

export function getFulfillmentCoverage(records: GeographyOrderRecord[]) {
  const total = records.reduce((sum, record) => sum + record.orders_total, 0);
  const fbo = records.reduce((sum, record) => sum + getFulfillmentOrders(record, 'fbo'), 0);
  const fbs = records.reduce((sum, record) => sum + getFulfillmentOrders(record, 'fbs'), 0);
  const distributed = fbo + fbs;
  return { total, fbo, fbs, distributed, residual: total - distributed, coverage: total > 0 ? distributed / total * 100 : null };
}

export function aggregateGeography(records: GeographyOrderRecord[], fulfillment: GeographyFulfillment) {
  const total = records.reduce((sum, record) => sum + getFulfillmentOrders(record, fulfillment), 0);
  const withDelivery = records.filter(record => record.delivery_hours !== null && getFulfillmentOrders(record, fulfillment) > 0);
  const coveredOrders = withDelivery.reduce((sum, record) => sum + getFulfillmentOrders(record, fulfillment), 0);
  const deliveryHours = coveredOrders > 0
    ? withDelivery.reduce((sum, record) => sum + (record.delivery_hours || 0) * getFulfillmentOrders(record, fulfillment), 0) / coveredOrders
    : null;
  const stock = records.reduce((sum, record) => sum + getFulfillmentStock(record, fulfillment), 0);
  return { total, deliveryHours, coveredOrders, stock };
}

export function orderShare(orders: number, denominator: number) {
  return denominator > 0 ? orders / denominator * 100 : 0;
}

export function toMillions(amount: number) {
  return amount / 1_000_000;
}

export function amountShare(amount: number, denominator: number) {
  return denominator > 0 ? amount / denominator * 100 : 0;
}

export function topFiveWithOther(rows: { name: string; value: number }[], denominator = rows.reduce((sum, row) => sum + row.value, 0)) {
  const top = [...rows].sort((left, right) => right.value - left.value).slice(0, 5);
  const topValue = top.reduce((sum, row) => sum + row.value, 0);
  const rest = Math.max(0, denominator - topValue);
  const result = rest > 0 ? [...top, { name: 'Остальные', value: rest }] : top;
  return result.map(row => ({ ...row, share: amountShare(row.value, denominator) }));
}
