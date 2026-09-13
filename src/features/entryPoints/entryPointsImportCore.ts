export const ENTRY_POINTS_MAX_FILE_BYTES = 25 * 1024 * 1024;
export const ENTRY_POINTS_MAX_ROWS = 250_000;
export const ENTRY_POINTS_STAGE_CHUNK_SIZE = 500;

export type EntryPointsPayload = Record<string, string | number>;

export interface EntryPointsSheetGrid { name: string; data: unknown[][] }
export interface EntryPointsParsedWorkbook {
  sheetName: string;
  rows: EntryPointsPayload[];
  sourceRowNumbers: number[];
  inputRows: number;
  replacedDuplicateRows: number;
  dateStart: string;
  dateEnd: string;
}
export interface EntryPointsStagedRow { row_number: number; payload: EntryPointsPayload }

type Field = 'date' | 'seller_sku' | 'wb_sku' | 'section' | 'entry_point' | 'impressions' | 'clicks' | 'carts' | 'orders';

const REQUIRED_FIELDS: Field[] = ['date', 'section', 'entry_point', 'impressions', 'clicks', 'carts', 'orders'];
const HEADER_ALIASES: Record<Field, string[]> = {
  date: ['дата', 'date'],
  seller_sku: ['артикул продавца', 'артикул поставщика', 'артикул', 'sku', 'seller sku'],
  wb_sku: ['артикул wb', 'артикул вб', 'nm id', 'номенклатура', 'wb sku'],
  section: ['раздел', 'section'],
  entry_point: ['точка входа', 'entry point'],
  impressions: ['показы', 'impressions'],
  clicks: ['переходы в карточку', 'переходы', 'clicks'],
  carts: ['добавления в корзину', 'добавили в корзину', 'корзины', 'carts'],
  orders: ['заказы', 'заказы шт', 'orders'],
};

function cellText(value: unknown): string {
  return String(value ?? '').replace(/[\r\n\t]/gu, ' ').replace(/\u00a0/gu, ' ').replace(/\s+/gu, ' ').trim();
}

export function normalizeEntryPointsHeader(value: unknown): string {
  return cellText(value).toLocaleLowerCase('ru-RU').replace(/ё/gu, 'е').replace(/[_.(),%/\\-]/gu, ' ').replace(/\s+/gu, ' ').trim();
}

const NORMALIZED_ALIASES = Object.fromEntries(
  Object.entries(HEADER_ALIASES).map(([field, aliases]) => [field, aliases.map(normalizeEntryPointsHeader)]),
) as Record<Field, string[]>;

function findFieldIndex(headers: string[], field: Field): number {
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
  if (!source || source === '-' || source === '—') return 0;
  const normalized = source.replace(/[\s\u00a0\u202f]/gu, '').replace(',', '.');
  if (!/^-?\d+(?:\.\d+)?$/u.test(normalized)) return source;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : source;
}

function canonicalSellerSku(value: unknown): string {
  return cellText(value).replace(/\.0+$/u, '');
}

function businessKey(payload: EntryPointsPayload): string {
  const identity = canonicalSellerSku(payload.seller_sku) || cellText(payload.wb_sku);
  return [payload.date, identity, payload.section, payload.entry_point || 'Без уточнения']
    .map(value => cellText(value).toLocaleLowerCase('ru-RU'))
    .join('\u001f');
}

function parseSheet(sheet: EntryPointsSheetGrid): EntryPointsParsedWorkbook | null {
  const normalizedRows = sheet.data.map(row => row.map(normalizeEntryPointsHeader));
  const headerIndex = normalizedRows.findIndex(headers =>
    findFieldIndex(headers, 'date') >= 0
    && (findFieldIndex(headers, 'seller_sku') >= 0 || findFieldIndex(headers, 'wb_sku') >= 0)
    && findFieldIndex(headers, 'section') >= 0
    && findFieldIndex(headers, 'entry_point') >= 0,
  );
  if (headerIndex < 0) return null;
  const headers = normalizedRows[headerIndex];
  const indexes = Object.fromEntries((Object.keys(HEADER_ALIASES) as Field[]).map(field => [field, findFieldIndex(headers, field)])) as Record<Field, number>;
  const missing = REQUIRED_FIELDS.filter(field => indexes[field] < 0);
  if (indexes.seller_sku < 0 && indexes.wb_sku < 0) missing.push('seller_sku');
  if (missing.length) throw new Error(`Файл точек входа не распознан: отсутствуют обязательные колонки ${missing.join(', ')}.`);

  const latestByKey = new Map<string, { payload: EntryPointsPayload; rowNumber: number }>();
  let inputRows = 0;
  for (let rowIndex = headerIndex + 1; rowIndex < sheet.data.length; rowIndex++) {
    const source = sheet.data[rowIndex] || [];
    if (!source.some(value => cellText(value))) continue;
    inputRows += 1;
    if (inputRows > ENTRY_POINTS_MAX_ROWS) throw new Error(`Отчёт «Точки входа» содержит больше ${ENTRY_POINTS_MAX_ROWS.toLocaleString('ru-RU')} строк`);
    const value = (field: Field) => indexes[field] >= 0 ? source[indexes[field]] : '';
    const payload: EntryPointsPayload = {
      date: parseDateOrRaw(value('date')),
      seller_sku: cellText(value('seller_sku')),
      wb_sku: cellText(value('wb_sku')),
      section: cellText(value('section')),
      entry_point: ['', '-', '—'].includes(cellText(value('entry_point'))) ? 'Без уточнения' : cellText(value('entry_point')),
      impressions: parseIntegerOrRaw(value('impressions')),
      clicks: parseIntegerOrRaw(value('clicks')),
      carts: parseIntegerOrRaw(value('carts')),
      orders: parseIntegerOrRaw(value('orders')),
    };
    latestByKey.set(businessKey(payload), { payload, rowNumber: rowIndex + 1 });
  }
  if (!inputRows) throw new Error('Отчёт «Точки входа» не содержит строк данных.');
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

export function extractEntryPointsWorkbook(sheets: EntryPointsSheetGrid[]): EntryPointsParsedWorkbook {
  for (const sheet of sheets) {
    const parsed = parseSheet(sheet);
    if (parsed) return parsed;
  }
  throw new Error('Файл не содержит распознаваемого листа «Точки входа».');
}

export function buildEntryPointsStagedRows(workbook: EntryPointsParsedWorkbook): EntryPointsStagedRow[] {
  return workbook.rows.map((payload, index) => ({ row_number: workbook.sourceRowNumbers[index] || index + 2, payload }));
}

export function splitEntryPointsRows<T>(rows: T[], size = ENTRY_POINTS_STAGE_CHUNK_SIZE): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < rows.length; index += size) chunks.push(rows.slice(index, index + size));
  return chunks;
}
