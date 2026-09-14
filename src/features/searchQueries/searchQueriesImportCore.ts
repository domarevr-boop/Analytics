export const SEARCH_QUERIES_MAX_FILE_BYTES = 25 * 1024 * 1024;
export const SEARCH_QUERIES_MAX_ROWS = 500_000;
export const SEARCH_QUERIES_STAGE_CHUNK_SIZE = 500;

export type SearchQueriesPayload = Record<string, string | number>;

export interface SearchQueriesSheetGrid { name: string; data: unknown[][] }
export interface SearchQueriesParsedWorkbook {
  sheetName: string;
  rows: SearchQueriesPayload[];
  sourceRowNumbers: number[];
  inputRows: number;
  replacedDuplicateRows: number;
  dateStart: string;
  dateEnd: string;
}
export interface SearchQueriesStagedRow { row_number: number; payload: SearchQueriesPayload }

type Field =
  | 'date' | 'query' | 'category'
  | 'requests' | 'requests_previous' | 'avg_daily_requests' | 'avg_daily_requests_previous'
  | 'card_clicks' | 'card_clicks_previous' | 'carts' | 'carts_previous'
  | 'cart_conversion' | 'cart_conversion_previous' | 'orders' | 'orders_previous'
  | 'order_conversion' | 'order_conversion_previous' | 'ordered_subjects' | 'ordered_subjects_previous'
  | 'products' | 'products_previous';

const REQUIRED_FIELDS: Field[] = ['date', 'query', 'category', 'requests', 'card_clicks', 'carts', 'orders'];
const HEADER_ALIASES: Record<Field, string[]> = {
  date: ['дата', 'date'],
  query: ['поисковый запрос', 'запрос', 'search query'],
  category: ['больше всего заказов в предмете', 'предмет', 'категория'],
  requests: ['количество запросов', 'запросы'],
  requests_previous: ['количество запросов предыдущий период', 'запросы предыдущий период'],
  avg_daily_requests: ['запросов в среднем за день'],
  avg_daily_requests_previous: ['запросов в среднем за день предыдущий период'],
  card_clicks: ['перешли в карточку товара', 'переходы в карточку товара'],
  card_clicks_previous: ['перешли в карточку товара предыдущий период', 'переходы в карточку товара предыдущий период'],
  carts: ['добавили в корзину', 'добавления в корзину'],
  carts_previous: ['добавили в корзину предыдущий период', 'добавления в корзину предыдущий период'],
  cart_conversion: ['конверсия в корзину'],
  cart_conversion_previous: ['конверсия в корзину предыдущий период'],
  orders: ['заказали товаров', 'заказы'],
  orders_previous: ['заказали товаров предыдущий период', 'заказы предыдущий период'],
  order_conversion: ['конверсия в заказ'],
  order_conversion_previous: ['конверсия в заказ предыдущий период'],
  ordered_subjects: ['предметов с заказами по запросу'],
  ordered_subjects_previous: ['предметов с заказами по запросу предыдущий период'],
  products: ['количество товаров', 'товаров'],
  products_previous: ['количество товаров предыдущий период', 'товаров предыдущий период'],
};

function cellText(value: unknown): string {
  return String(value ?? '').replace(/[\r\n\t]/gu, ' ').replace(/\u00a0/gu, ' ').replace(/\s+/gu, ' ').trim();
}

export function normalizeSearchQueriesHeader(value: unknown): string {
  return cellText(value).toLocaleLowerCase('ru-RU').replace(/ё/gu, 'е').replace(/[_.(),%/\\—–-]/gu, ' ').replace(/\s+/gu, ' ').trim();
}

