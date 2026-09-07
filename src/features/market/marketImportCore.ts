export const MARKET_MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MARKET_MAX_ROWS = 50_000;
export const MARKET_STAGE_CHUNK_SIZE = 500;

const MARKET_MARKER_HEADERS = new Set([
  'заказы рынок',
  'наши заказы',
  'заказы, шт, рынок',
]);

const MARKET_FIELD_BY_HEADER: Record<string, string> = {
  'дата': 'date',
  'заказы рынок': 'market_ordered_amount',
  'наши заказы': 'market_own_ordered_amount',
  'наша доля': 'market_amount_share',
  'заказы, шт, рынок': 'market_orders',
  'заказы, шт, мы': 'market_own_orders',
  'наша доля в заказах': 'market_orders_share',
  'средний чек, мы': 'market_own_avg_check',
  'средний чек рынок': 'market_avg_check',
};

export interface MarketParsedCandidate {
  headers: string[];
  rawHeaders: string[];
  rows: Record<string, string>[];
  sourceRowNumbers: number[];
  sheetName: string;
}

export interface MarketStagedRow {
  sheet_name: string;
  row_number: number;
  payload: Record<string, string | number>;
}

export function normalizeMarketHeader(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLocaleLowerCase('ru-RU')
    .replace(/^['"]|['"]$/g, '')
    .replace(/[_.-]/g, ' ')
    .replace(/\s+/g, ' ');
}

function formatCell(value: unknown): string {
  if (value instanceof Date) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  return String(value ?? '').trim();
}

function markerScore(row: unknown[]): number {
  const headers = row.map(normalizeMarketHeader);
  let score = 0;
  for (const marker of MARKET_MARKER_HEADERS) {
    if (headers.includes(marker)) score++;
  }
  return score;
}

export function extractMarketTable(grid: unknown[][], sheetName = 'Рынок'): MarketParsedCandidate | null {
  let headerRow = -1;
  let bestScore = 0;
  const scanLimit = Math.min(30, grid.length);

  for (let index = 0; index < scanLimit; index++) {
    const score = markerScore(grid[index] || []);
    if (score > bestScore) {
      bestScore = score;
      headerRow = index;
    }
  }

  if (headerRow < 0 || bestScore < MARKET_MARKER_HEADERS.size) return null;

  const rawHeaders = (grid[headerRow] || []).map(formatCell);
  const headers = rawHeaders.map(normalizeMarketHeader);
  const rows: Record<string, string>[] = [];
  const sourceRowNumbers: number[] = [];

  for (let rowIndex = headerRow + 1; rowIndex < grid.length; rowIndex++) {
    const source = grid[rowIndex] || [];
    const row: Record<string, string> = {};
    let hasValue = false;
    headers.forEach((header, columnIndex) => {
      if (!header) return;
      const value = formatCell(source[columnIndex]);
      row[header] = value;
      if (value !== '') hasValue = true;
    });
    if (!hasValue) continue;
    rows.push(row);
    sourceRowNumbers.push(rowIndex + 1);
  }

  if (rows.length > MARKET_MAX_ROWS) {
    throw new Error(`Отчёт «Рынок» содержит больше ${MARKET_MAX_ROWS.toLocaleString('ru-RU')} строк`);
  }

  return { headers, rawHeaders, rows, sourceRowNumbers, sheetName };
}

export function mapMarketSourceRows(rows: Record<string, string>[]): Record<string, string>[] {
  return rows.map(row => Object.fromEntries(
    Object.entries(row)
      .map(([header, value]) => [MARKET_FIELD_BY_HEADER[normalizeMarketHeader(header)], value] as const)
      .filter((entry): entry is readonly [string, string] => Boolean(entry[0])),
  ));
}

function parseDate(value: string, fallbackYear?: number): string {
  const source = value.trim();
  let match = source.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!match) {
    const full = source.match(/^(\d{1,2})[./](\d{1,2})[./](\d{2}|\d{4})$/);
    if (full) {
      const year = full[3].length === 2 ? `20${full[3]}` : full[3];
      match = [source, year, full[2], full[1]];
    }
  }
  if (!match) {
    const short = source.match(/^(\d{1,2})[./](\d{1,2})$/);
    if (short && fallbackYear) match = [source, String(fallbackYear), short[2], short[1]];
  }
  if (!match) return source;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const candidate = new Date(year, month - 1, day);
  if (candidate.getFullYear() !== year || candidate.getMonth() !== month - 1 || candidate.getDate() !== day) return source;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function parseNumericOrRaw(value: string): number | string {
  const source = String(value ?? '').trim();
  if (!source) return '';
  const normalized = source
    .replace(/[\s\u00a0\u202f]/g, '')
    .replace(/[₽%]/g, '')
    .replace(',', '.');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : source;
}

function parseShareOrRaw(value: string, ownValue: number | string, totalValue: number | string): number | string {
  const parsed = parseNumericOrRaw(value);
  if (typeof parsed !== 'number' || String(value).includes('%')) return parsed;
  if (typeof ownValue !== 'number' || typeof totalValue !== 'number' || totalValue <= 0) return parsed;

  const expectedPercentagePoints = ownValue / totalValue * 100;
  const directDistance = Math.abs(parsed - expectedPercentagePoints);
  const fractionDistance = Math.abs(parsed * 100 - expectedPercentagePoints);
  return fractionDistance < directDistance ? parsed * 100 : parsed;
}

export function buildMarketStagedRows(
  rows: Record<string, string>[],
  sourceRowNumbers: number[] | undefined,
  sheetName: string | undefined,
  dateOverride?: string,
  fallbackYear?: number,
): MarketStagedRow[] {
  return rows.map((row, index) => {
    const marketOrderedAmount = parseNumericOrRaw(row.market_ordered_amount);
    const ownOrderedAmount = parseNumericOrRaw(row.market_own_ordered_amount);
    const marketOrders = parseNumericOrRaw(row.market_orders);
    const ownOrders = parseNumericOrRaw(row.market_own_orders);
    const payload: Record<string, string | number> = {
      date: parseDate(dateOverride || row.date || '', fallbackYear),
      market_ordered_amount: marketOrderedAmount,
      own_ordered_amount: ownOrderedAmount,
      market_orders: marketOrders,
      own_orders: ownOrders,
    };

    if (String(row.market_amount_share ?? '').trim() !== '') {
      payload.amount_share = parseShareOrRaw(row.market_amount_share, ownOrderedAmount, marketOrderedAmount);
    }
    if (String(row.market_orders_share ?? '').trim() !== '') {
      payload.orders_share = parseShareOrRaw(row.market_orders_share, ownOrders, marketOrders);
    }
    if (String(row.market_own_avg_check ?? '').trim() !== '') {
      payload.own_avg_check = parseNumericOrRaw(row.market_own_avg_check);
    }
    if (String(row.market_avg_check ?? '').trim() !== '') {
      payload.market_avg_check = parseNumericOrRaw(row.market_avg_check);
    }

    return {
      sheet_name: sheetName || 'Рынок',
      row_number: sourceRowNumbers?.[index] || index + 2,
      payload,
    };
  });
}

export function splitMarketRows<T>(rows: T[], size = MARKET_STAGE_CHUNK_SIZE): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < rows.length; index += size) chunks.push(rows.slice(index, index + size));
  return chunks;
}
