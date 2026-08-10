export interface FunnelMetricRow {
  impressions: number;
  clicks: number;
  carts: number;
  orders: number;
  ordered_amount: number;
}

export function aggregateFunnel(rows: FunnelMetricRow[]) {
  let impressions = 0; let clicks = 0; let carts = 0; let orders = 0; let ordered_amount = 0;
  for (const row of rows) {
    impressions += row.impressions; clicks += row.clicks; carts += row.carts; orders += row.orders; ordered_amount += row.ordered_amount;
  }
  return {
    impressions, clicks, carts, orders, ordered_amount,
    ctr: impressions ? clicks / impressions * 100 : 0,
    cartCr: clicks ? carts / clicks * 100 : 0,
    cartOrderCr: carts ? orders / carts * 100 : 0,
    clickOrderCr: clicks ? orders / clicks * 100 : 0,
    impressionOrderCr: impressions ? orders / impressions * 100 : 0,
    avgPrice: orders ? ordered_amount / orders : 0,
  };
}
