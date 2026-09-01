import type { AggregateMonthlyPlanRecord, MonthlyPlanRecord, Product } from '../types';
import { aggregatePlanMetrics, calculateAggregatePlan, type AggregatePlanMetrics } from './planningCalculations.ts';

export interface PlanScopeFilter {
  cabinetId?: string;
  category?: string;
  brandId?: string;
}

function emptyPlan(month: string): AggregatePlanMetrics {
  return aggregatePlanMetrics([], month);
}

export function selectAggregatePlanMetrics(
  records: AggregateMonthlyPlanRecord[],
  month: string,
  filter: PlanScopeFilter = {},
  kind: AggregateMonthlyPlanRecord['kind'] = 'fixed',
): AggregatePlanMetrics {
  const monthRecords = records.filter(record => record.month === month && record.kind === kind);
  const selected = filter.brandId
    ? monthRecords.filter(record => record.scope === 'brand' && record.entity_id === filter.brandId)
    : monthRecords.filter(record =>
      record.scope === 'category'
      && (!filter.cabinetId || record.cabinet_id === filter.cabinetId)
      && (!filter.category || record.entity_name === filter.category)
    );
  return aggregatePlanMetrics(selected.map(calculateAggregatePlan), month);
}

export function selectLegacyPlanMetrics(
  plans: MonthlyPlanRecord[],
  products: Product[],
  month: string,
  filter: PlanScopeFilter = {},
): AggregatePlanMetrics {
  const productBySku = new Map(products.map(product => [product.sku, product]));
  const selected = plans.filter(plan => {
    if (plan.month !== month) return false;
    const product = productBySku.get(plan.sku);
    if (!product) return false;
    if (filter.cabinetId && product.cabinet_id !== filter.cabinetId) return false;
    if (filter.category && (product.category || 'Без категории') !== filter.category) return false;
    if (filter.brandId && product.brand_id !== filter.brandId) return false;
    return true;
  });
  if (selected.length === 0) return emptyPlan(month);
  return aggregatePlanMetrics(selected.map(plan => calculateAggregatePlan({
    id: `legacy|${plan.month}|${plan.sku}`,
    kind: 'fixed',
    month: plan.month,
    scope: 'category',
    cabinet_id: productBySku.get(plan.sku)?.cabinet_id || '',
    entity_id: productBySku.get(plan.sku)?.category || 'Без категории',
    entity_name: productBySku.get(plan.sku)?.category || 'Без категории',
    orders_sum: plan.totalRubles || null,
    avg_qty_per_day: plan.avgQtyPerDay,
    avg_check: plan.checkAmount,
    buyout_rate: plan.buyoutRate,
    payout_rate: null,
    profitability: plan.profitability,
    updated_at: '',
  })), month);
}

export function resolveEffectivePlanMetrics(
  preferAggregate: boolean,
  aggregateRecords: AggregateMonthlyPlanRecord[],
  legacyPlans: MonthlyPlanRecord[],
  products: Product[],
  month: string,
  filter: PlanScopeFilter = {},
): AggregatePlanMetrics {
  return preferAggregate
    ? selectAggregatePlanMetrics(aggregateRecords, month, filter, 'fixed')
    : selectLegacyPlanMetrics(legacyPlans, products, month, filter);
}