const NORMALIZED_ALIASES = Object.fromEntries(
  Object.entries(HEADER_ALIASES).map(([field, aliases]) => [field, aliases.map(normalizeSearchQueriesHeader)]),
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
  const year = Number(match[1]); const month = Number(match[2]); const day = Number(match[3]);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (candidate.getUTCFullYear() !== year || candidate.getUTCMonth() !== month - 1 || candidate.getUTCDate() !== day) return source;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function parseNumberOrRaw(value: unknown): number | string {
  if (typeof value === 'number') return Number.isFinite(value) ? value : cellText(value);
  const source = cellText(value);
  if (!source || source === '-' || source === '—') return 0;
  const normalized = source.replace(/[\s\u00a0\u202f%]/gu, '').replace(',', '.');
  if (!/^-?\d+(?:\.\d+)?$/u.test(normalized)) return source;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : source;
}

export function normalizeSearchQuery(value: unknown): string {
  return cellText(value).toLocaleLowerCase('ru-RU');
}

function businessKey(payload: SearchQueriesPayload): string {
  return [payload.date, payload.query, payload.category]
    .map(value => cellText(value).toLocaleLowerCase('ru-RU'))
    .join('\u001f');
}

function parseSheet(sheet: SearchQueriesSheetGrid): SearchQueriesParsedWorkbook | null {
  const normalizedRows = sheet.data.map(row => row.map(normalizeSearchQueriesHeader));
  const headerIndex = normalizedRows.findIndex(headers =>
    findFieldIndex(headers, 'date') >= 0 && findFieldIndex(headers, 'query') >= 0 && findFieldIndex(headers, 'requests') >= 0,
  );
  if (headerIndex < 0) return null;
  const headers = normalizedRows[headerIndex];
  const indexes = Object.fromEntries((Object.keys(HEADER_ALIASES) as Field[]).map(field => [field, findFieldIndex(headers, field)])) as Record<Field, number>;
  const missing = REQUIRED_FIELDS.filter(field => indexes[field] < 0);
  if (missing.length) throw new Error(`Файл поисковых запросов не распознан: отсутствуют обязательные колонки ${missing.join(', ')}.`);

  const latestByKey = new Map<string, { payload: SearchQueriesPayload; rowNumber: number }>();
  let inputRows = 0;
  for (let rowIndex = headerIndex + 1; rowIndex < sheet.data.length; rowIndex++) {
    const source = sheet.data[rowIndex] || [];
    if (!source.some(value => cellText(value))) continue;
    inputRows += 1;
    if (inputRows > SEARCH_QUERIES_MAX_ROWS) throw new Error(`Отчёт «Поисковые запросы» содержит больше ${SEARCH_QUERIES_MAX_ROWS.toLocaleString('ru-RU')} строк`);
    const value = (field: Field) => indexes[field] >= 0 ? source[indexes[field]] : '';
    const payload: SearchQueriesPayload = {
      date: parseDateOrRaw(value('date')),
      query: normalizeSearchQuery(value('query')),
      category: cellText(value('category')) || 'Без предмета',
      requests: parseNumberOrRaw(value('requests')),
      requests_previous: parseNumberOrRaw(value('requests_previous')),
      avg_daily_requests: parseNumberOrRaw(value('avg_daily_requests')),
      avg_daily_requests_previous: parseNumberOrRaw(value('avg_daily_requests_previous')),
      card_clicks: parseNumberOrRaw(value('card_clicks')),
      card_clicks_previous: parseNumberOrRaw(value('card_clicks_previous')),
      carts: parseNumberOrRaw(value('carts')),
      carts_previous: parseNumberOrRaw(value('carts_previous')),
      cart_conversion: parseNumberOrRaw(value('cart_conversion')),
      cart_conversion_previous: parseNumberOrRaw(value('cart_conversion_previous')),
      orders: parseNumberOrRaw(value('orders')),
      orders_previous: parseNumberOrRaw(value('orders_previous')),
      order_conversion: parseNumberOrRaw(value('order_conversion')),
      order_conversion_previous: parseNumberOrRaw(value('order_conversion_previous')),
      ordered_subjects: parseNumberOrRaw(value('ordered_subjects')),
      ordered_subjects_previous: parseNumberOrRaw(value('ordered_subjects_previous')),
      products: parseNumberOrRaw(value('products')),
      products_previous: parseNumberOrRaw(value('products_previous')),
    };
    latestByKey.set(businessKey(payload), { payload, rowNumber: rowIndex + 1 });
  }
  if (!inputRows) throw new Error('Отчёт «Поисковые запросы» не содержит строк данных.');
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

export function extractSearchQueriesWorkbook(sheets: SearchQueriesSheetGrid[]): SearchQueriesParsedWorkbook {
  for (const sheet of sheets) {
    const parsed = parseSheet(sheet);
    if (parsed) return parsed;
  }
  throw new Error('Файл не содержит распознаваемого листа «Поисковые запросы».');
}

export function buildSearchQueriesStagedRows(workbook: SearchQueriesParsedWorkbook): SearchQueriesStagedRow[] {
  return workbook.rows.map((payload, index) => ({ row_number: workbook.sourceRowNumbers[index] || index + 2, payload }));
}

export function splitSearchQueriesRows<T>(rows: T[], size = SEARCH_QUERIES_STAGE_CHUNK_SIZE): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < rows.length; index += size) chunks.push(rows.slice(index, index + size));
  return chunks;
}
