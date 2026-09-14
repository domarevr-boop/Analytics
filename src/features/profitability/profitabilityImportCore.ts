export const PROFITABILITY_MAX_FILE_BYTES = 25 * 1024 * 1024;
export const PROFITABILITY_MAX_ROWS = 500_000;
export const PROFITABILITY_STAGE_CHUNK_SIZE = 500;

export type ProfitabilityPayload = Record<string, string | number>;
export interface ProfitabilitySheetGrid { name: string; data: unknown[][] }
export interface ProfitabilityParsedWorkbook {
  sheetName: string;
  rows: ProfitabilityPayload[];
  sourceRowNumbers: number[];
  inputRows: number;
  replacedDuplicateRows: number;
  dateStart: string;
  dateEnd: string;
  presentFields: string[];
}
export interface ProfitabilityStagedRow { row_number: number; payload: ProfitabilityPayload }

type IdentityField = 'date' | 'seller_sku' | 'wb_sku';
type MetricField = 'quantity' | 'revenue' | 'cost' | 'agent_fee' | 'logistics_cost' | 'marketing_cost' | 'storage_cost' | 'reported_gross_profit' | 'reported_gross_margin';
type Field = IdentityField | MetricField;

const ALIASES: Record<Field, string[]> = {
  date: ['дата', 'date'],
  seller_sku: ['артикул', 'артикул продавца', 'артикул поставщика', 'seller sku', 'sku'],
  wb_sku: ['артикул wb', 'артикул вб', 'wb sku', 'nm id', 'номенклатура'],
  quantity: ['количество', 'quantity'],
  revenue: ['выручка', 'revenue'],
  cost: ['себестоимость', 'cost'],
  agent_fee: ['агентское вознаграждение', 'agent fee'],
  logistics_cost: ['стоимость логистики', 'logistics cost'],
  marketing_cost: ['сумма рекламы', 'marketing cost', 'advertising cost'],
  storage_cost: ['сумма хранения', 'storage cost'],
  reported_gross_profit: ['валовая прибыль с учетом расходов маркетплейса', 'валоваяприбыльсучетомрасходовмаркетплейса', 'gross profit'],
  reported_gross_margin: ['итоговая маржинальность', 'итоговая маржинальность %', 'gross margin'],
};
const METRICS = Object.keys(ALIASES).filter(field => !['date', 'seller_sku', 'wb_sku'].includes(field)) as MetricField[];

const text = (value: unknown) => String(value ?? '').replace(/[\r\n\t]/gu, ' ').replace(/\u00a0/gu, ' ').replace(/\s+/gu, ' ').trim();
export const normalizeProfitabilityHeader = (value: unknown) => text(value).toLocaleLowerCase('ru-RU').replace(/ё/gu, 'е').replace(/[_.(),%₽/\\—–-]/gu, ' ').replace(/\s+/gu, ' ').trim();
const normalizedAliases = Object.fromEntries(Object.entries(ALIASES).map(([field, aliases]) => [field, aliases.map(normalizeProfitabilityHeader)])) as Record<Field, string[]>;
const indexOf = (headers: string[], aliases: string[]) => headers.findIndex(header => aliases.includes(header));

