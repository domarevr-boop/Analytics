import type { GeographyOrderRecord } from '../../types';

export type GeographyFulfillment = 'all' | 'fbo' | 'fbs';

export const geographyHeatColors = {
  low: '#D95D4F',
  middle: '#F2C94C',
  high: '#2F9E68',
} as const;

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
  return { total, deliveryHours, coveredOrders };
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

function parseHexColor(color: string) {
  return [1, 3, 5].map(index => Number.parseInt(color.slice(index, index + 2), 16));
}

function interpolateColor(from: string, to: string, ratio: number) {
  const start = parseHexColor(from);
  const end = parseHexColor(to);
  const channels = start.map((channel, index) => Math.round(channel + (end[index] - channel) * ratio));
  return `#${channels.map(channel => channel.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

export function geographyHeatColor(value: number, minimum: number, maximum: number, inverse = false) {
  if (!Number.isFinite(value)) return null;
  const normalized = maximum > minimum ? Math.min(1, Math.max(0, (value - minimum) / (maximum - minimum))) : 0.5;
  const ratio = inverse ? 1 - normalized : normalized;
  return ratio <= 0.5
    ? interpolateColor(geographyHeatColors.low, geographyHeatColors.middle, ratio * 2)
    : interpolateColor(geographyHeatColors.middle, geographyHeatColors.high, (ratio - 0.5) * 2);
}

export function topFiveWithOther(rows: { name: string; value: number }[], denominator = rows.reduce((sum, row) => sum + row.value, 0)) {
  const top = [...rows].sort((left, right) => right.value - left.value).slice(0, 5);
  const topValue = top.reduce((sum, row) => sum + row.value, 0);
  const rest = Math.max(0, denominator - topValue);
  const result = rest > 0 ? [...top, { name: 'Остальные', value: rest }] : top;
  return result.map(row => ({ ...row, share: amountShare(row.value, denominator) }));
}
