export type AbcClass = 'A' | 'B' | 'C';
export type BusinessRole = 'tractor' | 'profit-generator' | 'non-liquid';

export interface ProfitabilityClassificationRow {
  id: string;
  groupId: string;
  revenue: number;
  netProfit: number;
  adSpend: number;
}

export interface ProfitabilityClassification {
  abc: `${AbcClass}${AbcClass}`;
  role: BusinessRole;
}

export interface HierarchyRow {
  id: string;
  parent: string | null;
}

function classifyByValue<T extends { id: string }>(rows: T[], valueOf: (row: T) => number): Map<string, AbcClass> {
  const result = new Map(rows.map(row => [row.id, 'C' as AbcClass]));
  const positive = rows
    .map(row => ({ row, value: Math.max(0, valueOf(row)) }))
    .filter(item => item.value > 0)
    .sort((left, right) => right.value - left.value || left.row.id.localeCompare(right.row.id));
  const total = positive.reduce((sum, item) => sum + item.value, 0);
  let cumulative = 0;

  positive.forEach(item => {
    const shareBefore = total ? cumulative / total : 1;
    result.set(item.row.id, shareBefore < 0.8 ? 'A' : shareBefore < 0.95 ? 'B' : 'C');
    cumulative += item.value;
  });
  return result;
}

export function classifyProfitabilityRows(rows: ProfitabilityClassificationRow[]): Map<string, ProfitabilityClassification> {
  const revenueAbc = classifyByValue(rows, row => row.revenue);
  const profitAbc = classifyByValue(rows, row => row.netProfit);
  const roleById = new Map<string, BusinessRole>();
  const rowsByGroup = new Map<string, ProfitabilityClassificationRow[]>();

  rows.forEach(row => {
    const group = rowsByGroup.get(row.groupId) || [];
    group.push(row);
    rowsByGroup.set(row.groupId, group);
  });

  rowsByGroup.forEach(groupRows => {
    const groupRevenueAbc = classifyByValue(groupRows, row => row.revenue);
    const groupProfitAbc = classifyByValue(groupRows, row => row.netProfit);
    const groupAdAbc = classifyByValue(groupRows, row => row.adSpend);

    groupRows.forEach(row => {
      const isTractor = groupRevenueAbc.get(row.id) === 'A'
        && groupProfitAbc.get(row.id) === 'C'
        && groupAdAbc.get(row.id) === 'A';
      const isProfitGenerator = row.netProfit > 0 && groupProfitAbc.get(row.id) === 'A';
      roleById.set(row.id, isTractor ? 'tractor' : isProfitGenerator ? 'profit-generator' : 'non-liquid');
    });
  });

  return new Map(rows.map(row => [row.id, {
    abc: `${revenueAbc.get(row.id) || 'C'}${profitAbc.get(row.id) || 'C'}`,
    role: roleById.get(row.id) || 'non-liquid',
  }]));
}

export function flattenExpandedHierarchy<T extends HierarchyRow>(
  rows: T[],
  expanded: Set<string>,
  compare: (left: T, right: T) => number,
): T[] {
  const children = new Map<string | null, T[]>();
  rows.forEach(row => {
    const siblings = children.get(row.parent) || [];
    siblings.push(row);
    children.set(row.parent, siblings);
  });

  const result: T[] = [];
  const visit = (parent: string | null) => {
    const siblings = [...(children.get(parent) || [])].sort(compare);
    siblings.forEach(row => {
      result.push(row);
      if (expanded.has(row.id)) visit(row.id);
    });
  };
  visit(null);
  return result;
}
