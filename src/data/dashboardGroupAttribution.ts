import type { DailyMetrics, GroupMembership, GroupMembershipHistory } from '../types/index.ts';
import { resolveGroupAtDate, UNGROUPED_GROUP_ID } from './groupMembershipHistory.ts';

type CanonicalProductIds = ReadonlyMap<string, string>;

function sourcePriority(source: GroupMembershipHistory['source']) {
  if (source === 'import') return 2;
  if (source === 'legacy') return 1;
  return 0;
}

export function canonicalizeDashboardGroupData(
  history: GroupMembershipHistory[],
  memberships: GroupMembership[],
  canonicalProductIdByProductId: CanonicalProductIds,
): { history: GroupMembershipHistory[]; memberships: GroupMembership[] } {
  const historyCandidates = new Map<string, Array<{ row: GroupMembershipHistory; originalProductId: string }>>();
  for (const row of history) {
    const canonicalProductId = canonicalProductIdByProductId.get(row.product_id) || row.product_id;
    const key = `${row.date}|${canonicalProductId}`;
    const candidates = historyCandidates.get(key) || [];
    candidates.push({ row: { ...row, product_id: canonicalProductId }, originalProductId: row.product_id });
    historyCandidates.set(key, candidates);
  }

  const canonicalHistory = [...historyCandidates.values()].map(candidates => candidates.sort((left, right) => {
    const canonicalProductId = left.row.product_id;
    const leftCanonical = Number(left.originalProductId === canonicalProductId);
    const rightCanonical = Number(right.originalProductId === canonicalProductId);
    return rightCanonical - leftCanonical
      || sourcePriority(right.row.source) - sourcePriority(left.row.source)
      || left.originalProductId.localeCompare(right.originalProductId);
  })[0].row).sort((left, right) => left.date.localeCompare(right.date) || left.product_id.localeCompare(right.product_id));

  const membershipCandidates = new Map<string, Array<{ row: GroupMembership; originalProductId: string }>>();
  for (const row of memberships) {
    const canonicalProductId = canonicalProductIdByProductId.get(row.product_id) || row.product_id;
    const candidates = membershipCandidates.get(canonicalProductId) || [];
    candidates.push({ row: { ...row, product_id: canonicalProductId }, originalProductId: row.product_id });
    membershipCandidates.set(canonicalProductId, candidates);
  }

  const canonicalMemberships = [...membershipCandidates.entries()].map(([canonicalProductId, candidates]) => candidates.sort((left, right) => {
    const leftCanonical = Number(left.originalProductId === canonicalProductId);
    const rightCanonical = Number(right.originalProductId === canonicalProductId);
    return rightCanonical - leftCanonical || left.originalProductId.localeCompare(right.originalProductId);
  })[0].row).sort((left, right) => left.product_id.localeCompare(right.product_id));

  return { history: canonicalHistory, memberships: canonicalMemberships };
}

export function getDashboardGroupIdsForLinkedProduct(
  canonicalProductId: string,
  relatedProductIds: Iterable<string>,
  metrics: Array<Pick<DailyMetrics, 'date' | 'product_id'>>,
  start: string,
  end: string,
  history: GroupMembershipHistory[],
  memberships: GroupMembership[],
): Set<string> {
  if (!history.length) {
    return new Set(memberships
      .filter(item => item.product_id === canonicalProductId)
      .map(item => item.group_id || UNGROUPED_GROUP_ID));
  }

  const linkedIds = new Set(relatedProductIds);
  const dates = new Set(metrics
    .filter(row => linkedIds.has(row.product_id) && row.date >= start && row.date <= end)
    .map(row => row.date));
  const groupIds = new Set<string>();
  for (const date of dates) {
    const resolution = resolveGroupAtDate(canonicalProductId, date, history, memberships);
    if (resolution.known && resolution.groupId) groupIds.add(resolution.groupId);
  }
  return groupIds;
}
