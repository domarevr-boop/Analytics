export const GEOGRAPHY_MAX_FILE_BYTES = 25 * 1024 * 1024;
export const GEOGRAPHY_MAX_ROWS = 250_000;
export const GEOGRAPHY_STAGE_CHUNK_SIZE = 500;

export type GeographyPayload = Record<string, string | number | null>;

export interface GeographySheetGrid {
  name: string;
  data: unknown[][];
}

export interface GeographyParsedWorkbook {
  sheetName: string;
  rows: GeographyPayload[];
  sourceRowNumbers: number[];
  inputRows: number;
  replacedDuplicateRows: number;
  dateStart: string;
  dateEnd: string;
}

export interface GeographyStagedRow {
  row_number: number;
  payload: GeographyPayload;
}

type GeographyField =
  | 'date' | 'seller_sku' | 'wb_sku' | 'region' | 'area' | 'city' | 'delivery_hours'
  | 'orders_total' | 'product_local_orders' | 'product_nonlocal_orders'
  | 'wb_local_orders' | 'wb_nonlocal_orders' | 'marketplace_local_orders' | 'marketplace_nonlocal_orders';

const REQUIRED_FIELDS: GeographyField[] = [
  'date', 'seller_sku', 'region', 'orders_total', 'product_local_orders', 'product_nonlocal_orders',
  'wb_local_orders', 'wb_nonlocal_orders', 'marketplace_local_orders', 'marketplace_nonlocal_orders',
];

const HEADER_ALIASES: Record<GeographyField, string[]> = {
  date: ['дата', 'date'],
  seller_sku: ['артикул продавца', 'артикул поставщика', 'sku', 'seller sku'],
  wb_sku: ['артикул wb', 'артикул вб', 'nm id', 'wb sku'],
  region: ['регион', 'кластер', 'федеральный округ', 'фо'],
  area: ['область', 'субъект', 'район'],
  city: ['город', 'населенный пункт', 'населённый пункт'],
  delivery_hours: ['время доставки', 'свд', 'delivery time'],
  orders_total: ['итого заказов шт', 'итого заказов'],
  product_local_orders: ['итого заказов по товарам локально шт', 'заказы по товарам локально шт'],
  product_nonlocal_orders: ['итого заказов по товарам не локально шт', 'заказы по товарам не локально шт'],
  wb_local_orders: ['заказы со склада wb локально шт', 'заказы со склада вб локально шт'],
  wb_nonlocal_orders: ['заказы со склада wb не локально шт', 'заказы со склада вб не локально шт'],
  marketplace_local_orders: ['заказы маркетплейс локально шт', 'заказы marketplace локально шт'],
  marketplace_nonlocal_orders: ['заказы маркетплейс не локально шт', 'заказы marketplace не локально шт'],
};

function cellText(value: unknown): string {
  return String(value ?? '').replace(/[\r\n\t]/gu, ' ').replace(/\u00a0/gu, ' ').replace(/\s+/gu, ' ').trim();
}

