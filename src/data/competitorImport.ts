import * as XLSX from 'xlsx';
import { normalizeImportDate } from './dateUtils';
import type { CompetitorFunnelRecord, CompetitorPositionRecord, CompetitorSearchRecord, CompetitorStockRecord } from '../types';

export interface CompetitorWorkbookData {
  funnel: CompetitorFunnelRecord[];
  search: CompetitorSearchRecord[];
  stocks: CompetitorStockRecord[];
  positions: CompetitorPositionRecord[];
  sheetNames: Record<'funnel' | 'search' | 'stocks' | 'positions', string>;
  dateStart: string;
  dateEnd: string;
  inferredYear: number | null;
}

type RawRow = Record<string, string>;

const clean = (value: unknown) => String(value ?? '').replace(/\r/g, ' ').trim();
const header = (value: unknown) => clean(value)
  .toLocaleLowerCase('ru-RU')
  .replace(/\*\*/g, '')
  .replace(/[_.(),%]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

function number(value: unknown) {
  const normalized = clean(value)
    .replace(/[₽р.]/gi, '')
    .replace(/[%\s\u00a0\u202f]/g, '')
    .replace(',', '.')
    .replace(/[^\d.-]/g, '');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function readRows(sheet: XLSX.WorkSheet): { headers: string[]; rows: RawRow[] } {
  const grid = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, defval: '', raw: false, dateNF: 'yyyy-mm-dd' });
  const headerIndex = grid.findIndex(row => row.filter(cell => clean(cell)).length >= 3);
  if (headerIndex < 0) return { headers: [], rows: [] };
  const headers = grid[headerIndex].map(header);
  const rows = grid.slice(headerIndex + 1).map(cells => {
    const row: RawRow = {};
    headers.forEach((key, index) => { if (key) row[key] = clean(cells[index]); });
    return row;
  }).filter(row => Object.values(row).some(Boolean));
  return { headers, rows };
}

function field(row: RawRow, ...aliases: string[]) {
  for (const alias of aliases.map(header)) {
    if (alias in row) return row[alias];
  }
  return '';
}

function classify(headers: string[]) {
  const set = new Set(headers);
  if (set.has('поисковый запрос') && set.has('количество запросов')) return 'search' as const;
  if (set.has('склад') && [...set].some(value => value.startsWith('остатки'))) return 'stocks' as const;
  if (set.has('сумма заказов') && set.has('показы') && set.has('корзины')) return 'funnel' as const;
  if (set.has('позиция') && set.has('артикул') && set.has('продавец') && set.has('бренд')) return 'positions' as const;
  return null;
}

function inferYear(sheets: Array<{ rows: RawRow[] }>) {
  for (const sheet of sheets) {
    for (const row of sheet.rows.slice(0, 100)) {
      const value = field(row, 'Дата');
      const match = value.match(/(?:^|\D)(20\d{2})(?:\D|$)/);
      if (match) return Number(match[1]);
    }
  }
  return null;
}

function date(value: string, reportYear: number) {
  return normalizeImportDate(value, reportYear);
}

export async function parseCompetitorWorkbook(file: File, reportYear?: number): Promise<CompetitorWorkbookData> {
  const extension = file.name.split('.').pop()?.toLowerCase();
  if (extension !== 'xlsx' && extension !== 'xls') throw new Error('Файл конкурентов должен быть в формате Excel (.xlsx или .xls).');
  const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
  const parsed = workbook.SheetNames.map(name => ({ name, ...readRows(workbook.Sheets[name]) }));
  const recognized = new Map<string, (typeof parsed)[number]>();
  for (const sheet of parsed) {
    const type = classify(sheet.headers);
    if (type && !recognized.has(type)) recognized.set(type, sheet);
  }
  const missing = ['funnel', 'search', 'stocks', 'positions'].filter(type => !recognized.has(type));
  if (missing.length) throw new Error(`Файл конкурентов не распознан: отсутствуют листы ${missing.join(', ')}.`);

  const inferredYear = inferYear(parsed);
  const year = reportYear || inferredYear || new Date().getFullYear();
  const funnelSheet = recognized.get('funnel')!;
  const searchSheet = recognized.get('search')!;
  const stockSheet = recognized.get('stocks')!;
  const positionSheet = recognized.get('positions')!;

  const funnel = funnelSheet.rows.map(row => ({
    date: date(field(row, 'Дата'), year),
    position: number(field(row, 'Позиция')),
    wb_article: field(row, 'Артикул'), seller: field(row, 'Продавец'), brand: field(row, 'Бренд'),
    ordered_amount: number(field(row, 'Сумма заказов')),
    discounted_price: number(field(row, 'Цена со скидкой')),
    buyer_median_price: number(field(row, 'Медиана покупателя')),
    avg_search_position: number(field(row, 'Ср позиция в поиске')),
    impressions: number(field(row, 'Показы')), clicks: number(field(row, 'Клики')), ctr: number(field(row, 'CTR')),
    carts: number(field(row, 'Корзины')), cart_conversion: number(field(row, 'CR в корзину общий')),
    orders: number(field(row, 'Заказы')), order_conversion: number(field(row, 'CR из показа в заказ')),
    buyouts: number(field(row, 'Выкупы')), buyout_rate: number(field(row, 'выкупа')),
  })).filter(row => row.date && row.wb_article);

  const search = searchSheet.rows.map(row => ({
    date: date(field(row, 'Дата'), year), wb_article: field(row, 'Артикул'), query: field(row, 'Поисковый запрос'),
    requests: number(field(row, 'Количество запросов')),
    requests_previous: number(field(row, 'Количество запросов предыдущий период')),
    cart_conversion: number(field(row, 'Конверсия в корзину по артикулу')),
    cart_conversion_previous: number(field(row, 'Конверсия в корзину по артикулу предыдущий период')),
    order_conversion: number(field(row, 'Конверсия в заказ по артикулу')),
    order_conversion_previous: number(field(row, 'Конверсия в заказ по артикулу предыдущий период')),
  })).filter(row => row.date && row.wb_article && row.query);

  const stocks = stockSheet.rows.map(row => ({
    date: date(field(row, 'Дата'), year), name: field(row, 'Название'), wb_article: field(row, 'Артикул WB'),
    subject: field(row, 'Предмет'), brand: field(row, 'Бренд'), region: field(row, 'Регион'), warehouse: field(row, 'Склад'),
    stock: number(field(row, 'Остатки шт')), in_transit_to_customer: number(field(row, 'В пути к покупателю шт')),
    in_transit_from_customer: number(field(row, 'В пути от покупателя шт')),
    avg_daily_orders: number(field(row, 'Среднее количество заказов в день шт')),
  })).filter(row => row.date && row.wb_article);

  const positions = positionSheet.rows.map(row => ({
    date: date(field(row, 'Дата'), year), position: number(field(row, 'Позиция')), wb_article: field(row, 'Артикул'),
    seller: field(row, 'Продавец'), brand: field(row, 'Бренд'),
  })).filter(row => row.date && row.wb_article && row.position > 0);

  if (!funnel.length || !search.length || !stocks.length || !positions.length) {
    throw new Error('Один из четырёх листов не содержит валидных строк с датой и артикулом.');
  }
  const dates = [...funnel, ...search, ...stocks, ...positions].map(row => row.date).filter(Boolean).sort();
  return {
    funnel, search, stocks, positions,
    sheetNames: { funnel: funnelSheet.name, search: searchSheet.name, stocks: stockSheet.name, positions: positionSheet.name },
    dateStart: dates[0], dateEnd: dates.at(-1) || dates[0], inferredYear,
  };
}
