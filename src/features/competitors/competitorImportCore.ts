export const COMPETITOR_MAX_FILE_BYTES = 25 * 1024 * 1024;
export const COMPETITOR_MAX_ROWS = 50_000;
export const COMPETITOR_STAGE_CHUNK_SIZE = 500;

export type CompetitorSectionName = 'funnel' | 'search' | 'stocks' | 'positions';
export type CompetitorPayload = Record<string, string | number>;

export interface CompetitorSheetGrid {
  name: string;
  data: unknown[][];
}

export interface CompetitorParsedSection {
  sheetName: string;
  rows: CompetitorPayload[];
  sourceRowNumbers: number[];
}

export interface CompetitorParsedWorkbook {
  sections: Record<CompetitorSectionName, CompetitorParsedSection>;
  dateStart: string;
  dateEnd: string;
  inferredYear: number | null;
  totalRows: number;
}

export interface CompetitorStagedRow {
  sheet_name: CompetitorSectionName;
  row_number: number;
  payload: CompetitorPayload;
}

const SECTION_NAMES: CompetitorSectionName[] = ['funnel', 'search', 'stocks', 'positions'];

export function normalizeCompetitorHeader(value: unknown): string {
  return cellText(value)
    .toLocaleLowerCase('ru-RU')
    .replace(/\*\*/g, '')
    .replace(/[_.(),%]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cellText(value: unknown): string {
  if (value instanceof Date) {
    const year = value.getUTCFullYear();
    const month = String(value.getUTCMonth() + 1).padStart(2, '0');
    const day = String(value.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  return String(value ?? '').replace(/\r/g, ' ').trim();
}

function classify(headers: string[]): CompetitorSectionName | null {
  const set = new Set(headers);
  if (set.has('поисковый запрос') && set.has('количество запросов')) return 'search';
  if (set.has('склад') && [...set].some(value => value.startsWith('остатки'))) return 'stocks';
  if (set.has('сумма заказов') && set.has('показы') && set.has('корзины')) return 'funnel';
  if (set.has('позиция') && set.has('артикул') && set.has('продавец') && set.has('бренд')) return 'positions';
  return null;
}

interface RawSheet {
  name: string;
  headers: string[];
  rows: Record<string, unknown>[];
  sourceRowNumbers: number[];
}

function readSheet(sheet: CompetitorSheetGrid): RawSheet {
  const headerIndex = sheet.data.findIndex(row => row.filter(cell => cellText(cell)).length >= 3);
  if (headerIndex < 0) return { name: sheet.name, headers: [], rows: [], sourceRowNumbers: [] };
  const headers = (sheet.data[headerIndex] || []).map(normalizeCompetitorHeader);
  const rows: Record<string, unknown>[] = [];
  const sourceRowNumbers: number[] = [];
  for (let rowIndex = headerIndex + 1; rowIndex < sheet.data.length; rowIndex++) {
    const cells = sheet.data[rowIndex] || [];
    if (!cells.some(value => cellText(value))) continue;
    const row: Record<string, unknown> = {};
    headers.forEach((key, index) => { if (key) row[key] = cells[index]; });
    rows.push(row);
    sourceRowNumbers.push(rowIndex + 1);
  }
  return { name: sheet.name, headers, rows, sourceRowNumbers };
}

function field(row: Record<string, unknown>, ...aliases: string[]): unknown {
  for (const alias of aliases.map(normalizeCompetitorHeader)) {
    if (alias in row) return row[alias];
  }
  return '';
}

function parseNumberOrRaw(value: unknown): number | string {
  if (typeof value === 'number') return Number.isFinite(value) ? value : cellText(value);
  const source = cellText(value);
  if (!source) return 0;
  const compact = source
    .replace(/₽/g, '')
    .replace(/\bр\.?/giu, '')
    .replace(/[%\s\u00a0\u202f]/g, '')
    .replace(/[^\d,.-]/g, '');
  if (!compact) return source;
  const lastComma = compact.lastIndexOf(',');
  const lastDot = compact.lastIndexOf('.');
  let normalized = compact;
  if (lastComma >= 0 && lastDot >= 0) {
    normalized = lastComma > lastDot ? compact.replace(/\./g, '').replace(',', '.') : compact.replace(/,/g, '');
  } else if ((compact.match(/,/g) || []).length > 1) {
    normalized = compact.replace(/,/g, '');
  } else if ((compact.match(/\./g) || []).length > 1) {
    normalized = compact.replace(/\./g, '');
  } else if (lastComma >= 0) {
    normalized = compact.replace(',', '.');
  }
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : source;
}

function parsePercentOrRaw(value: unknown): number | string {
  const parsed = parseNumberOrRaw(value);
  if (typeof parsed !== 'number') return parsed;
  return typeof value === 'number' && Math.abs(parsed) <= 1 ? parsed * 100 : parsed;
}

function normalizeDate(value: unknown, fallbackYear: number): string {
  const source = cellText(value);
  let match = source.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!match) {
    const full = source.match(/^(\d{1,2})[./](\d{1,2})[./](\d{2}|\d{4})$/);
    if (full) match = [source, full[3].length === 2 ? `20${full[3]}` : full[3], full[2], full[1]];
  }
  if (!match) {
    const short = source.match(/^(\d{1,2})[./](\d{1,2})$/);
    if (short) match = [source, String(fallbackYear), short[2], short[1]];
  }
  if (!match) return source;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (candidate.getUTCFullYear() !== year || candidate.getUTCMonth() !== month - 1 || candidate.getUTCDate() !== day) return source;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function inferYear(sheets: RawSheet[]): number | null {
  for (const sheet of sheets) {
    for (const row of sheet.rows.slice(0, 100)) {
      const value = field(row, 'Дата');
      if (value instanceof Date) return value.getUTCFullYear();
      const match = cellText(value).match(/(?:^|\D)(20\d{2})(?:\D|$)/);
      if (match) return Number(match[1]);
    }
  }
  return null;
}

function mapSectionRows(section: CompetitorSectionName, sheet: RawSheet, reportYear: number): CompetitorPayload[] {
  return sheet.rows.map(row => {
    const common = { date: normalizeDate(field(row, 'Дата'), reportYear) };
    if (section === 'funnel') return {
      ...common,
      wb_article: cellText(field(row, 'Артикул')),
      position: parseNumberOrRaw(field(row, 'Позиция')),
      seller: cellText(field(row, 'Продавец')) || 'Без продавца',
      brand: cellText(field(row, 'Бренд')) || 'Без бренда',
      ordered_amount: parseNumberOrRaw(field(row, 'Сумма заказов')),
      discounted_price: parseNumberOrRaw(field(row, 'Цена со скидкой')),
      buyer_median_price: parseNumberOrRaw(field(row, 'Медиана покупателя')),
      avg_search_position: parseNumberOrRaw(field(row, 'Ср позиция в поиске')),
      impressions: parseNumberOrRaw(field(row, 'Показы')),
      clicks: parseNumberOrRaw(field(row, 'Клики')),
      reported_ctr: parsePercentOrRaw(field(row, 'CTR')),
      carts: parseNumberOrRaw(field(row, 'Корзины')),
      reported_cart_conversion: parsePercentOrRaw(field(row, 'CR в корзину общий')),
      orders: parseNumberOrRaw(field(row, 'Заказы')),
      reported_order_conversion: parsePercentOrRaw(field(row, 'CR из показа в заказ')),
      buyouts: parseNumberOrRaw(field(row, 'Выкупы')),
      reported_buyout_rate: parsePercentOrRaw(field(row, 'выкупа')),
    };
    if (section === 'search') return {
      ...common,
      wb_article: cellText(field(row, 'Артикул')),
      query: cellText(field(row, 'Поисковый запрос')),
      requests: parseNumberOrRaw(field(row, 'Количество запросов')),
      requests_previous: parseNumberOrRaw(field(row, 'Количество запросов предыдущий период')),
      reported_cart_conversion: parsePercentOrRaw(field(row, 'Конверсия в корзину по артикулу')),
      reported_cart_conversion_previous: parsePercentOrRaw(field(row, 'Конверсия в корзину по артикулу предыдущий период')),
      reported_order_conversion: parsePercentOrRaw(field(row, 'Конверсия в заказ по артикулу')),
      reported_order_conversion_previous: parsePercentOrRaw(field(row, 'Конверсия в заказ по артикулу предыдущий период')),
    };
    if (section === 'stocks') return {
      ...common,
      wb_article: cellText(field(row, 'Артикул WB')),
      name: cellText(field(row, 'Название')),
      subject: cellText(field(row, 'Предмет')),
      brand: cellText(field(row, 'Бренд')),
      region: cellText(field(row, 'Регион')),
      warehouse: cellText(field(row, 'Склад')),
      stock: parseNumberOrRaw(field(row, 'Остатки шт')),
      in_transit_to_customer: parseNumberOrRaw(field(row, 'В пути к покупателю шт')),
      in_transit_from_customer: parseNumberOrRaw(field(row, 'В пути от покупателя шт')),
      avg_daily_orders: parseNumberOrRaw(field(row, 'Среднее количество заказов в день шт')),
    };
    return {
      ...common,
      wb_article: cellText(field(row, 'Артикул')),
      position: parseNumberOrRaw(field(row, 'Позиция')),
      seller: cellText(field(row, 'Продавец')) || 'Без продавца',
      brand: cellText(field(row, 'Бренд')) || 'Без бренда',
    };
  });
}

function normalizedBusinessText(value: string | number | undefined): string {
  return String(value ?? '').toLocaleLowerCase('ru-RU').replace(/\s+/g, ' ').trim();
}

function competitorBusinessKey(section: CompetitorSectionName, row: CompetitorPayload): string {
  const common = [row.date, row.wb_article];
  if (section === 'search') common.push(normalizedBusinessText(row.query));
  if (section === 'stocks') common.push(normalizedBusinessText(row.region), normalizedBusinessText(row.warehouse));
  return common.join('\u001f');
}

function collapseSectionRows(
  section: CompetitorSectionName,
  rows: CompetitorPayload[],
  sourceRowNumbers: number[],
): { rows: CompetitorPayload[]; sourceRowNumbers: number[] } {
  const latestByKey = new Map<string, { row: CompetitorPayload; sourceRowNumber: number }>();
  rows.forEach((row, index) => {
    latestByKey.set(competitorBusinessKey(section, row), {
      row,
      sourceRowNumber: sourceRowNumbers[index] || index + 2,
    });
  });
  const collapsed = [...latestByKey.values()];
  return {
    rows: collapsed.map(value => value.row),
    sourceRowNumbers: collapsed.map(value => value.sourceRowNumber),
  };
}

export function extractCompetitorWorkbook(sheets: CompetitorSheetGrid[], reportYear?: number): CompetitorParsedWorkbook {
  const parsed = sheets.map(readSheet);
  const recognized = new Map<CompetitorSectionName, RawSheet>();
  for (const sheet of parsed) {
    const section = classify(sheet.headers);
    if (section && !recognized.has(section)) recognized.set(section, sheet);
  }
  const missing = SECTION_NAMES.filter(section => !recognized.has(section));
  if (missing.length) throw new Error(`Файл конкурентов не распознан: отсутствуют листы ${missing.join(', ')}.`);

  const inferredYear = inferYear(parsed);
  const year = reportYear || inferredYear || new Date().getFullYear();
  const sections = Object.fromEntries(SECTION_NAMES.map(section => {
    const sheet = recognized.get(section)!;
    const collapsed = collapseSectionRows(section, mapSectionRows(section, sheet, year), sheet.sourceRowNumbers);
    return [section, { sheetName: sheet.name, ...collapsed }];
  })) as Record<CompetitorSectionName, CompetitorParsedSection>;
  const totalRows = SECTION_NAMES.reduce((sum, section) => sum + sections[section].rows.length, 0);
  if (totalRows > COMPETITOR_MAX_ROWS) throw new Error(`Отчёт «Конкуренты» содержит больше ${COMPETITOR_MAX_ROWS.toLocaleString('ru-RU')} строк`);
  if (SECTION_NAMES.some(section => sections[section].rows.length === 0)) throw new Error('Один из четырёх листов не содержит строк данных.');

  const dates = SECTION_NAMES.flatMap(section => sections[section].rows.map(row => row.date))
    .filter((value): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value))
    .sort();
  return { sections, dateStart: dates[0] || '', dateEnd: dates.at(-1) || dates[0] || '', inferredYear, totalRows };
}

export function buildCompetitorStagedRows(workbook: CompetitorParsedWorkbook): CompetitorStagedRow[] {
  return SECTION_NAMES.flatMap(section => workbook.sections[section].rows.map((payload, index) => ({
    sheet_name: section,
    row_number: workbook.sections[section].sourceRowNumbers[index] || index + 2,
    payload,
  })));
}

export function splitCompetitorRows<T>(rows: T[], size = COMPETITOR_STAGE_CHUNK_SIZE): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < rows.length; index += size) chunks.push(rows.slice(index, index + size));
  return chunks;
}
