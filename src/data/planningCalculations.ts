import type { AggregateMonthlyPlanRecord } from '../types';

export interface AggregatePlanMetrics {
  hasData: boolean;
  avgQtyPerDay: number | null;
  ordersQty: number | null;
  avgCheck: number | null;
  ordersSum: number | null;
  buyoutRate: number | null;
  buyoutAmount: number | null;
  payoutRate: number | null;
  payoutAmount: number | null;
  profitability: number | null;
  netProfit: number | null;
  ordersPerDay: number | null;
  netProfitPerDay: number | null;
  daysInMonth: number;
}

export type EditableAggregatePlanField = 'orders_sum' | 'avg_check' | 'buyout_rate' | 'payout_rate' | 'profitability';

export function patchAggregatePlanField(
  current: AggregateMonthlyPlanRecord | undefined,
  base: AggregateMonthlyPlanRecord,
  field: EditableAggregatePlanField,
  value: number | null,
  updatedAt: string,
): AggregateMonthlyPlanRecord {
  return { ...base, ...current, [field]: value, updated_at: updatedAt };
}

export function getDaysInPlanMonth(month: string): number {
  const [year, monthNumber] = month.split('-').map(Number);
  if (!year || !monthNumber || monthNumber < 1 || monthNumber > 12) return 0;
  return new Date(year, monthNumber, 0).getDate();
}

function multiply(value: number | null, rate: number | null): number | null {
  return value === null || rate === null ? null : value * rate / 100;
}

export function calculateAggregatePlan(record: AggregateMonthlyPlanRecord): AggregatePlanMetrics {
  const daysInMonth = getDaysInPlanMonth(record.month);
  const explicitOrdersSum = record.orders_sum ?? null;
  const hasData = [explicitOrdersSum, record.avg_qty_per_day, record.avg_check, record.buyout_rate, record.payout_rate, record.profitability]
    .some(value => value !== null);
  const plannedQuantity = record.avg_qty_per_day === null || daysInMonth === 0 ? null : record.avg_qty_per_day * daysInMonth;
  const ordersQty = explicitOrdersSum !== null && record.avg_check
    ? explicitOrdersSum / record.avg_check
    : plannedQuantity;
  const ordersSum = explicitOrdersSum ?? (ordersQty === null || record.avg_check === null ? null : ordersQty * record.avg_check);
  const avgCheck = ordersSum !== null && ordersQty ? ordersSum / ordersQty : record.avg_check;
  const avgQtyPerDay = ordersQty === null || daysInMonth === 0 ? record.avg_qty_per_day : ordersQty / daysInMonth;
  const buyoutAmount = multiply(ordersSum, record.buyout_rate);
  const payoutAmount = multiply(ordersSum, record.payout_rate);
  const netProfit = multiply(buyoutAmount, record.profitability);

  return {
    hasData,
    avgQtyPerDay,
    ordersQty,
    avgCheck,
    ordersSum,
    buyoutRate: record.buyout_rate,
    buyoutAmount,
    payoutRate: record.payout_rate,
    payoutAmount,
    profitability: record.profitability,
    netProfit,
    ordersPerDay: ordersSum === null || daysInMonth === 0 ? null : ordersSum / daysInMonth,
    netProfitPerDay: netProfit === null || daysInMonth === 0 ? null : netProfit / daysInMonth,
    daysInMonth,
  };
}

function sumKnown(values: Array<number | null>): number | null {
  const known = values.filter((value): value is number => value !== null);
  return known.length > 0 ? known.reduce((sum, value) => sum + value, 0) : null;
}

function weightedRate(amount: number | null, base: number | null): number | null {
  if (amount === null || base === null) return null;
  if (base === 0) return amount === 0 ? 0 : null;
  return amount / base * 100;
}

function weightedAverage(amount: number | null, quantity: number | null): number | null {
  if (amount === null || quantity === null) return null;
  if (quantity === 0) return amount === 0 ? 0 : null;
  return amount / quantity;
}

function weightedKnownRate(
  metrics: AggregatePlanMetrics[],
  value: (metric: AggregatePlanMetrics) => number | null,
  weight: (metric: AggregatePlanMetrics) => number | null,
): number | null {
  const known = metrics.filter(metric => value(metric) !== null);
  if (known.length === 0) return null;
  const weighted = known.filter(metric => (weight(metric) ?? 0) > 0);
  if (weighted.length > 0) {
    const totalWeight = weighted.reduce((sum, metric) => sum + (weight(metric) ?? 0), 0);
    return weighted.reduce((sum, metric) => sum + (value(metric) ?? 0) * (weight(metric) ?? 0), 0) / totalWeight;
  }
  return known.reduce((sum, metric) => sum + (value(metric) ?? 0), 0) / known.length;
}

export function aggregatePlanMetrics(metrics: AggregatePlanMetrics[], month: string): AggregatePlanMetrics {
  const daysInMonth = getDaysInPlanMonth(month);
  const populated = metrics.filter(metric => metric.hasData);
  if (populated.length === 0) {
    return {
      hasData: false,
      avgQtyPerDay: null,
      ordersQty: null,
      avgCheck: null,
      ordersSum: null,
      buyoutRate: null,
      buyoutAmount: null,
      payoutRate: null,
      payoutAmount: null,
      profitability: null,
      netProfit: null,
      ordersPerDay: null,
      netProfitPerDay: null,
      daysInMonth,
    };
  }

  const avgQtyPerDay = sumKnown(populated.map(metric => metric.avgQtyPerDay));
  const ordersQty = sumKnown(populated.map(metric => metric.ordersQty));
  const ordersSum = sumKnown(populated.map(metric => metric.ordersSum));
  const buyoutAmount = sumKnown(populated.map(metric => metric.buyoutAmount));
  const payoutAmount = sumKnown(populated.map(metric => metric.payoutAmount));
  const netProfit = sumKnown(populated.map(metric => metric.netProfit));

  return {
    hasData: true,
    avgQtyPerDay,
    ordersQty,
    avgCheck: weightedAverage(ordersSum, ordersQty),
    ordersSum,
    buyoutRate: weightedRate(buyoutAmount, ordersSum)
      ?? weightedKnownRate(populated, metric => metric.buyoutRate, metric => metric.ordersSum),
    buyoutAmount,
    payoutRate: weightedRate(payoutAmount, ordersSum)
      ?? weightedKnownRate(populated, metric => metric.payoutRate, metric => metric.ordersSum),
    payoutAmount,
    profitability: weightedRate(netProfit, buyoutAmount)
      ?? weightedKnownRate(populated, metric => metric.profitability, metric => metric.buyoutAmount ?? metric.ordersSum),
    netProfit,
    ordersPerDay: ordersSum === null || daysInMonth === 0 ? null : ordersSum / daysInMonth,
    netProfitPerDay: netProfit === null || daysInMonth === 0 ? null : netProfit / daysInMonth,
    daysInMonth,
  };
}

export function makeAggregatePlanId(
  kind: AggregateMonthlyPlanRecord['kind'],
  month: string,
  scope: AggregateMonthlyPlanRecord['scope'],
  cabinetId: string,
  entityId: string,
): string {
  return [kind, month, scope, cabinetId || 'all', entityId].join('|');
}
