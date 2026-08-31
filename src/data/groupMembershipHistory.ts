import type { GroupMembership, GroupMembershipHistory, Product } from '../types';

export const UNGROUPED_GROUP_ID = 'grp-ungrouped';

export interface GroupResolution {
  groupId: string | null;
  known: boolean;
  effectiveDate?: string;
}

interface GroupHistoryResolver {
  resolve(productId: string, date: string): GroupResolution;
}

const resolverCache = new WeakMap<GroupMembershipHistory[], GroupHistoryResolver>();

function createResolver(history: GroupMembershipHistory[], legacyMemberships: GroupMembership[]): GroupHistoryResolver {
  const rowsByProduct = new Map<string, GroupMembershipHistory[]>();
  for (const row of history) {
    const rows = rowsByProduct.get(row.product_id) || [];
    rows.push(row);
    rowsByProduct.set(row.product_id, rows);
  }
  rowsByProduct.forEach(rows => rows.sort((left, right) => left.date.localeCompare(right.date)));

  return {
    resolve(productId, date) {
      const rows = rowsByProduct.get(productId) || [];
      let low = 0;
      let high = rows.length - 1;
      let latestIndex = -1;
      while (low <= high) {
        const middle = Math.floor((low + high) / 2);
        if (rows[middle].date <= date) {
          latestIndex = middle;
          low = middle + 1;
        } else {
          high = middle - 1;
        }
      }
      if (latestIndex >= 0) {
        const latest = rows[latestIndex];
        return { groupId: latest.group_id, known: true, effectiveDate: latest.date };
      }

      // Before the first historical import, preserve the old current-only behavior
      // only when no historical data exists at all. This avoids inventing history.
      if (history.length === 0) {
        const legacy = legacyMemberships.find(row => row.product_id === productId);
        if (legacy) return { groupId: legacy.group_id, known: true };
      }
      return { groupId: null, known: false };
    },
  };
}

function getResolver(history: GroupMembershipHistory[], legacyMemberships: GroupMembership[]): GroupHistoryResolver {
  if (history.length === 0) return createResolver(history, legacyMemberships);
  const cached = resolverCache.get(history);
  if (cached) return cached;
  const resolver = createResolver(history, legacyMemberships);
  resolverCache.set(history, resolver);
  return resolver;
}

export function resolveGroupAtDate(
  productId: string,
  date: string,
  history: GroupMembershipHistory[],
  legacyMemberships: GroupMembership[] = [],
): GroupResolution {
  return getResolver(history, legacyMemberships).resolve(productId, date);
}

export function groupMatchesAtDate(
  productId: string,
  date: string,
  groupId: string,
  history: GroupMembershipHistory[],
  legacyMemberships: GroupMembership[] = [],
): boolean {
  const resolved = resolveGroupAtDate(productId, date, history, legacyMemberships);
  return resolved.known && resolved.groupId === groupId;
}

export function productHasGroupInPeriod(
  productId: string,
  start: string,
  end: string,
  groupId: string,
  history: GroupMembershipHistory[],
  legacyMemberships: GroupMembership[] = [],
): boolean {
  if (!start || !end) return groupMatchesAtDate(productId, end || start, groupId, history, legacyMemberships);
  const dates = [...new Set(history
    .filter(row => row.product_id === productId && row.date >= start && row.date <= end)
    .map(row => row.date))].sort();
  dates.unshift(start);
  dates.push(end);
  return dates.some(date => groupMatchesAtDate(productId, date, groupId, history, legacyMemberships));
}

export function groupsActiveInPeriod(
  products: Product[],
  start: string,
  end: string,
  history: GroupMembershipHistory[],
  legacyMemberships: GroupMembership[] = [],
): Set<string> {
  const result = new Set<string>();
  const latestHistoryDate = [...history].sort((left, right) => right.date.localeCompare(left.date))[0]?.date || '';
  const effectiveStart = start || latestHistoryDate;
  const effectiveEnd = end || effectiveStart;
  for (const product of products) {
    const dates = [...new Set(history
      .filter(row => row.product_id === product.id && row.date >= effectiveStart && row.date <= effectiveEnd)
      .map(row => row.date))].sort();
    dates.unshift(effectiveStart);
    dates.push(effectiveEnd);
    for (const date of dates) {
      const resolution = resolveGroupAtDate(product.id, date, history, legacyMemberships);
      if (resolution.known && resolution.groupId) result.add(resolution.groupId);
    }
  }
  return result;
}

export function groupTransitionCount(
  productIds: Set<string>,
  start: string,
  end: string,
  history: GroupMembershipHistory[],
): number {
  return new Set(history
    .filter(row => productIds.has(row.product_id) && row.date > start && row.date <= end)
    .map(row => row.product_id)).size;
}
