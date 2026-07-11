import * as XLSX from 'xlsx';

const DEV = import.meta.env.DEV;

export interface ParsedFile {
  fileName: string;
  fileType: 'xlsx' | 'xls' | 'csv';
  headers: string[];
  rawHeaders: string[];
  rows: Record<string, string>[];
  totalRows: number;
}

export function normHeader(h: string): string {
  return h.trim().toLowerCase().replace(/^["']|["']$/g, '').replace(/[_.-]/g, ' ');
}

function stripNonAlpha(v: string): string {
  return v.replace(/[^a-zа-я0-9]/g, '');
}

function detectDelimiter(text: string): string {
  const first = text.trim().split(/\r?\n/)[0];
  if (!first) return ',';
  const semicolons = (first.match(/;/g) || []).length;
  const commas = (first.match(/,/g) || []).length;
  return semicolons > commas && semicolons >= 2 ? ';' : ',';
}

// All known column keywords for header scoring
const ALL_KEY_COLUMNS = [
  'артикул', 'sku', 'nm_id', 'показы', 'impressions',
  'клики', 'clicks', 'ctr', 'корзины', 'carts',
  'заказы', 'orders', 'выкупы', 'buyouts',
  'отмены', 'cancellations', 'сумма заказов', 'ordered amount',
  'сумма выкупов', 'buyout amount', 'рекламные показы', 'ad impressions',
  'рекламные клики', 'ad clicks', 'расход', 'spend', 'остаток', 'stock',
  'план заказов', 'plan orders', 'прогноз прибыли', 'forecast profit',
  'факт прибыль', 'actual profit', 'факт маржа', 'actual margin',
];

function scoreRow(cells: string[]): number {
  const normalized = cells.map(c => normHeader(c));
  const stripped = normalized.map(stripNonAlpha);
  let score = 0;
  for (const key of ALL_KEY_COLUMNS) {
    const nk = normHeader(key);
    const sk = stripNonAlpha(nk);
    if (normalized.some(nh => nh.includes(nk)) || stripped.some(sh => sh.includes(sk))) {
      score++;
    }
  }
  return score;
}

interface SheetScanResult {
  sheetName: string;
  headerRow: number;
  headers: string[];
  data: any[][];
  score: number;
}

function scanSheet(name: string, arr: any[][]): SheetScanResult | null {
  const scanLimit = Math.min(30, arr.length);
  let best: SheetScanResult | null = null;

  for (let rowIdx = 0; rowIdx < scanLimit; rowIdx++) {
    const cells = (arr[rowIdx] || []).map(c => String(c).trim());
    const cellsNorm = cells.map(normHeader);
    const sc = scoreRow(cells);

    if (sc > 0 && (!best || sc > best.score)) {
      best = {
        sheetName: name,
        headerRow: rowIdx,
        headers: cellsNorm,
        data: arr,
        score: sc,
      };
    }
  }
  return best;
}

function fmtCell(v: any): string {
  if (v instanceof Date) {
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, '0');
    const d = String(v.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return String(v).trim();
}

function buildRows(headers: string[], data: any[][], headerRow: number): Record<string, string>[] {
  const rows: Record<string, string>[] = [];
  for (let i = headerRow + 1; i < data.length; i++) {
    const row: Record<string, string> = {};
    let hasValue = false;
    headers.forEach((h, j) => {
      const val = data[i][j] !== undefined ? fmtCell(data[i][j]) : '';
      row[h] = val;
      if (val) hasValue = true;
    });
    if (hasValue) rows.push(row);
  }
  return rows;
}

function parseCSV(text: string): { headers: string[]; rawHeaders: string[]; rows: Record<string, string>[] } {
  const delimiter = detectDelimiter(text);
  if (DEV) console.debug('[parseFile] CSV delimiter:', JSON.stringify(delimiter));
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) throw new Error('Файл пуст или содержит только заголовок');
  const rawHeaders = lines[0].split(delimiter).map(h => h.trim());
  const headers = rawHeaders.map(normHeader);
  const rows = lines.slice(1).map(line => {
    const vals = line.split(delimiter).map(v => v.trim());
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = vals[i] || ''; });
    return row;
  }).filter(r => headers.some(h => r[h]));
  return { headers, rawHeaders, rows };
}

function parseExcel(data: ArrayBuffer): { headers: string[]; rawHeaders: string[]; rows: Record<string, string>[] } {
  const workbook = XLSX.read(data, { type: 'array', cellDates: true });
  const sheetNames = workbook.SheetNames;
  if (DEV) console.debug('[parseFile] Excel sheets:', sheetNames.join(', '));

  // Scan all sheets for best header row
  let best: SheetScanResult | null = null;
  const scanned: { name: string; rows: number }[] = [];

  for (const name of sheetNames) {
    const sheet = workbook.Sheets[name];
    const arr: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    scanned.push({ name, rows: arr.length });
    if (arr.length < 2) continue;
    const result = scanSheet(name, arr);
    if (result && (!best || result.score > best.score)) {
      best = result;
    }
  }

  if (DEV) console.debug('[parseFile] scanned sheets:', scanned);

  if (!best) {
    // Fallback: first sheet, first row
    if (DEV) console.debug('[parseFile] no header row found, using first sheet first row');
    const fallback = sheetNames[0];
    const arr: any[][] = XLSX.utils.sheet_to_json(workbook.Sheets[fallback], { header: 1, defval: '' });
    if (arr.length < 2) throw new Error('Лист пуст или содержит только заголовок');
    const rawHeaders = (arr[0] as string[]).map(c => String(c).trim());
    const headers = rawHeaders.map(normHeader);
    const rows = buildRows(headers, arr, 0);
    return { headers, rawHeaders, rows };
  }

  if (DEV) console.debug('[parseFile] best sheet:', best.sheetName, 'header row:', best.headerRow, 'score:', best.score, 'headers:', best.headers);

  // Ignore rows above header (garbage)
  const rows = buildRows(best.headers, best.data, best.headerRow);
  const rawHeaders = best.data[best.headerRow].map(c => String(c).trim());
  return { headers: best.headers, rawHeaders, rows };
}

export function parseFile(file: File): Promise<ParsedFile> {
  const ext = file.name.split('.').pop()?.toLowerCase() as 'xlsx' | 'xls' | 'csv' | undefined;

  if (!ext || !['xlsx', 'xls', 'csv'].includes(ext)) {
    return Promise.reject(new Error(`Неподдерживаемый формат: .${ext || '?'}`));
  }

  const fileType = ext as 'xlsx' | 'xls' | 'csv';

  if (fileType === 'csv') {
    return file.text().then(text => {
      const { headers, rawHeaders, rows } = parseCSV(text);
      if (DEV) console.debug('[parseFile] CSV parsed:', rows.length, 'rows');
      return { fileName: file.name, fileType, headers, rawHeaders, rows, totalRows: rows.length };
    });
  }

  // xlsx / xls
  return file.arrayBuffer().then(data => {
    const { headers, rawHeaders, rows } = parseExcel(data);
    if (DEV) console.debug('[parseFile] Excel parsed:', rows.length, 'rows, from sheet with headers:', headers);
    return { fileName: file.name, fileType, headers, rawHeaders, rows, totalRows: rows.length };
  });
}