export function normalizeGeographyHeader(value: unknown): string {
  return cellText(value)
    .toLocaleLowerCase('ru-RU')
    .replace(/ё/gu, 'е')
    .replace(/[_.(),%/\\-]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

const NORMALIZED_ALIASES = Object.fromEntries(
  Object.entries(HEADER_ALIASES).map(([field, aliases]) => [field, aliases.map(normalizeGeographyHeader)]),
) as Record<GeographyField, string[]>;

function findFieldIndex(headers: string[], field: GeographyField): number {
  return headers.findIndex(header => NORMALIZED_ALIASES[field].includes(header));
}

function parseDateOrRaw(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, '0')}-${String(value.getUTCDate()).padStart(2, '0')}`;
  }
  const source = cellText(value);
  let match = source.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/u);
  if (!match) {
    const local = source.match(/^(\d{1,2})[./](\d{1,2})[./](\d{2}|\d{4})$/u);
    if (local) match = [source, local[3].length === 2 ? `20${local[3]}` : local[3], local[2], local[1]];
  }
  if (!match) return source;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (candidate.getUTCFullYear() !== year || candidate.getUTCMonth() !== month - 1 || candidate.getUTCDate() !== day) return source;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function parseIntegerOrRaw(value: unknown): number | string {
  if (typeof value === 'number') return Number.isFinite(value) ? value : cellText(value);
  const source = cellText(value);
  if (!source || source === '-') return 0;
  const normalized = source.replace(/[\s\u00a0\u202f]/gu, '').replace(',', '.');
  if (!/^-?\d+(?:\.\d+)?$/u.test(normalized)) return source;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : source;
}

export function parseGeographyDeliveryHours(value: unknown): number | string | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : cellText(value);
  const source = cellText(value).toLocaleLowerCase('ru-RU');
  if (!source || source === '-' || source === '—' || source === 'нет данных') return null;
  if (/^-?\d+(?:[.,]\d+)?$/u.test(source)) {
    const parsed = Number(source.replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : source;
  }
  const compact = source.replace(/\s+/gu, '');
  const match = compact.match(/^(?:(\d+)(?:д|дн|день|дня|дней))?(?:(\d+)(?:ч|час|часа|часов))?$/u);
  if (!match || (match[1] === undefined && match[2] === undefined)) return cellText(value);
  return Number(match[1] || 0) * 24 + Number(match[2] || 0);
}

function businessKey(payload: GeographyPayload): string {
  const identity = cellText(payload.seller_sku) || cellText(payload.wb_sku);
  return [payload.date, identity, payload.region, payload.area || 'Без региона', payload.city || 'Без населённого пункта']
    .map(value => cellText(value).toLocaleLowerCase('ru-RU'))
    .join('\u001f');
}

function parseSheet(sheet: GeographySheetGrid): GeographyParsedWorkbook | null {
  const normalizedRows = sheet.data.map(row => row.map(normalizeGeographyHeader));
  const headerIndex = normalizedRows.findIndex(headers =>
    findFieldIndex(headers, 'date') >= 0
    && (findFieldIndex(headers, 'seller_sku') >= 0 || findFieldIndex(headers, 'wb_sku') >= 0)
    && findFieldIndex(headers, 'region') >= 0
    && findFieldIndex(headers, 'orders_total') >= 0,
  );
  if (headerIndex < 0) return null;

  const headers = normalizedRows[headerIndex];
  const indexes = Object.fromEntries(
    (Object.keys(HEADER_ALIASES) as GeographyField[]).map(field => [field, findFieldIndex(headers, field)]),
  ) as Record<GeographyField, number>;
  const missing = REQUIRED_FIELDS.filter(field => indexes[field] < 0 && !(field === 'seller_sku' && indexes.wb_sku >= 0));
  if (missing.length) throw new Error(`Файл географии не распознан: отсутствуют обязательные колонки ${missing.join(', ')}.`);

  const latestByKey = new Map<string, { payload: GeographyPayload; rowNumber: number }>();
  let inputRows = 0;
  for (let rowIndex = headerIndex + 1; rowIndex < sheet.data.length; rowIndex++) {
    const source = sheet.data[rowIndex] || [];
    if (!source.some(value => cellText(value))) continue;
    inputRows += 1;
    if (inputRows > GEOGRAPHY_MAX_ROWS) throw new Error(`Отчёт «География заказов» содержит больше ${GEOGRAPHY_MAX_ROWS.toLocaleString('ru-RU')} строк`);
    const value = (field: GeographyField) => indexes[field] >= 0 ? source[indexes[field]] : '';
    const payload: GeographyPayload = {
      date: parseDateOrRaw(value('date')),
      seller_sku: cellText(value('seller_sku')),
      wb_sku: cellText(value('wb_sku')),
      region: cellText(value('region')),
      area: cellText(value('area')) || 'Без региона',
      city: cellText(value('city')) || 'Без населённого пункта',
      delivery_hours: parseGeographyDeliveryHours(value('delivery_hours')),
      orders_total: parseIntegerOrRaw(value('orders_total')),
      product_local_orders: parseIntegerOrRaw(value('product_local_orders')),
      product_nonlocal_orders: parseIntegerOrRaw(value('product_nonlocal_orders')),
      wb_local_orders: parseIntegerOrRaw(value('wb_local_orders')),
      wb_nonlocal_orders: parseIntegerOrRaw(value('wb_nonlocal_orders')),
      marketplace_local_orders: parseIntegerOrRaw(value('marketplace_local_orders')),
      marketplace_nonlocal_orders: parseIntegerOrRaw(value('marketplace_nonlocal_orders')),
    };
    latestByKey.set(businessKey(payload), { payload, rowNumber: rowIndex + 1 });
  }
  if (!inputRows) throw new Error('Отчёт «География заказов» не содержит строк данных.');
  const collapsed = [...latestByKey.values()];
  const dates = collapsed.map(item => item.payload.date).filter((value): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/u.test(value)).sort();
  return {
    sheetName: sheet.name,
    rows: collapsed.map(item => item.payload),
    sourceRowNumbers: collapsed.map(item => item.rowNumber),
    inputRows,
    replacedDuplicateRows: inputRows - collapsed.length,
    dateStart: dates[0] || '',
    dateEnd: dates.at(-1) || dates[0] || '',
  };
}

export function extractGeographyWorkbook(sheets: GeographySheetGrid[]): GeographyParsedWorkbook {
  for (const sheet of sheets) {
    const parsed = parseSheet(sheet);
    if (parsed) return parsed;
  }
  throw new Error('Файл не содержит распознаваемого листа «География заказов».');
}

export function buildGeographyStagedRows(workbook: GeographyParsedWorkbook): GeographyStagedRow[] {
  return workbook.rows.map((payload, index) => ({
    row_number: workbook.sourceRowNumbers[index] || index + 2,
    payload,
  }));
}

export function splitGeographyRows<T>(rows: T[], size = GEOGRAPHY_STAGE_CHUNK_SIZE): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < rows.length; index += size) chunks.push(rows.slice(index, index + size));
  return chunks;
}
