import { normalizeImportDate } from './dateUtils.ts';

const MASS_CHANGE_MIN_COMMON_PRODUCTS = 20;
const MASS_CHANGE_MIN_PRODUCTS = 20;
const MASS_CHANGE_RATE = 0.15;

export interface PreparedGroupHistoryRow {
  sourceIndex: number;
  date: string;
  sku: string;
  wbSku: string;
  groupCode: string;
  cabinetName: string;
  inferredCabinetId: string;
  cabinetKey: string;
  identity: string;
}

export interface GroupHistorySnapshotAnomaly {
  kind: 'mass_change' | 'cross_cabinet_singleton';
  date: string;
  cabinetKey: string;
  previousDate?: string;
  groupCode?: string;
  commonProducts?: number;
  changedProducts?: number;
  changeRate?: number;
  rowIndexes: number[];
}

export interface MissingGroupHistorySnapshot {
  date: string;
  cabinetKey: string;
}

export interface GroupHistoryImportAnalysis {
  rows: PreparedGroupHistoryRow[];
  acceptedRows: PreparedGroupHistoryRow[];
  anomalies: GroupHistorySnapshotAnomaly[];
  missingSnapshots: MissingGroupHistorySnapshot[];
  errors: string[];
  warnings: string[];
  excludedRowIndexes: Set<number>;
  unsafeSellerKeys: Set<string>;
  unsafeWbKeys: Set<string>;
}

export interface GroupHistoryImportOptions {
  acceptAnomalies?: boolean;
  inferCabinetId?: (identity: string) => string;
}

export function removeReplacedGroupHistorySnapshots<T extends { date: string; product_id: string }>(
  history: T[],
  cabinetByProductId: Map<string, string>,
  incomingDates: Set<string>,
  incomingCabinetIds: Set<string>,
): T[] {
  return history.filter(row => {
    const cabinetId = cabinetByProductId.get(row.product_id);
    return !cabinetId || !incomingDates.has(row.date) || !incomingCabinetIds.has(cabinetId);
  });
}

export function normalizeGroupHistoryIdentifier(value: unknown): string {
  return String(value ?? '')
    .replace(/\u00a0/g, ' ')
    .trim()
    .replace(/\.0+$/, '');
}

function normalizedCabinetName(value: unknown): string {
  return String(value ?? '').trim().toLocaleLowerCase('ru-RU');
}

function prepareRows(
  rows: Record<string, string>[],
  dateOverride?: string,
  dateYearOverride?: number,
  inferCabinetId: (identity: string) => string = () => '',
): PreparedGroupHistoryRow[] {
  const prepared: PreparedGroupHistoryRow[] = [];
  rows.forEach((row, sourceIndex) => {
    const date = normalizeImportDate(dateOverride || row.date, dateYearOverride);
    const sku = normalizeGroupHistoryIdentifier(row.sku);
    const wbSku = normalizeGroupHistoryIdentifier(row.wb_sku);
    const identityValue = sku || wbSku;
    if (!date || !identityValue) return;
    const cabinetName = String(row.cabinet || '').trim();
    const inferredCabinetId = cabinetName ? '' : inferCabinetId(identityValue);
    const cabinetKey = cabinetName
      ? `name:${normalizedCabinetName(cabinetName)}`
      : `id:${inferredCabinetId || 'unknown'}`;
    prepared.push({
      sourceIndex,
      date,
      sku,
      wbSku,
      groupCode: String(row.group_code || '').trim(),
      cabinetName,
      inferredCabinetId,
      cabinetKey,
      identity: sku ? `sku:${sku}` : `wb:${wbSku}`,
    });
  });
  return prepared;
}

function issueLabel(cabinetKey: string): string {
  if (cabinetKey.startsWith('name:')) return cabinetKey.slice(5);
  if (cabinetKey === 'id:unknown') return 'кабинет не определён';
  return cabinetKey.slice(3);
}

