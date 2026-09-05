import type { MarketDynamicsRecord } from '../types';

export function getMarketAverageCheck(record: MarketDynamicsRecord): number | null {
  if (record.market_avg_check > 0) return record.market_avg_check;
  if (record.market_orders > 0) return record.market_ordered_amount / record.market_orders;
  return null;
}

export function getComparableChange(current: number, previous: number): number | null {
  return previous > 0 ? (current - previous) / previous * 100 : null;
}

export function decomposeAmountShare(currentMarket: number, currentOwn: number, previousMarket: number, previousOwn: number) {
  const previousShare = previousMarket > 0 ? previousOwn / previousMarket * 100 : 0;
  const currentShare = currentMarket > 0 ? currentOwn / currentMarket * 100 : 0;
  if (currentMarket <= 0) return { previousShare, currentShare, marketEffect: 0, ownEffect: 0 };
  const counterfactualShare = previousOwn / currentMarket * 100;
  return {
    previousShare,
    currentShare,
    marketEffect: counterfactualShare - previousShare,
    ownEffect: currentShare - counterfactualShare,
  };
}