function parseDate(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, '0')}-${String(value.getUTCDate()).padStart(2, '0')}`;
  const source = text(value); let match = source.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/u);
  if (!match) { const local = source.match(/^(\d{1,2})[./](\d{1,2})[./](\d{2}|\d{4})$/u); if (local) match = [source, local[3].length === 2 ? `20${local[3]}` : local[3], local[2], local[1]]; }
  if (!match) return source;
  const year = Number(match[1]); const month = Number(match[2]); const day = Number(match[3]); const candidate = new Date(Date.UTC(year, month - 1, day));
  if (candidate.getUTCFullYear() !== year || candidate.getUTCMonth() !== month - 1 || candidate.getUTCDate() !== day) return source;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
function parseNumber(value: unknown): number | string {
  if (typeof value === 'number') return Number.isFinite(value) ? value : text(value);
  const source = text(value); if (!source || source === '-' || source === '—') return 0;
  const normalized = source.replace(/[\s\u00a0\u202f₽%]/gu, '').replace(',', '.');
  if (!/^-?\d+(?:\.\d+)?$/u.test(normalized)) return source;
  const parsed = Number(normalized); return Number.isFinite(parsed) ? parsed : source;
}
function parsePercentage(value: unknown): number | string {
  if (typeof value === 'number') return Number.isFinite(value) ? value * 100 : text(value);
  const parsed = parseNumber(value);
  return parsed;
}
const sku = (value: unknown) => text(value).replace(/\.0+$/u, '');
const keyOf = (payload: ProfitabilityPayload) => `${payload.date || ''}\u001f${sku(payload.seller_sku) || sku(payload.wb_sku)}`.toLocaleLowerCase('ru-RU');

export function extractProfitabilityWorkbook(sheets: ProfitabilitySheetGrid[]): ProfitabilityParsedWorkbook {
  for (const sheet of sheets) {
    const normalizedRows = sheet.data.map(row => row.map(normalizeProfitabilityHeader));
    const headerIndex = normalizedRows.findIndex(headers => indexOf(headers, normalizedAliases.date) >= 0
      && (indexOf(headers, normalizedAliases.seller_sku) >= 0 || indexOf(headers, normalizedAliases.wb_sku) >= 0)
      && indexOf(headers, normalizedAliases.revenue) >= 0);
    if (headerIndex < 0) continue;
    const headers = normalizedRows[headerIndex];
    const indexes = Object.fromEntries((Object.keys(ALIASES) as Field[]).map(field => [field, indexOf(headers, normalizedAliases[field])])) as Record<Field, number>;
    const presentFields = METRICS.filter(field => indexes[field] >= 0);
    const canonical = new Map<string, { payload: ProfitabilityPayload; rowNumber: number }>(); let inputRows = 0;
    for (let rowIndex = headerIndex + 1; rowIndex < sheet.data.length; rowIndex++) {
      const row = sheet.data[rowIndex] || []; if (!row.some(value => text(value))) continue;
      inputRows += 1; if (inputRows > PROFITABILITY_MAX_ROWS) throw new Error(`Отчёт содержит больше ${PROFITABILITY_MAX_ROWS.toLocaleString('ru-RU')} строк.`);
      const value = (field: Field) => indexes[field] >= 0 ? row[indexes[field]] : '';
      const payload: ProfitabilityPayload = { date: parseDate(value('date')), seller_sku: sku(value('seller_sku')), wb_sku: sku(value('wb_sku')) };
      for (const field of presentFields) payload[field] = field === 'reported_gross_margin' ? parsePercentage(value(field)) : parseNumber(value(field));
      canonical.set(keyOf(payload), { payload, rowNumber: rowIndex + 1 });
    }
    if (!inputRows) throw new Error('Отчёт «Рентабельность» не содержит строк данных.');
    const rows = [...canonical.values()]; const dates = rows.map(item => item.payload.date).filter((value): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/u.test(value)).sort();
    return { sheetName: sheet.name, rows: rows.map(item => item.payload), sourceRowNumbers: rows.map(item => item.rowNumber), inputRows, replacedDuplicateRows: inputRows - rows.length, dateStart: dates[0] || '', dateEnd: dates.at(-1) || dates[0] || '', presentFields };
  }
  throw new Error('Файл «Рентабельность» не распознан.');
}

export function calculateProfitabilityAmounts(row: ProfitabilityPayload) {
  const numeric = (field: string) => typeof row[field] === 'number' ? row[field] as number : 0;
  const revenue = numeric('revenue');
  const grossProfit = revenue - ['cost', 'agent_fee', 'logistics_cost', 'marketing_cost', 'storage_cost'].reduce((sum, field) => sum + numeric(field), 0);
  return { revenue, grossProfit, grossMargin: revenue ? grossProfit / revenue * 100 : 0 };
}

export const buildProfitabilityStagedRows = (workbook: ProfitabilityParsedWorkbook): ProfitabilityStagedRow[] => workbook.rows.map((payload, index) => ({ row_number: workbook.sourceRowNumbers[index] || index + 2, payload }));
export function splitProfitabilityRows<T>(rows: T[], size = PROFITABILITY_STAGE_CHUNK_SIZE): T[][] { const chunks: T[][] = []; for (let index = 0; index < rows.length; index += size) chunks.push(rows.slice(index, index + size)); return chunks; }
