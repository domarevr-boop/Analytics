import type { TableRow } from '../types';

export function sortDashboardSiblingsByOrders(rows: TableRow[]): TableRow[] {
  return [...rows].sort((left, right) =>
    right.current.fact_orders - left.current.fact_orders
    || right.current.orders - left.current.orders
    || left.name.localeCompare(right.name, 'ru'),
  );
}
