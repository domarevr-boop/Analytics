import { getAggregatePlans, getMonthlyPlans, getPreferAggregatePlan, getProducts } from './store';
import { resolveEffectivePlanMetrics, type PlanScopeFilter } from './planningSelectors';

export function getEffectivePlanMetrics(month: string, filter: PlanScopeFilter = {}) {
  return resolveEffectivePlanMetrics(
    getPreferAggregatePlan(),
    getAggregatePlans(),
    getMonthlyPlans(),
    getProducts(),
    month,
    filter,
  );
}