export function analyzeGroupHistoryImport(
  sourceRows: Record<string, string>[],
  dateOverride?: string,
  dateYearOverride?: number,
  options: GroupHistoryImportOptions = {},
): GroupHistoryImportAnalysis {
  const rows = prepareRows(sourceRows, dateOverride, dateYearOverride, options.inferCabinetId);
  const errors: string[] = [];
  const warnings: string[] = [];
  const anomalies: GroupHistorySnapshotAnomaly[] = [];
  const excludedRowIndexes = new Set<number>();

  const rowsBySnapshot = new Map<string, PreparedGroupHistoryRow[]>();
  const dates = new Set<string>();
  const cabinetDates = new Map<string, Set<string>>();
  const duplicateRows = new Map<string, PreparedGroupHistoryRow[]>();
  const wbToSellerKeys = new Map<string, Set<string>>();
  const sellerToWbKeys = new Map<string, Set<string>>();

  if (sourceRows.length > 0 && sourceRows.every(row => !Object.hasOwn(row, 'group_code'))) {
    errors.push('Отсутствует колонка «Склейка» или «Код склейки».');
  }

  for (const row of rows) {
    const snapshotKey = `${row.date}|${row.cabinetKey}`;
    rowsBySnapshot.set(snapshotKey, [...(rowsBySnapshot.get(snapshotKey) || []), row]);
    dates.add(row.date);
    const datesForCabinet = cabinetDates.get(row.cabinetKey) || new Set<string>();
    datesForCabinet.add(row.date);
    cabinetDates.set(row.cabinetKey, datesForCabinet);

    const duplicateKey = `${snapshotKey}|${row.identity}`;
    duplicateRows.set(duplicateKey, [...(duplicateRows.get(duplicateKey) || []), row]);

    if (row.sku && row.wbSku) {
      const sellerKey = `${row.cabinetKey}|${row.sku}`;
      const wbKey = `${row.cabinetKey}|${row.wbSku}`;
      const sellers = wbToSellerKeys.get(wbKey) || new Set<string>();
      sellers.add(sellerKey);
      wbToSellerKeys.set(wbKey, sellers);
      const wbIds = sellerToWbKeys.get(sellerKey) || new Set<string>();
      wbIds.add(wbKey);
      sellerToWbKeys.set(sellerKey, wbIds);
    }
  }

  const duplicateKeys = [...duplicateRows.entries()].filter(([, duplicate]) => duplicate.length > 1);
  if (duplicateKeys.length > 0) {
    errors.push(`Повторяется ключ «дата + кабинет + товар» в ${duplicateKeys.length} случаях.`);
  }

  const unsafeSellerKeys = new Set(
    [...sellerToWbKeys.entries()].filter(([, wbIds]) => wbIds.size > 1).map(([sellerKey]) => sellerKey),
  );
  const unsafeWbKeys = new Set(
    [...wbToSellerKeys.entries()].filter(([, sellers]) => sellers.size > 1).map(([wbKey]) => wbKey),
  );
  if (unsafeSellerKeys.size > 0 || unsafeWbKeys.size > 0) {
    warnings.push(
      `Неоднозначные WB ID: ${unsafeSellerKeys.size} артикулов продавца имеют несколько WB ID, `
      + `${unsafeWbKeys.size} WB ID относятся к нескольким артикулам. Для этих строк используется только артикул продавца.`,
    );
  }

  const orderedDates = [...dates].sort();
  const missingSnapshots: MissingGroupHistorySnapshot[] = [];
  for (const [cabinetKey, availableDates] of cabinetDates) {
    const cabinetOrderedDates = [...availableDates].sort();
    const firstDate = cabinetOrderedDates[0];
    const lastDate = cabinetOrderedDates.at(-1);
    if (!firstDate || !lastDate) continue;
    for (const date of orderedDates) {
      if (date >= firstDate && date <= lastDate && !availableDates.has(date)) {
        missingSnapshots.push({ date, cabinetKey });
      }
    }
  }
  if (missingSnapshots.length > 0) {
    warnings.push(
      `Нет ${missingSnapshots.length} дневных срезов кабинетов; для них сохранится последнее известное состояние.`,
    );
  }

  if (rows.length > 0 && rows.every(row => !row.cabinetName) && cabinetDates.size > 1) {
    warnings.push('Колонка «Кабинет» отсутствует: кабинет определён по правилам артикула. Проверьте это распределение перед импортом.');
  }

  for (const [cabinetKey, availableDates] of cabinetDates) {
    let previousAcceptedDate = '';
    let previousState: Map<string, string> | null = null;
    for (const date of [...availableDates].sort()) {
      const snapshotRows = rowsBySnapshot.get(`${date}|${cabinetKey}`) || [];
      const state = new Map(snapshotRows.map(row => [row.identity, row.groupCode]));
      if (previousState) {
        const commonIdentities = [...state.keys()].filter(identity => previousState!.has(identity));
        const changedProducts = commonIdentities.filter(identity => state.get(identity) !== previousState!.get(identity)).length;
        const changeRate = commonIdentities.length > 0 ? changedProducts / commonIdentities.length : 0;
        if (
          commonIdentities.length >= MASS_CHANGE_MIN_COMMON_PRODUCTS
          && changedProducts >= MASS_CHANGE_MIN_PRODUCTS
          && changeRate >= MASS_CHANGE_RATE
        ) {
          const anomaly: GroupHistorySnapshotAnomaly = {
            kind: 'mass_change',
            date,
            cabinetKey,
            previousDate: previousAcceptedDate,
            commonProducts: commonIdentities.length,
            changedProducts,
            changeRate,
            rowIndexes: snapshotRows.map(row => row.sourceIndex),
          };
          anomalies.push(anomaly);
          if (!options.acceptAnomalies) {
            anomaly.rowIndexes.forEach(index => excludedRowIndexes.add(index));
            continue;
          }
        }
      }
      previousAcceptedDate = date;
      previousState = state;
    }
  }

  const rowsByGroupAndCabinet = new Map<string, Map<string, PreparedGroupHistoryRow[]>>();
  for (const row of rows) {
    if (!row.groupCode) continue;
    const byCabinet = rowsByGroupAndCabinet.get(row.groupCode) || new Map<string, PreparedGroupHistoryRow[]>();
    byCabinet.set(row.cabinetKey, [...(byCabinet.get(row.cabinetKey) || []), row]);
    rowsByGroupAndCabinet.set(row.groupCode, byCabinet);
  }
  for (const [groupCode, byCabinet] of rowsByGroupAndCabinet) {
    if (byCabinet.size < 2) continue;
    const orderedCabinets = [...byCabinet.entries()].sort((left, right) => right[1].length - left[1].length);
    const dominantRows = orderedCabinets[0][1];
    if (dominantRows.length < 10) continue;
    for (const [cabinetKey, candidateRows] of orderedCabinets.slice(1)) {
      const identities = new Set(candidateRows.map(row => row.identity));
      const candidateDates = new Set(candidateRows.map(row => row.date));
      if (candidateRows.length !== 1 || identities.size !== 1 || candidateDates.size !== 1) continue;
      const row = candidateRows[0];
      const anomaly: GroupHistorySnapshotAnomaly = {
        kind: 'cross_cabinet_singleton',
        date: row.date,
        cabinetKey,
        groupCode,
        rowIndexes: [row.sourceIndex],
      };
      anomalies.push(anomaly);
      if (!options.acceptAnomalies) excludedRowIndexes.add(row.sourceIndex);
    }
  }

  if (anomalies.length > 0) {
    const massChanges = anomalies.filter(issue => issue.kind === 'mass_change');
    const singletonGroups = anomalies.filter(issue => issue.kind === 'cross_cabinet_singleton');
    if (massChanges.length > 0) {
      warnings.push(
        `Обнаружено ${massChanges.length} массовых изменений состава. `
        + (options.acceptAnomalies ? 'Они будут импортированы по подтверждению.' : 'По умолчанию эти срезы будут пропущены.'),
      );
    }
    if (singletonGroups.length > 0) {
      warnings.push(
        `Обнаружено ${singletonGroups.length} одиночных появлений кода склейки из другого кабинета. `
        + (options.acceptAnomalies ? 'Они будут импортированы по подтверждению.' : 'По умолчанию эти строки будут пропущены.'),
      );
    }
  }

  const unknownCabinets = [...cabinetDates.keys()].filter(key => key === 'id:unknown');
  if (unknownCabinets.length > 0) {
    errors.push('Не удалось определить кабинет как минимум для одного товара. Добавьте колонку «Кабинет».');
  }

  for (const anomaly of anomalies) {
    if (anomaly.kind === 'mass_change') {
      warnings.push(
        `${anomaly.date}, ${issueLabel(anomaly.cabinetKey)}: изменилось ${anomaly.changedProducts} из `
        + `${anomaly.commonProducts} товаров (${Math.round((anomaly.changeRate || 0) * 1000) / 10}%).`,
      );
    } else {
      warnings.push(`${anomaly.date}, ${issueLabel(anomaly.cabinetKey)}: подозрительный одиночный код ${anomaly.groupCode}.`);
    }
  }

  const acceptedRows = rows.filter(row => !excludedRowIndexes.has(row.sourceIndex));
  if (rows.length > 0 && acceptedRows.length === 0) {
    errors.push('Все строки относятся к подозрительным срезам. Подтвердите изменения явно или исправьте файл.');
  }

  return {
    rows,
    acceptedRows,
    anomalies,
    missingSnapshots,
    errors,
    warnings,
    excludedRowIndexes,
    unsafeSellerKeys,
    unsafeWbKeys,
  };
}
