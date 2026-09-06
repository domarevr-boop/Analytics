export const MARKET_MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MARKET_MAX_ROWS = 50_000;
export const MARKET_STAGE_CHUNK_SIZE = 500;

const MARKET_MARKER_HEADERS = new Set([
  'заказы рынок',
  'наши заказы',
  'заказы, шт, рынок',
]);

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

export function buildMarketStagedRows(
  rows: Record<string, string>[],
  sourceRowNumbers: number[] | undefined,
  sheetName: string | undefined,
  dateOverride?: string,
  fallbackYear?: number,
): MarketStagedRow[] {
  return rows.map((row, index) => {
    const payload: Record<string, string | number> = {
      date: parseDate(dateOverride || row.date || '', fallbackYear),
      market_ordered_amount: parseNumericOrRaw(row.market_ordered_amount),
      own_ordered_amount: parseNumericOrRaw(row.market_own_ordered_amount),
      market_orders: parseNumericOrRaw(row.market_orders),
      own_orders: parseNumericOrRaw(row.market_own_orders),
    };

    const optionalFields: Array<[string, string | undefined]> = [
      ['amount_share', row.market_amount_share],
      ['orders_share', row.market_orders_share],
      ['own_avg_check', row.market_own_avg_check],
      ['market_avg_check', row.market_avg_check],
    ];
    for (const [field, value] of optionalFields) {
      if (String(value ?? '').trim() !== '') payload[field] = parseNumericOrRaw(String(value));
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
