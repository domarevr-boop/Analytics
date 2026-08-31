import { useMemo, useSyncExternalStore } from 'react';
import { getGroupMembershipHistory, getMemberships, getMetrics, getProducts, getVersion, subscribe } from '../data/store';
import { getFilteredProductIds } from '../data/productFilters';
import { groupMatchesAtDate } from '../data/groupMembershipHistory';
import type { ChartDataPoint } from '../hooks/useChartData';
import MiniCharts from './MiniCharts';

interface MiniChartsBlockProps {
  data: ChartDataPoint[];
  periodStart: string;
  periodEnd: string;
  cabinetFilter?: string;
  categoryFilter?: string;
  brandFilter?: string;
  groupFilter?: string;
  skuFilter?: string;
}

export default function MiniChartsBlock({
  data,
  periodStart,
  periodEnd,
  cabinetFilter,
  categoryFilter,
  brandFilter,
  groupFilter,
  skuFilter,
}: MiniChartsBlockProps) {
  const version = useSyncExternalStore(subscribe, getVersion);
  const categoryData = useMemo(() => {
    const products = getProducts();
    const memberships = getMemberships();
    const groupHistory = getGroupMembershipHistory();
    const productIds = getFilteredProductIds(products, memberships, {
      cabinetFilter,
      categoryFilter,
      brandFilter,
      groupFilter,
      skuFilter,
    }, { groupHistory, period: { start: periodStart, end: periodEnd } });
    const productById = new Map(products.map(product => [product.id, product]));
    const totals = new Map<string, number>();

    getMetrics().forEach(metric => {
      if (!productIds.has(metric.product_id) || metric.date < periodStart || metric.date > periodEnd) return;
      if (groupFilter && !groupMatchesAtDate(metric.product_id, metric.date, groupFilter, groupHistory, memberships)) return;
      const category = productById.get(metric.product_id)?.category || 'Без категории';
      totals.set(category, (totals.get(category) || 0) + metric.ordered_amount);
    });

    return [...totals.entries()]
      .map(([name, value]) => ({ name, value }))
      .filter(item => item.value > 0)
      .sort((left, right) => right.value - left.value)
      .slice(0, 6);
  }, [version, periodStart, periodEnd, cabinetFilter, categoryFilter, brandFilter, groupFilter, skuFilter]);

  return (
    <div className="mini-charts-block">
      <MiniCharts data={data} categoryData={categoryData} />
    </div>
  );
}
