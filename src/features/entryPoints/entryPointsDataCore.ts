export type EntryPointsMetric = 'impressions' | 'clicks' | 'carts' | 'orders';

export interface EntryPointsFilters {
  start: string;
  end: string;
  cabinetIds?: string[] | null;
  productIds?: string[] | null;
  categoryIds?: string[] | null;
  brandIds?: string[] | null;
  groupIds?: string[] | null;
  search?: string | null;
  section?: string | null;
  entryPoint?: string | null;
}
export interface EntryPointsFilterOptions { minDate: string | null; maxDate: string | null; cabinetCount: number; productCount: number; sections: string[]; entryPoints: string[] }
export interface EntryPointsSummary { impressions: number; clicks: number; carts: number; orders: number; pointCount: number; productCount: number }
export interface EntryPointsSeriesRow { date: string; impressions: number; clicks: number; carts: number; orders: number }
export interface EntryPointsMatrixRow extends EntryPointsSeriesRow { section: string; entryPoint: string }
export interface EntryPointsProductLeader { productId: string; cabinetId: string; sellerSku: string | null; wbSku: string | null; productName: string; section: string; impressions: number; clicks: number; carts: number; orders: number }

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/u;
const METRICS = new Set<EntryPointsMetric>(['impressions', 'clicks', 'carts', 'orders']);

function asRecord(value: unknown, context: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${context}: сервер вернул неожиданный ответ`);
  return value as Record<string, unknown>;
}
function readText(value: unknown, field: string, nullable = false): string | null {
  if (value == null && nullable) return null;
  if (typeof value !== 'string' || (!nullable && !value.trim())) throw new Error(`V5 «Точки входа»: некорректное поле ${field}`);
  return value;
}
function readDate(value: unknown, field: string, nullable = false): string | null {
  const date = readText(value, field, nullable);
  if (date === null) return null;
  if (!ISO_DATE.test(date)) throw new Error(`V5 «Точки входа»: некорректная дата ${field}`);
  return date;
}
function readCount(value: unknown, field: string): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`V5 «Точки входа»: ${field} должен быть целым неотрицательным числом`);
  return parsed;
}
function readStringList(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) throw new Error(`V5 «Точки входа»: ${field} должен быть списком`);
  const values = value.map((item, index) => readText(item, `${field}[${index}]`) as string);
  if (new Set(values).size !== values.length) throw new Error(`V5 «Точки входа»: ${field} содержит повторы`);
  return values;
}

export function assertEntryPointsMetric(value: string): EntryPointsMetric {
  if (!METRICS.has(value as EntryPointsMetric)) throw new Error('V5 «Точки входа»: неизвестная метрика');
  return value as EntryPointsMetric;
}

export function assertEntryPointsFilters(filters: EntryPointsFilters): EntryPointsFilters {
  if (!ISO_DATE.test(filters.start) || !ISO_DATE.test(filters.end) || filters.end < filters.start) throw new Error('V5 «Точки входа»: некорректный период');
  const days = Math.round((Date.parse(`${filters.end}T00:00:00Z`) - Date.parse(`${filters.start}T00:00:00Z`)) / 86_400_000);
  if (!Number.isFinite(days) || days > 731) throw new Error('V5 «Точки входа»: период не должен превышать 731 день');
  if ((filters.cabinetIds?.length || 0) > 100 || (filters.categoryIds?.length || 0) > 100 || (filters.brandIds?.length || 0) > 100) throw new Error('V5 «Точки входа»: слишком много значений справочника');
  if ((filters.productIds?.length || 0) > 500 || (filters.groupIds?.length || 0) > 500) throw new Error('V5 «Точки входа»: слишком много товаров или склеек');
  if ((filters.search?.length || 0) > 100 || (filters.section?.length || 0) > 1000 || (filters.entryPoint?.length || 0) > 1000) throw new Error('V5 «Точки входа»: текстовый фильтр слишком длинный');
  return filters;
}

export function parseEntryPointsFilterOptions(value: unknown): EntryPointsFilterOptions {
  const record = asRecord(value, 'Фильтры V5 «Точки входа»');
  return { minDate: readDate(record.min_date, 'min_date', true), maxDate: readDate(record.max_date, 'max_date', true),
    cabinetCount: readCount(record.cabinet_count, 'cabinet_count'), productCount: readCount(record.product_count, 'product_count'),
    sections: readStringList(record.sections, 'sections'), entryPoints: readStringList(record.entry_points, 'entry_points') };
}

export function parseEntryPointsSummary(value: unknown): EntryPointsSummary {
  if (!Array.isArray(value) || value.length !== 1) throw new Error('V5 «Точки входа»: сводка должна содержать одну строку');
  const record = asRecord(value[0], 'Сводка V5 «Точки входа»');
  return { impressions: readCount(record.impressions, 'impressions'), clicks: readCount(record.clicks, 'clicks'), carts: readCount(record.carts, 'carts'),
    orders: readCount(record.orders, 'orders'), pointCount: readCount(record.point_count, 'point_count'), productCount: readCount(record.product_count, 'product_count') };
}

function parseSeriesRow(value: unknown, context: string): EntryPointsSeriesRow {
  const record = asRecord(value, context);
  return { date: readDate(record.period_date, 'period_date') as string, impressions: readCount(record.impressions, 'impressions'),
    clicks: readCount(record.clicks, 'clicks'), carts: readCount(record.carts, 'carts'), orders: readCount(record.orders, 'orders') };
}

export function parseEntryPointsSeries(value: unknown): EntryPointsSeriesRow[] {
  if (!Array.isArray(value) || value.length > 732) throw new Error('V5 «Точки входа»: некорректный дневной ряд');
  let previous = '';
  return value.map((item, index) => {
    const row = parseSeriesRow(item, `Динамика, строка ${index + 1}`);
    if (row.date <= previous) throw new Error('V5 «Точки входа»: даты динамики не упорядочены или повторяются');
    previous = row.date;
    return row;
  });
}

export function parseEntryPointsMatrix(value: unknown): EntryPointsMatrixRow[] {
  if (!Array.isArray(value) || value.length > 146_400) throw new Error('V5 «Точки входа»: матрица превышает серверный лимит');
  return value.map((item, index) => {
    const record = asRecord(item, `Матрица, строка ${index + 1}`);
    return { ...parseSeriesRow(record, `Матрица, строка ${index + 1}`), section: readText(record.section, 'section') as string, entryPoint: readText(record.entry_point, 'entry_point') as string };
  });
}

export function parseEntryPointsProductLeaders(value: unknown): EntryPointsProductLeader[] {
  if (!Array.isArray(value) || value.length > 100) throw new Error('V5 «Точки входа»: некорректный список товаров');
  const seen = new Set<string>();
  return value.map((item, index) => {
    const record = asRecord(item, `Товары, строка ${index + 1}`);
    const productId = readText(record.product_id, 'product_id') as string;
    if (seen.has(productId)) throw new Error('V5 «Точки входа»: товар повторяется в рейтинге');
    seen.add(productId);
    return { productId, cabinetId: readText(record.cabinet_id, 'cabinet_id') as string,
      sellerSku: readText(record.seller_sku, 'seller_sku', true), wbSku: readText(record.wb_sku, 'wb_sku', true),
      productName: readText(record.product_name, 'product_name') as string, section: readText(record.section, 'section') as string,
      impressions: readCount(record.impressions, 'impressions'), clicks: readCount(record.clicks, 'clicks'), carts: readCount(record.carts, 'carts'), orders: readCount(record.orders, 'orders') };
  });
}
