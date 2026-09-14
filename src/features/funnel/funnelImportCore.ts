export const FUNNEL_MAX_FILE_BYTES = 25 * 1024 * 1024;
export const FUNNEL_MAX_ROWS = 500_000;
export const FUNNEL_STAGE_CHUNK_SIZE = 500;

export type FunnelImportSource = 'wb_funnel' | 'xway';
export type FunnelPayload = Record<string, string | number>;

export interface FunnelSheetGrid { name: string; data: unknown[][] }
export interface FunnelParsedWorkbook {
  source: FunnelImportSource;
  sheetName: string;
  rows: FunnelPayload[];
  sourceRowNumbers: number[];
  inputRows: number;
  aggregatedRows: number;
  dateStart: string;
  dateEnd: string;
  presentMetricFields: string[];
}
export interface FunnelStagedRow { row_number: number; payload: FunnelPayload }

type IdentityField = 'date' | 'seller_sku' | 'wb_sku';
type WbMetric = 'impressions' | 'clicks' | 'carts' | 'orders' | 'ordered_amount';
type XwayMetric = 'ad_impressions' | 'ad_clicks' | 'ad_orders_qty' | 'ad_ordered_amount' | 'ad_spend';
type Field = IdentityField | WbMetric | XwayMetric;

const IDENTITY_ALIASES: Record<IdentityField, string[]> = {
  date: ['дата', 'date'],
  seller_sku: ['артикул продавца', 'артикул поставщика', 'артикул', 'sku', 'seller sku'],
  wb_sku: ['артикул wb', 'артикул вб', 'nm id', 'nm_id', 'номенклатура', 'wb sku'],
};
const WB_ALIASES: Record<WbMetric, string[]> = {
  impressions: ['показы', 'impressions'],
  clicks: ['переходы в карточку', 'переходы', 'клики', 'clicks'],
  carts: ['добавления в корзину', 'добавили в корзину', 'положили в корзину', 'корзины', 'carts'],
  orders: ['заказы', 'заказали товаров шт', 'заказы шт', 'orders'],
  ordered_amount: ['заказали на сумму', 'заказали на сумму руб', 'общая сумма заказов', 'заказы руб', 'ordered amount'],
};
const XWAY_ALIASES: Record<XwayMetric, string[]> = {
  ad_impressions: ['показы', 'рекламные показы', 'ad impressions', 'shows'],
  ad_clicks: ['клики', 'рекламные клики', 'ad clicks', 'clicks'],
  ad_orders_qty: ['заказы шт', 'рекламные заказы шт', 'ad orders qty', 'orders qty'],
  ad_ordered_amount: ['заказы руб', 'рекламные заказы руб', 'ad ordered amount', 'orders rub'],
  ad_spend: ['расход', 'расход руб', 'рекламный расход', 'ad spend', 'spend', 'spend rub'],
};

function cellText(value: unknown): string {
  return String(value ?? '').replace(/[\r\n\t]/gu, ' ').replace(/\u00a0/gu, ' ').replace(/\s+/gu, ' ').trim();
}

export function normalizeFunnelHeader(value: unknown): string {
  return cellText(value).toLocaleLowerCase('ru-RU').replace(/ё/gu, 'е').replace(/[_.(),%₽/\\—–-]/gu, ' ').replace(/\s+/gu, ' ').trim();
}

function normalizedAliases(source: FunnelImportSource): Record<Field, string[]> {
  const metrics = source === 'wb_funnel' ? WB_ALIASES : XWAY_ALIASES;
  return Object.fromEntries(Object.entries({ ...IDENTITY_ALIASES, ...metrics })
    .map(([field, aliases]) => [field, aliases.map(normalizeFunnelHeader)])) as Record<Field, string[]>;
}

function findFieldIndex(headers: string[], aliases: string[]): number {
  return headers.findIndex(header => aliases.includes(header));
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
  const normalized = source.replace(/[\s\u00a0\u202f₽%]/gu, '').replace(',', '.');
  if (!/^-?\d+(?:\.\d+)?$/u.test(normalized)) return source;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : source;
}

function canonicalSku(value: unknown): string {
  return cellText(value).replace(/\.0+$/u, '');
}

function keyOf(payload: FunnelPayload): string {
  return [payload.date, canonicalSku(payload.seller_sku) || cellText(payload.wb_sku)]
    .map(value => cellText(value).toLocaleLowerCase('ru-RU')).join('\u001f');
}

