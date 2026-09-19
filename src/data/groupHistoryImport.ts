import { normalizeImportDate } from './dateUtils.ts';

const MASS_CHANGE_RATE = 0.15;
const MASS_CHANGE_CONFIRMATION_RATE = 0.9;

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
  kind: 'mass_change';
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
  scopedProductIds: Set<string> = new Set(),
): T[] {
  return history.filter(row => {
    if (!incomingDates.has(row.date)) return true;
    if (scopedProductIds.has(row.product_id)) return false;
    const cabinetId = cabinetByProductId.get(row.product_id);
    return !cabinetId || !incomingCabinetIds.has(cabinetId);
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
    const sortedCabinetDates = [...availableDates].sort();
    for (let dateIndex = 0; dateIndex < sortedCabinetDates.length; dateIndex++) {
      const date = sortedCabinetDates[dateIndex];
      const snapshotRows = rowsBySnapshot.get(`${date}|${cabinetKey}`) || [];
      const state = new Map(snapshotRows.map(row => [row.identity, row.groupCode]));
      if (previousState) {
        const commonIdentities = [...state.keys()].filter(identity => previousState!.has(identity));
        const changedIdentities = commonIdentities.filter(identity => state.get(identity) !== previousState!.get(identity));
        const changedProducts = changedIdentities.length;
        const changeRate = commonIdentities.length > 0 ? changedProducts / commonIdentities.length : 0;
        if (
          commonIdentities.length > 0
          && changeRate > MASS_CHANGE_RATE
        ) {
          const nextDate = sortedCabinetDates[dateIndex + 1];
          const nextRows = nextDate ? rowsBySnapshot.get(`${nextDate}|${cabinetKey}`) || [] : [];
          const nextState = new Map(nextRows.map(row => [row.identity, row.groupCode]));
          const confirmedProducts = changedIdentities.filter(identity => nextState.get(identity) === state.get(identity)).length;
          const confirmedByNextSnapshot = changedProducts > 0
            && confirmedProducts / changedProducts >= MASS_CHANGE_CONFIRMATION_RATE;
          if (confirmedByNextSnapshot) {
            previousAcceptedDate = date;
            previousState = state;
            continue;
          }
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

  let rejectedCrossCabinetRows = 0;
  const rowsByGroupAndCabinet = new Map<string, Map<string, PreparedGroupHistoryRow[]>>();
  for (const row of rows) {
    if (!row.groupCode) continue;
    const byCabinet = rowsByGroupAndCabinet.get(row.groupCode) || new Map<string, PreparedGroupHistoryRow[]>();
    byCabinet.set(row.cabinetKey, [...(byCabinet.get(row.cabinetKey) || []), row]);
    rowsByGroupAndCabinet.set(row.groupCode, byCabinet);
  }
  for (const byCabinet of rowsByGroupAndCabinet.values()) {
    if (byCabinet.size < 2) continue;
    const orderedCabinets = [...byCabinet.entries()].sort((left, right) => right[1].length - left[1].length);
    if (orderedCabinets[0][1].length < 10) continue;
    for (const [, candidateRows] of orderedCabinets.slice(1)) {
      const identities = new Set(candidateRows.map(row => row.identity));
      const candidateDates = new Set(candidateRows.map(row => row.date));
      if (candidateRows.length !== 1 || identities.size !== 1 || candidateDates.size !== 1) continue;
      excludedRowIndexes.add(candidateRows[0].sourceIndex);
      rejectedCrossCabinetRows++;
    }
  }
  if (rejectedCrossCabinetRows > 0) {
    warnings.push(
      `Автоматически пропущено одиночных кодов склеек, массово относящихся к другому кабинету: ${rejectedCrossCabinetRows}.`,
    );
  }

  if (anomalies.length > 0) {
    warnings.push(
      `Резких изменений более 15% состава кабинета: ${anomalies.length}. `
      + (options.acceptAnomalies ? 'Они будут импортированы по подтверждению.' : 'По умолчанию эти срезы будут пропущены.'),
    );
  }

  const unknownCabinets = [...cabinetDates.keys()].filter(key => key === 'id:unknown');
  if (unknownCabinets.length > 0) {
    errors.push('Не удалось определить кабинет как минимум для одного товара. Добавьте колонку «Кабинет».');
  }

  for (const anomaly of anomalies) {
    warnings.push(
      `${anomaly.date}, ${issueLabel(anomaly.cabinetKey)}: изменилось ${anomaly.changedProducts} из `
      + `${anomaly.commonProducts} товаров (${Math.round((anomaly.changeRate || 0) * 1000) / 10}%).`,
    );
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
