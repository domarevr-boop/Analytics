import type { Cabinet, Brand, ProductGroup, GroupMembership, PlanRecord } from '../types';
import seedData from './seed.json';

interface SeedCabinetRule {
  skuPrefix: string;
  cabinetId: string;
}

interface SeedGroupRule {
  skus: string[];
  groupId: string;
}

interface SeedBrandRule {
  skus: string[];
  brandId: string;
}

export interface ClassificationRules {
  cabinetRules: { type: 'sku_prefix'; skuPrefix: string; cabinetId: string }[];
  groupRules: { type: 'exact'; skus: string[]; groupId: string }[];
  brandRules: { type: 'exact'; skus: string[]; brandId: string }[];
  defaultBrandId: string;
}

export interface SeedData {
  cabinets: Cabinet[];
  brands: Brand[];
  groups: ProductGroup[];
  classification: {
    cabinetRules: SeedCabinetRule[];
    groupRules: SeedGroupRule[];
    brandRules: SeedBrandRule[];
    defaultBrandId: string;
  };
}

export function loadSeed(): SeedData {
  return seedData as SeedData;
}

export function loadClassificationRules(): ClassificationRules {
  const s = loadSeed();
  const c = s.classification;
  return {
    cabinetRules: c.cabinetRules.map(r => ({ type: 'sku_prefix' as const, skuPrefix: r.skuPrefix, cabinetId: r.cabinetId })),
    groupRules: c.groupRules.map(r => ({ type: 'exact' as const, skus: r.skus, groupId: r.groupId })),
    brandRules: c.brandRules.map(r => ({ type: 'exact' as const, skus: r.skus, brandId: r.brandId })),
    defaultBrandId: c.defaultBrandId,
  };
}

export function getUngroupedGroupId(): string {
  return 'grp-ungrouped';
}

export function createSeedPlans(
  cabinets: Cabinet[],
  groups: ProductGroup[],
  products: { id: string; sku: string; name: string; cabinet_id: string }[],
  memberships: GroupMembership[],
): PlanRecord[] {
  const plans: PlanRecord[] = [];

  for (const c of cabinets) {
    plans.push({
      entityId: c.id, entityType: 'cabinet', parentId: null, name: c.name,
      ordersQty: 0, avgPrice: 0, ordersSum: 0, profitability: 0, netProfit: 0,
    });
  }
  for (const g of groups) {
    plans.push({
      entityId: g.id, entityType: 'group', parentId: g.cabinet_id || null, name: g.name,
      ordersQty: 0, avgPrice: 0, ordersSum: 0, profitability: 0, netProfit: 0,
    });
  }
  for (const pr of products) {
    const membership = memberships.find(m => m.product_id === pr.id);
    const parentId = membership ? membership.group_id : pr.cabinet_id || null;
    plans.push({
      entityId: pr.id, entityType: 'product',
      parentId,
      name: (pr.sku !== pr.name ? pr.sku + ' ' : '') + pr.name,
      ordersQty: 0, avgPrice: 0, ordersSum: 0,
      profitability: 25, netProfit: 0,
    });
  }

  return plans;
}