function parseSheet(sheet: FunnelSheetGrid, source: FunnelImportSource): FunnelParsedWorkbook | null {
  const aliases = normalizedAliases(source);
  const metricFields = Object.keys(source === 'wb_funnel' ? WB_ALIASES : XWAY_ALIASES) as Array<WbMetric | XwayMetric>;
  const normalizedRows = sheet.data.map(row => row.map(normalizeFunnelHeader));
  const headerIndex = normalizedRows.findIndex(headers =>
    findFieldIndex(headers, aliases.date) >= 0
    && (findFieldIndex(headers, aliases.seller_sku) >= 0 || findFieldIndex(headers, aliases.wb_sku) >= 0)
    && metricFields.some(field => findFieldIndex(headers, aliases[field]) >= 0),
  );
  if (headerIndex < 0) return null;
  const headers = normalizedRows[headerIndex];
  const indexes = Object.fromEntries((Object.keys(aliases) as Field[])
    .map(field => [field, findFieldIndex(headers, aliases[field])])) as Record<Field, number>;
  const presentMetricFields = metricFields.filter(field => indexes[field] >= 0);
  if (!presentMetricFields.length) throw new Error('Файл не содержит ни одной распознанной метрики воронки или рекламы.');

  const aggregated = new Map<string, { payload: FunnelPayload; rowNumber: number }>();
  let inputRows = 0;
  for (let rowIndex = headerIndex + 1; rowIndex < sheet.data.length; rowIndex++) {
    const row = sheet.data[rowIndex] || [];
    if (!row.some(value => cellText(value))) continue;
    inputRows += 1;
    if (inputRows > FUNNEL_MAX_ROWS) throw new Error(`Отчёт содержит больше ${FUNNEL_MAX_ROWS.toLocaleString('ru-RU')} строк.`);
    const value = (field: Field) => indexes[field] >= 0 ? row[indexes[field]] : '';
    const payload: FunnelPayload = {
      date: parseDateOrRaw(value('date')),
      seller_sku: canonicalSku(value('seller_sku')),
      wb_sku: canonicalSku(value('wb_sku')),
    };
    for (const field of presentMetricFields) payload[field] = parseNumberOrRaw(value(field));
    const key = keyOf(payload);
    const existing = aggregated.get(key);
    if (!existing) {
      aggregated.set(key, { payload, rowNumber: rowIndex + 1 });
      continue;
    }
    for (const field of presentMetricFields) {
      const left = existing.payload[field]; const right = payload[field];
      existing.payload[field] = typeof left === 'number' && typeof right === 'number' ? left + right : right;
    }
    existing.rowNumber = rowIndex + 1;
  }
  if (!inputRows) throw new Error('Отчёт не содержит строк данных.');
  const rows = [...aggregated.values()];
  const dates = rows.map(item => item.payload.date).filter((value): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/u.test(value)).sort();
  return {
    source,
    sheetName: sheet.name,
    rows: rows.map(item => item.payload),
    sourceRowNumbers: rows.map(item => item.rowNumber),
    inputRows,
    aggregatedRows: inputRows - rows.length,
    dateStart: dates[0] || '',
    dateEnd: dates.at(-1) || dates[0] || '',
    presentMetricFields,
  };
}

export function extractFunnelWorkbook(sheets: FunnelSheetGrid[], source: FunnelImportSource): FunnelParsedWorkbook {
  for (const sheet of sheets) {
    const parsed = parseSheet(sheet, source);
    if (parsed) return parsed;
  }
  throw new Error(source === 'xway' ? 'Файл XWay не распознан.' : 'Файл «Воронка WB» не распознан.');
}

export function buildFunnelStagedRows(workbook: FunnelParsedWorkbook): FunnelStagedRow[] {
  return workbook.rows.map((payload, index) => ({ row_number: workbook.sourceRowNumbers[index] || index + 2, payload }));
}

export function splitFunnelRows<T>(rows: T[], size = FUNNEL_STAGE_CHUNK_SIZE): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < rows.length; index += size) chunks.push(rows.slice(index, index + size));
  return chunks;
}

export function calculateAdCpo(adSpend: number, adOrdersQty: number): number {
  return adOrdersQty ? adSpend / adOrdersQty : 0;
}
