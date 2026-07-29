import type { GroupMembership, Product } from '../types';
import { UNGROUPED_GROUP_ID } from './store';

export interface ProductFilterValues {
  cabinetFilter?: string;
  categoryFilter?: string;
  brandFilter?: string;
  groupFilter?: string;
  skuFilter?: string;
}

export function getFilteredProductIds(
  products: Product[],
  memberships: GroupMembership[],
  filters: ProductFilterValues,
): Set<string> {
  const groupProductIds = filters.groupFilter
    ? new Set(
        memberships
          .filter(membership => membership.group_id === filters.groupFilter)
          .map(membership => membership.product_id),
      )
    : null;

  return new Set(
    products
      .filter(product => !filters.cabinetFilter || product.cabinet_id === filters.cabinetFilter)
      .filter(product => !filters.categoryFilter || (product.category || 'Без категории') === filters.categoryFilter)
      .filter(product => !filters.brandFilter || product.brand_id === filters.brandFilter)
      .filter(product => !filters.skuFilter || product.sku === filters.skuFilter)
      .filter(product => !groupProductIds || groupProductIds.has(product.id))
      .map(product => product.id),
  );
}

export function hasProductFilters(filters: ProductFilterValues): boolean {
  return Boolean(
    filters.cabinetFilter
      || filters.categoryFilter
      || filters.brandFilter
      || filters.groupFilter
      || filters.skuFilter,
  );
}

export function isUngroupedFilter(groupFilter?: string): boolean {
  return groupFilter === UNGROUPED_GROUP_ID;
}
