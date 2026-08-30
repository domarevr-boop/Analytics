import type { MarketDynamicsRecord } from '../types';

export function getMarketAverageCheck(record: MarketDynamicsRecord): number | null {
  if (record.market_avg_check > 0) return record.market_avg_check;
  if (record.market_orders > 0) return record.market_ordered_amount / record.market_orders;
  return null;
}

export function getComparableChange(current: number, previous: number): number | null {
  return previous > 0 ? (current - previous) / previous * 100 : null;
}
