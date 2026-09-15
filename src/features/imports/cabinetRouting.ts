import type { V5DirectoryDimension } from '../directory/directoryDataCore';

type RoutablePayload = Record<string, unknown>;

export interface CabinetImportRoute {
  cabinet: V5DirectoryDimension;
  rowIndexes: number[];
}

export interface CabinetRoutingPlan {
  routes: CabinetImportRoute[];
  unresolvedRowIndexes: number[];
  unavailableCabinetNames: string[];
}

interface RoutableWorkbook<Row extends RoutablePayload = RoutablePayload> {
  rows: Row[];
  sourceRowNumbers: number[];
  inputRows: number;
  dateStart: string;
  dateEnd: string;
}

const CABINET_RULES = [
  { prefixes: ['3', '4'], externalKey: 'cab-1', name: 'Светпланет' },
  { prefixes: ['5'], externalKey: 'cab-2', name: 'Ледситипро' },
] as const;

function normalized(value: unknown): string {
  return String(value ?? '').replace(/\u00a0/gu, ' ').trim().toLocaleLowerCase('ru-RU');
}

function cabinetForRule(
  cabinets: V5DirectoryDimension[],
  rule: (typeof CABINET_RULES)[number],
): V5DirectoryDimension | undefined {
  return cabinets.find(cabinet => cabinet.externalKey === rule.externalKey)
    || cabinets.find(cabinet => normalized(cabinet.name) === normalized(rule.name));
}

export function buildCabinetRoutingPlan(
  rows: RoutablePayload[],
  cabinets: V5DirectoryDimension[],
): CabinetRoutingPlan {
  const routesByCabinet = new Map<string, CabinetImportRoute>();
  const unresolvedRowIndexes: number[] = [];
  const unavailableCabinetNames = new Set<string>();

  rows.forEach((row, rowIndex) => {
    const sellerSku = normalized(row.seller_sku).replace(/\.0+$/u, '');
    const rule = CABINET_RULES.find(candidate => candidate.prefixes.some(prefix => sellerSku.startsWith(prefix)));
    if (!rule) {
      unresolvedRowIndexes.push(rowIndex);
      return;
    }
    const cabinet = cabinetForRule(cabinets, rule);
    if (!cabinet) {
      unavailableCabinetNames.add(rule.name);
      return;
    }
    const route = routesByCabinet.get(cabinet.id) || { cabinet, rowIndexes: [] };
    route.rowIndexes.push(rowIndex);
    routesByCabinet.set(cabinet.id, route);
  });

  return {
    routes: [...routesByCabinet.values()],
    unresolvedRowIndexes,
    unavailableCabinetNames: [...unavailableCabinetNames],
  };
}

export function cabinetRoutingError(
  plan: CabinetRoutingPlan,
  sourceRowNumbers: number[],
): string {
  if (plan.unavailableCabinetNames.length) {
    return `В справочнике V5 нет активных кабинетов: ${plan.unavailableCabinetNames.join(', ')}.`;
  }
  if (plan.unresolvedRowIndexes.length) {
    const rows = plan.unresolvedRowIndexes
      .slice(0, 5)
      .map(index => sourceRowNumbers[index] || index + 2)
      .join(', ');
    const suffix = plan.unresolvedRowIndexes.length > 5 ? '…' : '';
    return `Не удалось определить кабинет для ${plan.unresolvedRowIndexes.length} строк: артикул продавца должен начинаться с 3, 4 или 5 (строки ${rows}${suffix}).`;
  }
  if (!plan.routes.length) return 'В файле нет строк, которые можно распределить по кабинетам.';
  return '';
}

export function subsetWorkbookByCabinet<T extends RoutableWorkbook>(
  workbook: T,
  rowIndexes: number[],
): T {
  const rows = rowIndexes.map(index => workbook.rows[index]);
  const sourceRowNumbers = rowIndexes.map(index => workbook.sourceRowNumbers[index] || index + 2);
  const dates = rows
    .map(row => String(row.date ?? ''))
    .filter(value => /^\d{4}-\d{2}-\d{2}$/u.test(value))
    .sort();
  const subset: RoutableWorkbook & Record<string, unknown> = {
    ...workbook,
    rows,
    sourceRowNumbers,
    inputRows: rows.length,
    dateStart: dates[0] || '',
    dateEnd: dates.at(-1) || dates[0] || '',
  };
  if ('aggregatedRows' in subset) subset.aggregatedRows = 0;
  if ('replacedDuplicateRows' in subset) subset.replacedDuplicateRows = 0;
  return subset as T;
}

export function cabinetRoutingSummary(plan: CabinetRoutingPlan): string {
  return plan.routes
    .map(route => `${route.cabinet.name}: ${route.rowIndexes.length.toLocaleString('ru-RU')}`)
    .join(' · ');
}
